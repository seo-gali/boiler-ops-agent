"""실제 ASGI 인증·보안 경계 검사. 난수 자격과 임시 DB만 사용하며 서버를 시작하지 않는다."""
import asyncio
import hashlib
import io
import json
import logging
import os
import secrets
import sys
import threading
import time
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from backend.app.main import create_app
from backend.app.security import Security
from backend.app.agent.traces import TraceStore
from backend.app.simulator.service import Simulator

checks = []


def check(name, passed):
    checks.append({"name": name, "passed": bool(passed)})


async def resource_limits(keys):
    security = Security()
    from backend.app.security import Login
    token, principal = security.login(Login(user_id="operator", access_key=keys["operator"]))
    scope = {"headers": [(b"origin", security.origin.encode()), (b"cookie", f"{security.cookie_name}={token}".encode())]}
    opened = [security.websocket_open(scope) for _ in range(security.user_connection_limit)]
    try:
        security.websocket_open(scope)
        denied = False
    except HTTPException as error:
        denied = error.status_code == 429
    check("per-user WebSocket cap", denied)
    for user in opened:
        security.websocket_close(user)
    check("WebSocket slots released", not security.connections)
    security.connections['other'] = security.connection_limit
    try:
        security.websocket_open(scope)
        denied = False
    except HTTPException as error:
        denied = error.status_code == 429
    check("global WebSocket cap", denied)
    for _ in range(4):
        security.login(Login(user_id="operator", access_key=keys["operator"]))
    try:
        security.login(Login(user_id="operator", access_key=keys["operator"]))
        denied = False
    except HTTPException as error:
        denied = error.status_code == 429
    check("active session cap", denied)
    completed = threading.Event()
    work = [asyncio.create_task(security.model_work(principal, lambda: completed.wait(5))) for _ in range(2)]
    try:
        await asyncio.sleep(.02)
        try:
            await security.model_work(principal, lambda: None)
            denied = False
        except HTTPException as error:
            denied = error.status_code == 429
        check("model concurrency cap", denied)
        work[0].cancel()
        await asyncio.gather(work[0], return_exceptions=True)
        check("cancelled HTTP wait retains running model reservation", len(security.model_tasks) == 2)
    finally:
        completed.set()
        await asyncio.gather(*work, return_exceptions=True)
        if security.model_tasks:
            await asyncio.gather(*security.model_tasks, return_exceptions=True)
    check("model reservations released after completion", not security.model_tasks)


async def request(app, path, *, method="GET", body=None, raw=None, cookie="", origin=None,
                  scheme="https", host="boiler.example", content_type="application/json", extra=()):
    headers = [(b"host", host.encode()), (b"cookie", cookie.encode()), (b"content-type", content_type.encode()), *extra]
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    payload = raw if raw is not None else json.dumps(body).encode() if body is not None else b""
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "scheme": scheme,
             "method": method, "path": path, "raw_path": path.encode(), "query_string": b"",
             "headers": headers, "client": ("192.0.2.1", 1234), "server": (host, 443), "root_path": ""}
    sent = []

    async def receive():
        return {"type": "http.request", "body": payload, "more_body": False}

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    start = next(item for item in sent if item["type"] == "http.response.start")
    return start["status"], dict(start["headers"]), b"".join(item.get("body", b"") for item in sent)


