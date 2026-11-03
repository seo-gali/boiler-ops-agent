"""실제 ASGI 라우트·인증 경계·CSV 동시 한도·HTTP 관측의 격리 검증."""
import asyncio
import hashlib
import json
import logging
import sqlite3
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app import main
from backend.app.security import Security, Principal, Session

results, records = [], []


def check(name, passed, **observed):
    results.append({"name": name, "passed": bool(passed), **observed})


class Capture(logging.Handler):
    def emit(self, record):
        try:
            records.append(json.loads(record.getMessage()))
        except ValueError:
            pass


async def request(path, method="GET", body=None, query=None, token="fixture-operator", host="127.0.0.1"):
    payload = json.dumps(body).encode() if body is not None else b""
    headers = [(b"host", host.encode()), (b"content-type", b"application/json"), (b"origin", b"http://127.0.0.1"), (b"x-request-id", b"private-sentinel")]
    if token:
        headers.append((b"cookie", f"boiler_session={token}".encode()))
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
             "scheme": "http", "path": path, "raw_path": path.encode(), "root_path": "",
             "query_string": urlencode(query or {}).encode(), "headers": headers,
             "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 80)}
    sent = []

    async def receive():
        return {"type": "http.request", "body": payload, "more_body": False}

    async def send(message):
        sent.append(message)

    try:
        await main.app(scope, receive, send)
    except RuntimeError:
        if not sent:
            raise
    start = next(item for item in sent if item["type"] == "http.response.start")
    raw = b"".join(item.get("body", b"") for item in sent if item["type"] == "http.response.body")
    try:
        data = json.loads(raw)
    except ValueError:
        data = raw.decode()
    return start["status"], dict(start.get("headers", [])), data


@main.app.get("/api/probe/error")
async def failed_request():
    raise RuntimeError("private-sentinel body cookie database path")


@main.app.get("/api/probe/{trace_id}")
async def parameter_request(trace_id: str):
    await asyncio.sleep(.005)
    return {"ok": True}


async def csv_capacity():
    release = threading.Event()
    lock = threading.Lock()
    entered = 0

    def blocked(settings, *args):
        nonlocal entered
        with lock:
            entered += 1
        release.wait(3)
        return {"first_time": None}

    query = {"tag": "raw-tag ", "start": "2025-03-01T00:00", "end": "2025-03-02T00:00"}
    main.app.state.boiler = SimpleNamespace(settings=None, registry={"raw-tag ": {"unit": "°C"}})
    with patch.object(main, "history_metadata", blocked), patch.object(main, "history_range", blocked):
        pending = [asyncio.create_task(request("/api/history/metadata")), asyncio.create_task(request("/api/history/range", query=query))]
        try:
            deadline = time.monotonic() + 2
            while entered < 2 and time.monotonic() < deadline:
                await asyncio.sleep(.01)
            check("metadata and range share two execution slots", entered == 2, entered=entered)
            try:
                status, headers, _ = await asyncio.wait_for(request("/api/history/metadata"), .4)
            except TimeoutError:
                status, headers = 0, {}
            check("saturated CSV returns immediate 429 with Retry-After", status == 429 and headers.get(b"retry-after") == b"1", status=status)
            status, _, _ = await request("/api/health")
            check("health responds while CSV readers wait", status == 200)
        finally:
            release.set()
            responses = await asyncio.gather(*pending)
        check("accepted CSV requests complete", all(item[0] == 200 for item in responses))
        status, _, _ = await request("/api/history/metadata")
        check("CSV slot is reusable after success", status == 200)
    with patch.object(main, "history_metadata", side_effect=OSError("private-sentinel")):
        status, _, _ = await request("/api/history/metadata")
        check("CSV failure retains safe 503", status == 503)
    with patch.object(main, "history_metadata", return_value={"first_time": None}):
        status, _, _ = await request("/api/history/metadata")
        check("CSV slot is reusable after failure", status == 200)
    release.clear()
    entered = 0
    with patch.object(main, "history_metadata", blocked):
        pending = [asyncio.create_task(request("/api/history/metadata")) for _ in range(2)]
        try:
            deadline = time.monotonic() + 2
            while entered < 2 and time.monotonic() < deadline:
                await asyncio.sleep(.01)
            pending[0].cancel()
            await asyncio.gather(pending[0], return_exceptions=True)
            status, _, _ = await request("/api/history/metadata")
            check("cancelled HTTP request retains its CSV slot until the reader exits", status == 429, status=status)
        finally:
            release.set()
            await asyncio.gather(*pending, return_exceptions=True)


