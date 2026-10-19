"""실제 HTTP 라우트의 입력 경계·동시 응답과 격리 SQLite 조회 검증.

서버 lifespan, 인증 저장소, 모델, Kafka 및 디스크 DB를 시작하지 않는다.
"""
import asyncio
import csv
import json
import sqlite3
import sys
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from backend.app import main
from backend.app.agent.service import AgentFailure
from backend.app.simulator.service import Simulator
from backend.app.config import Settings
from backend.app.domain import history

principal = SimpleNamespace(user_id="fixture", role="operator")
app = FastAPI()
app.router.routes.extend(main.app.router.routes)
app.add_exception_handler(RequestValidationError, main.validation_error)
results = []


def check(name, passed, **observed):
    results.append({"name": name, "passed": bool(passed), **observed})


async def request(path, body=None, query=None):
    sent = []
    payload = json.dumps(body).encode() if body is not None else b""
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": "POST" if body is not None else "GET", "scheme": "http",
             "path": path, "raw_path": path.encode(), "query_string": urlencode(query or {}).encode(),
             "headers": [(b"content-type", b"application/json")],
             "client": ("127.0.0.1", 1), "server": ("test", 80), "root_path": "",
             "state": {"principal": principal}}

    async def receive():
        return {"type": "http.request", "body": payload, "more_body": False}

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    status = next(item["status"] for item in sent if item["type"] == "http.response.start")
    content = b"".join(item.get("body", b"") for item in sent if item["type"] == "http.response.body")
    return status, json.loads(content)


class Security:
    calls = 0
    failure = None

    async def model_work(self, user, work):
        self.calls += 1
        if self.failure:
            raise self.failure
        return {"accepted": True}

    def operator(self, user):
        assert user.role == "operator"


async def boundaries():
    security = Security()
    main.app.state.security = security
    main.app.state.boiler = SimpleNamespace(
        registry={"tag ": {"equipment": "reheater", "unit": "°C"}},
        current=None, history=[], snapshot=lambda: {})
    for path, field, extra in [
        ("/api/agent/query", "question", {"equipment": "reheater", "tag": "tag "}),
        ("/api/simulator/proposals", "intent", {"source_trace_id": "00000000-0000-0000-0000-000000000001"}),
    ]:
        for value in ("", "   ", "\t\r\n", "\u3000"):
            before = security.calls
            status, data = await request(path, {**extra, field: value})
            check(f"{field}: blank {value!r}", status == 422 and security.calls == before,
                  status=status, model_calls=security.calls - before)
    status, _ = await request("/api/agent/query", {"question": " current value? ", "equipment": "reheater", "tag": "tag "})
    check("nonblank question and raw trailing-space tag preserved", status == 200, status=status)
    for path, query in [("/api/sensors/history", {"tag": ""}), ("/api/history/range", {
        "tag": " ", "start": "2025-03-01", "end": "2025-03-02"})]:
        status, _ = await request(path, query=query)
        check(f"{path}: empty tag never lists all sensors", status == 404, status=status)
    for path, failure, body, code in [
        ("/api/agent/query", AgentFailure("test-trace", "private-sentinel internal path"),
         {"question": "value?", "equipment": "reheater", "tag": "tag "}, "agent_unavailable"),
        ("/api/simulator/proposals", ValueError("private-sentinel internal path"),
         {"intent": "increase", "source_trace_id": "00000000-0000-0000-0000-000000000001"}, "simulator_unavailable"),
    ]:
        security.failure = failure
        status, data = await request(path, body)
        detail = data.get("detail")
        response_code = detail.get("code") if isinstance(detail, dict) else data.get("code")
        compatible = isinstance(detail, dict) and detail.get("trace_id") == "test-trace" if path.endswith("/query") else isinstance(detail, str)
        check(f"{path}: safe service error", status == 503 and response_code == code and compatible
              and "private-sentinel" not in json.dumps(data), status=status, response=data)
    security.failure = None


async def responsiveness():
    for path, method, body in [
        ("/api/simulator", "snapshot", None),
        ("/api/simulator/audit", "audit_log", None),
        ("/api/simulator/proposals/00000000-0000-0000-0000-000000000001/decision", "decide",
         {"approve": False, "confirm": True, "expected_revision": 0}),
    ]:
        started, release = threading.Event(), threading.Event()

        def blocked(*args):
            started.set()
            release.wait(1)
            return {"done": True}

        main.app.state.simulator = SimpleNamespace(**{method: blocked})
        pending = asyncio.create_task(request(path, body))
        try:
            await asyncio.to_thread(started.wait, 2)
            health_status, _ = await request("/api/health")
            concurrent = not pending.done()
            check(f"{method}: health responds while storage waits", health_status == 200 and concurrent,
                  health_status=health_status, storage_pending=concurrent)
        finally:
            release.set()
            await pending