async def run():
    keys = {name: secrets.token_urlsafe(32) for name in ("operator", "other", "viewer")}
    settings = {"APP_PUBLIC_ORIGIN": "https://boiler.example", "AUTH_SESSION_SECONDS": "60",
                "AUTH_USERS_JSON": json.dumps([{"user_id": name, "role": "viewer" if name == "viewer" else "operator",
                    "key_hash": hashlib.sha256(key.encode()).hexdigest()} for name, key in keys.items()])}
    with TemporaryDirectory(prefix="boiler-security-") as directory, patch.dict(os.environ, settings, clear=True):
        os.environ.update(SIMULATOR_DB_PATH=str(Path(directory) / "simulator.sqlite"), AGENT_TRACE_DIR=str(Path(directory) / "traces"))
        app = create_app()
        security = app.state.security = Security()
        app.state.boiler = SimpleNamespace(current=None, history=[], snapshot=lambda: {}, registry={"fixture": {"equipment": "reheater"}})
        app.state.traces = TraceStore()
        app.state.simulator = Simulator(app.state.boiler, app.state.traces)
        origin = security.origin
        log = io.StringIO()
        handler = logging.StreamHandler(log)
        logger = logging.getLogger("uvicorn.error")
        logger.addHandler(handler)
        old_level = logger.level
        logger.setLevel(logging.INFO)
        try:
            for path in ("/api/state", "/api/registry", "/api/simulator", "/api/simulator/audit", "/api/metrics/http", "/openapi.json", "/docs"):
                check("anonymous blocked: " + path, (await request(app, path))[0] == 401)
            check("minimal liveness", json.loads((await request(app, "/api/health"))[2]) == {"status": "ok"})
            for scheme, extra in (("http", ()), ("http", ((b"x-forwarded-proto", b"https"),))):
                check("public HTTP blocked, including forged proxy header: " + str(bool(extra)),
                      (await request(app, "/api/session", method="POST", body={"user_id": "operator", "access_key": keys["operator"]}, origin=origin, scheme=scheme, extra=extra))[0] == 403)
            check("invalid Host", (await request(app, "/api/health", host="attacker.invalid"))[0] == 400)
            check("oversized headers", (await request(app, "/api/health", extra=((b"x-padding", b"x" * 17000),)))[0] == 431)
            for invalid_origin in (None, "https://attacker.invalid", "null"):
                check("login CSRF blocked: " + str(invalid_origin), (await request(app, "/api/session", method="POST", body={}, origin=invalid_origin))[0] == 403)
            check("multipart uploads unsupported", (await request(app, "/api/session", method="POST", raw=b"file", origin=origin, content_type="multipart/form-data"))[0] == 415)
            for body in ({"user_id": "operator", "access_key": "sensitive-short"},
                         {"user_id": "operator", "access_key": keys["operator"], "role": "operator"}):
                status, _, data = await request(app, "/api/session", method="POST", body=body, origin=origin)
                check("server login validation hides submitted credentials", status == 422 and all(key.encode() not in data for key in [*keys.values(), "sensitive-short"]))
            sessions = {}
            for name, key in keys.items():
                status, headers, data = await request(app, "/api/session", method="POST", body={"user_id": name, "access_key": key}, origin=origin)
                check("valid login: " + name, status == 200 and json.loads(data)["user_id"] == name)
                cookie = headers[b"set-cookie"].decode()
                check("secure bounded cookie: " + name, all(part in cookie for part in ["HttpOnly", "Secure", "SameSite=strict", "Max-Age=60", "Path=/"]) and "Domain=" not in cookie)
                sessions[name] = cookie.split(";", 1)[0]
            operator, other, viewer = (sessions[name] for name in ("operator", "other", "viewer"))
            check("only hashed session IDs retained", all(token not in security.sessions for token in (cookie.split("=", 1)[1] for cookie in sessions.values())))
            check("credentials absent from login responses and logs", all(key not in log.getvalue() for key in keys.values()))
            check("viewer read", (await request(app, "/api/state", cookie=viewer))[0] == 200)
            check("viewer admin metrics blocked", (await request(app, "/api/metrics/http", cookie=viewer))[0] == 403)
            check("viewer model work blocked", (await request(app, "/api/agent/query", method="POST", cookie=viewer, origin=origin, body={"equipment": "reheater", "question": "현재 상태"}))[0] == 403)
            check("viewer decision blocked", (await request(app, f"/api/simulator/proposals/{uuid4()}/decision", method="POST", cookie=viewer, origin=origin, body={"approve": True, "confirm": True, "expected_revision": 0}))[0] == 403)
            check("cross-origin logout blocked", (await request(app, "/api/session", method="DELETE", cookie=operator, origin="https://attacker.invalid"))[0] == 403)
            status, headers, _ = await request(app, "/api/state", cookie=operator, origin="https://attacker.invalid")
            check("no cross-origin read permission", status == 200 and b"access-control-allow-origin" not in headers)
            for raw, expected in ((b"{", 422), (b"x" * 8193, 413)):
                check("JSON boundary: " + str(expected), (await request(app, "/api/agent/query", method="POST", cookie=operator, origin=origin, raw=raw))[0] == expected)
            for body in ({"equipment": "reheater", "question": "   "}, {"equipment": "reheater", "question": "x" * 4001}):
                check("question length and whitespace validation", (await request(app, "/api/agent/query", method="POST", cookie=operator, origin=origin, body=body))[0] == 422)
            for decision in ({"approve": "true", "confirm": True, "expected_revision": 0},
                             {"approve": True, "confirm": True, "expected_revision": 0, "requested_value": 10}):
                check("decision types and extra fields rejected", (await request(app, f"/api/simulator/proposals/{uuid4()}/decision", method="POST", cookie=operator, origin=origin, body=decision))[0] == 422)
            trace_id = uuid4()
            app.state.traces.write({"trace_id": str(trace_id), "owner": "operator", "request": {"question": "private fixture"}})
            check("trace owner can read", (await request(app, f"/api/agent/traces/{trace_id}", cookie=operator))[0] == 200)
            check("other operator cannot read trace", (await request(app, f"/api/agent/traces/{trace_id}", cookie=other))[0] == 404)
            check("trace path traversal rejected", (await request(app, "/api/agent/traces/..%2f.env", cookie=operator))[0] == 422)
            proposal_id = str(uuid4())
            with app.state.simulator.connection() as db:
                db.execute("INSERT INTO proposals(id,payload,status,owner) VALUES (?,?,?,?)", (proposal_id, '{}', 'pending', 'operator'))
                app.state.simulator.audit(db, SimpleNamespace(user_id="operator"), proposal_id, "fixture", {"private": True})
            check("other user audit is empty", json.loads((await request(app, "/api/simulator/audit", cookie=other))[2]) == [])
            check("other user proposals are empty", json.loads((await request(app, "/api/simulator", cookie=other))[2])["proposals"] == [])
            check("other user cannot decide", (await request(app, f"/api/simulator/proposals/{proposal_id}/decision", method="POST", cookie=other, origin=origin, body={"approve": True, "confirm": True, "expected_revision": 0}))[0] == 404)
            check("SQL injection treated as value", app.state.simulator.audit_log(SimpleNamespace(user_id="' OR 1=1 --")) == [])
            with patch.object(app.state.boiler, 'snapshot', side_effect=RuntimeError("private-internal-failure")):
                status, headers, data = await request(app, "/api/state", cookie=operator)
                check("internal error sanitized", status == 500 and b"private-internal-failure" not in data)
                check("security headers on internal error", headers.get(b"x-frame-options") == b"DENY" and b"content-security-policy" in headers)
            for name, kwargs in (("success", {}), ("anonymous", {"cookie": ""}), ("invalid Host", {"host": "evil.invalid"})):
                _, headers, _ = await request(app, "/api/state", **{"cookie": operator, **kwargs})
                check("all response security headers: " + name, all(key in headers for key in [b"cache-control", b"x-content-type-options", b"x-frame-options", b"content-security-policy", b"referrer-policy", b"permissions-policy"]))
            _, headers, _ = await request(app, "/api/health")
            check("HTTPS HSTS", headers.get(b"strict-transport-security") == b"max-age=31536000")
            for origin_value, scheme, expected in ((origin, "ws", False), ("https://evil.invalid", "wss", False), (origin, "wss", True)):
                scope = {"type": "websocket", "scheme": scheme, "path": "/api/ws", "headers": [(b"host", b"boiler.example"), (b"origin", origin_value.encode()), (b"cookie", operator.encode())]}
                sent = []
                forwarded = []

                async def downstream(*_):
                    forwarded.append(True)

                async def send(message):
                    sent.append(message)

                from backend.app.security import SecurityMiddleware
                await SecurityMiddleware(downstream, app)(scope, None, send)
                if forwarded:
                    try:
                        principal = security.websocket_open(scope)
                        security.websocket_close(principal)
                        accepted = True
                    except HTTPException:
                        accepted = False
                else:
                    accepted = False
                check("WebSocket TLS and Origin: " + scheme + "/" + origin_value, accepted == expected)
            # 시간 경과를 기다리지 않고 서버가 만료된 세션을 거부하는 경계 확인
            session_id = hashlib.sha256(viewer.split("=", 1)[1].encode()).hexdigest()
            security.sessions[session_id] = replace(security.sessions[session_id], expires_at=time.time() - 1)
            check("absolute session expiry", (await request(app, "/api/state", cookie=viewer))[0] == 401)
            check("logout revokes token", (await request(app, "/api/session", method="DELETE", cookie=operator, origin=origin))[0] == 200 and (await request(app, "/api/state", cookie=operator))[0] == 401)
            security.buckets.clear()
            statuses = [(await request(app, "/api/session", method="POST", origin=origin, body={"user_id": "unknown", "access_key": secrets.token_urlsafe(32)}))[0] for _ in range(11)]
            check("login brute force limited", statuses == [401] * 10 + [429])
            check("security rejections logged without credentials", '"event": "security_rejection"' in log.getvalue() and '"client_ip": "192.0.2.1"' in log.getvalue() and all(key not in log.getvalue() for key in keys.values()))
            check("debug and schema disabled", not app.debug and app.docs_url is None and app.openapi_url is None)
            await resource_limits(keys)
        finally:
            logger.removeHandler(handler)
            logger.setLevel(old_level)
        for missing in ("AUTH_USERS_JSON", "APP_PUBLIC_ORIGIN"):
            with patch.dict(os.environ, {missing: ""}):
                try:
                    Security()
                    rejected = False
                except ValueError:
                    rejected = True
                check("missing config fails closed: " + missing, rejected)
        with patch.dict(os.environ, {"APP_PUBLIC_ORIGIN": "http://boiler.example"}):
            try:
                Security()
                rejected = False
            except ValueError:
                rejected = True
            check("public HTTP configuration rejected", rejected)
        with patch.dict(os.environ, {"APP_PUBLIC_ORIGIN": "http://127.0.0.1:5173"}):
            app.state.security = Security()
            status, headers, _ = await request(app, "/api/health", scheme="http", host="127.0.0.1")
            check("local development HTTP retained without HSTS", status == 200 and b"strict-transport-security" not in headers)


if __name__ == "__main__":
    asyncio.run(run())
    result = {"passed": all(item["passed"] for item in checks), "checks": checks,
              "scope": "ASGI routes with real security, temporary SQLite/TraceStore, in-memory credentials; no production services or secrets"}
    output = Path("artifacts/security/boundaries.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "checks": len(checks), "failures": [item['name'] for item in checks if not item['passed']]}, ensure_ascii=False))
    sys.exit(0 if result["passed"] else 1)
