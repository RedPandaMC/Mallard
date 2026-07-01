"""Run inside the server container by .github/workflows/e2e.yml via `docker
compose exec`, hitting the server's own localhost — the same access path its
Dockerfile HEALTHCHECK already uses. Not run against a host-published port:
see the comment at the top of e2e.yml for why.
"""

import sys

import httpx

try:
    ok = httpx.get("http://localhost:8080/health", timeout=3).status_code == 200
except Exception:
    ok = False
sys.exit(0 if ok else 1)