def sql_queries():
    # 새 메모리 DB만 사용한다. 기존 데이터베이스를 열거나 삭제하지 않는다.
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript("""
        CREATE TABLE state (id INTEGER PRIMARY KEY, value INTEGER, revision INTEGER);
        INSERT INTO state VALUES (1,0,0);
        CREATE TABLE proposals (id TEXT PRIMARY KEY, payload TEXT, status TEXT, owner TEXT);
        CREATE INDEX proposals_owner ON proposals(owner);
        CREATE TABLE audit (id INTEGER PRIMARY KEY, owner TEXT, payload TEXT);
        CREATE INDEX audit_owner ON audit(owner,id);
    """)
    simulator = object.__new__(Simulator)

    @contextmanager
    def connection():
        yield db

    simulator.connection = connection
    statements = []
    db.set_trace_callback(statements.append)
    counts = []
    for total in (1, 20):
        for index in range(1 if total == 1 else 2, total + 1):
            db.execute("INSERT INTO proposals VALUES (?,?,?,?)", (str(index), "{}", "pending", "fixture"))
            db.execute("INSERT INTO audit VALUES (?,?,?)", (index, "fixture", "{}"))
        statements.clear()
        snapshot = simulator.snapshot(principal)
        snapshot_queries = sum(item.startswith("SELECT") for item in statements)
        statements.clear()
        audit = simulator.audit_log(principal)
        audit_queries = sum(item.startswith("SELECT") for item in statements)
        counts.append({"rows": total, "snapshot_queries": snapshot_queries, "audit_queries": audit_queries})
        check(f"SQL batch with {total} records", len(snapshot["proposals"]) == total and len(audit) == total
              and snapshot_queries == 2 and audit_queries == 1, **counts[-1])
    plans = [row[3] for row in db.execute("EXPLAIN QUERY PLAN SELECT * FROM audit WHERE owner=? AND id>? ORDER BY id LIMIT ?", ("fixture", 0, 50))]
    check("audit cursor uses owner index", any("audit_owner" in item for item in plans), plan=plans)
    db.close()


def history_queries():
    with TemporaryDirectory(prefix="boiler-history-performance-") as directory:
        dataset = Path(directory) / "history.csv"
        with dataset.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(["time", "sensor ", "other"])
            writer.writerows([[f"2025-01-01T00:0{index}:00", value, index]
                             for index, value in enumerate(["1.00", "", "bad", "3.50", "4.00"])])
        settings = Settings(dataset, 1000, "unused", "unused", "utf-8", "time", 5000, 120, 1)
        start, end = datetime(2025, 1, 1), datetime(2025, 1, 2)
        with patch.object(history, "rows", wraps=history.rows) as scans:
            original = history.query_range(settings, "sensor ", "°C", start, end, 3)
            first_scans = scans.call_count
            repeated = history.query_range(settings, "sensor ", "°C", start, end, 3)
            repeat_scans = scans.call_count - first_scans
            check("identical source range reuses successful result", repeated == original and repeat_scans == 0,
                  first_scans=first_scans, repeat_scans=repeat_scans)
            check("cached history retains raw values, quality and gaps",
                  original["tag"] == "sensor " and original["min"] == 1 and original["max"] == 4
                  and original["missing_count"] == 1 and original["parse_error_count"] == 1
                  and original["points"][0]["raw"] == "1.00" and original["points"][1]["gap_before"])
            other = history.query_range(settings, "other", "%", start, end, 2)
            check("source range separates tag, unit and sample limit",
                  other["tag"] == "other" and other["unit"] == "%" and other["sample_count"] == 2)
            with dataset.open("a", encoding="utf-8", newline="") as stream:
                csv.writer(stream).writerow(["2025-01-01T00:05:00", "5.00", "5"])
            updated = history.query_range(settings, "sensor ", "°C", start, end, 3)
            check("changed source invalidates cached range", updated["original_count"] == 6 and updated["max"] == 5,
                  original_count=updated["original_count"])


async def run():
    await boundaries()
    await responsiveness()
    sql_queries()
    history_queries()


if __name__ == "__main__":
    asyncio.run(run())
    report = {"passed": all(item["passed"] for item in results), "checks": results,
              "scope": "Actual HTTP routes after authentication; isolated services and in-memory SQLite. No production query timings."}
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("artifacts/api-performance.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(0 if report["passed"] else 1)
