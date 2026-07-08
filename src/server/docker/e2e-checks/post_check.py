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
        "schema_version": 1,
        "instance_id": "e2e-instance",
        "sent_at": 1700000000500,
        "tz_offset_minutes": 0,
        "events": [
            {
                "id": "e2e:1",
                "ts": 1700000000000,
                "connector": "local",
                "model": "claude-sonnet-4-5",
                "surface": "agent",
                "credits": 42.5,
                "cost_usd": 1.5,
                "estimated": True,
                "language": "python",
            }
        ],
    },
)
print(r.status_code)
print(r.text)