async def observability():
    status, headers, _ = await request("/api/probe/private-sentinel", query={"access_key": "private-sentinel"})
    request_id = headers.get(b"x-request-id", b"").decode()
    matching = [item for item in records if item.get("request_id") == request_id]
    check("request ID joins response and structured completion log", status == 200 and len(request_id) >= 16 and len(matching) == 1)
    check("route is normalized and latency measured", bool(matching) and matching[0].get("route") == "/api/probe/{trace_id}" and matching[0].get("duration_ms", -1) >= 3)
    status, headers, data = await request("/api/probe/error")
    check("unhandled errors have stable safe JSON and request ID", status == 500 and isinstance(data, dict) and data.get("code") == "internal_error"
          and data.get("request_id") == headers.get(b"x-request-id", b"").decode(), status=status)
    def broken_storage(principal):
        raise sqlite3.OperationalError("private-sentinel database path")
    main.app.state.simulator = SimpleNamespace(snapshot=broken_storage)
    status, _, data = await request("/api/simulator")
    check("SQLite storage failure has a safe stable error code", status == 500 and isinstance(data, dict) and data.get("code") == "internal_error")
    await request("/api/private-sentinel/one")
    await request("/api/private-sentinel/two")
    for kwargs, expected in [({"token": None}, 401), ({"host": "invalid.test"}, 400)]:
        status, headers, _ = await request("/api/state", **kwargs)
        check(f"early HTTP denial {expected} is traced", status == expected and bool(headers.get(b"x-request-id")))
    status, _, _ = await request("/api/metrics/http", token="fixture-viewer")
    check("viewer cannot read HTTP metrics", status == 403, status=status)
    status, _, data = await request("/api/metrics/http")
    routes = data.get("routes", []) if isinstance(data, dict) else []
    failed = next((item for item in routes if item.get("route") == "/api/probe/error"), {})
    check("operator reads per-route status and latency metrics", status == 200 and failed.get("server_errors") == 1
          and failed.get("count") == 1 and failed.get("avg_duration_ms", -1) >= 0 and failed.get("max_duration_ms", -1) >= 0)
    unknown = next((item for item in routes if item.get("route") == "unmatched" and item.get("method") == "GET"), {})
    check("unknown URLs share one bounded metrics label", unknown.get("count") == 2)
    check("client-provided request ID is replaced", bool(request_id) and request_id != "private-sentinel")
    serialized = json.dumps(records, ensure_ascii=False)
    check("logs omit raw parameters, query, cookie, body and exception text", "private-sentinel" not in serialized and "fixture-operator" not in serialized)
    check("unhandled error log has safe error type", any(item.get("status") == 500 and item.get("error_type") == "RuntimeError" for item in records))


async def run():
    security = object.__new__(Security)
    security.hostname, security.origin = "127.0.0.1", "http://127.0.0.1"
    security.buckets, security.sessions = {}, {}
    for role in ("operator", "viewer"):
        token = "fixture-" + role
        security.sessions[hashlib.sha256(token.encode()).hexdigest()] = Session(Principal(role, role), time.time() + 60)
    main.app.state.security = security
    main.app.state.boiler = SimpleNamespace(snapshot=lambda: {"ok": True})
    logger = logging.getLogger("uvicorn.error")
    handler = Capture()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    try:
        await csv_capacity()
        await observability()
    finally:
        logger.removeHandler(handler)


if __name__ == "__main__":
    asyncio.run(run())
    report = {"passed": all(item["passed"] for item in results), "checks": results,
              "scope": "Actual ASGI app and authentication; in-memory fixture sessions, blocked fake CSV reads; no lifespan, DB, Kafka, secrets or model"}
    output = Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/operational-reliability.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(0 if report["passed"] else 1)
