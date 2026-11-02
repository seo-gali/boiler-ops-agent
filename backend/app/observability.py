import asyncio
import json
import logging
from time import perf_counter
from uuid import uuid4

from starlette.responses import JSONResponse
from starlette.routing import Match

logger = logging.getLogger("uvicorn.error")


class HttpObservability:
    def __init__(self, app, owner):
        self.app, self.owner = app, owner

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        started, status, response_started, error_type = perf_counter(), 499, False, None

        async def traced_send(message):
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                status, response_started = message["status"], True
                message["headers"] = [(key, value) for key, value in message.get("headers", []) if key.lower() != b"x-request-id"]
                message["headers"].append((b"x-request-id", request_id.encode()))
            await send(message)

        try:
            await self.app(scope, receive, traced_send)
        except asyncio.CancelledError:
            status = 499
            raise
        except Exception as error:
            status, error_type = 500, type(error).__name__
            if response_started:
                raise
            await JSONResponse({"code": "internal_error", "detail": "요청을 완료하지 못했습니다. 잠시 후 다시 확인하세요.",
                                "request_id": request_id}, status_code=500,
                               headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})(scope, receive, traced_send)
        finally:
            route = getattr(scope.get("route"), "path", None)
            if route is None:
                route = next((item.path for item in self.owner.routes if item.matches(scope)[0] != Match.NONE), "unmatched")
            method = scope["method"] if scope["method"] in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} else "OTHER"
            duration = (perf_counter() - started) * 1000
            entry = self.owner.state.http_metrics.setdefault((method, route), {
                "count": 0, "client_errors": 0, "server_errors": 0, "status_counts": {}, "total_duration_ms": 0., "max_duration_ms": 0.,
            })
            entry["count"] += 1
            entry["client_errors"] += int(400 <= status < 500)
            entry["server_errors"] += int(status >= 500)
            entry["status_counts"][status] = entry["status_counts"].get(status, 0) + 1
            entry["total_duration_ms"] += duration
            entry["max_duration_ms"] = max(entry["max_duration_ms"], duration)
            record = {"event": "http_request", "request_id": request_id, "method": method, "route": route,
                      "status": status, "duration_ms": round(duration, 3)}
            if error_type:
                record["error_type"] = error_type
            logger.log(logging.ERROR if status >= 500 else logging.INFO, json.dumps(record, ensure_ascii=False))
