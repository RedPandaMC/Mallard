"""Run inside the server container by .github/workflows/e2e.yml via `docker
compose exec`, POSTing an ingest payload with the API key given as argv[1]
and printing the status code (line 1) and body (remaining lines). Used both
for the happy path (the seeded key, expect 202) and the negative control
(a wrong key, expect 401).
"""

import sys

import httpx

api_key = sys.argv[1]
r = httpx.post(
    "http://localhost:8080/api/v1/ingest",
    headers={"X-API-Key": api_key},
    json={
        "instance_id": "e2e-instance",
        "schema_version": 3,
        "ts": 1700000000000,
        "mtd_credits": 42.5,
        "mtd_cost_usd": 1.5,
        "today_credits": 3.5,
        "today_cost_usd": 0.2,
        "active_models": ["claude-sonnet-4-5"],
        "top_model": "claude-sonnet-4-5",
    },
)
print(r.status_code)
print(r.text)
