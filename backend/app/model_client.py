import json
import os
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

MODEL_OPTIONS = {"temperature": 0, "seed": 7, "num_predict": 220, "num_ctx": 8192}


class NoModelRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        raise ValueError("Model endpoint redirects are not allowed")


def model_json(messages, schema):
    base, model = os.getenv("OLLAMA_BASE_URL"), os.getenv("OLLAMA_MODEL")
    if not base or not model:
        raise ValueError("OLLAMA_BASE_URL and OLLAMA_MODEL are required for Agent queries")
    parsed = urlparse(base)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1") or parsed.username or parsed.password:
        raise ValueError("Agent model endpoint must be a local Ollama HTTP endpoint")
    body = {"model": model, "messages": messages, "stream": False, "format": schema,
            "options": MODEL_OPTIONS}
    request = Request(base.rstrip('/') + '/api/chat', data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with build_opener(ProxyHandler({}), NoModelRedirect()).open(request, timeout=180) as response:
        data = response.read(256 * 1024 + 1)
        if len(data) > 256 * 1024:
            raise ValueError("Model response size limit exceeded")
        payload = json.loads(data)
    return json.loads(payload["message"]["content"])
