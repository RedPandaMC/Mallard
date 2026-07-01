# ── Build stage ───────────────────────────────────────────────────────────────
FROM python:3.14-slim AS builder

WORKDIR /build

RUN pip install --no-cache-dir uv

COPY pyproject.toml .
RUN uv pip install --system --no-cache .

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.14-slim

WORKDIR /app

RUN groupadd -r -g 1000 mallard && useradd -r -u 1000 -g mallard mallard

COPY --from=builder /usr/local/lib/python3.14/site-packages /usr/local/lib/python3.14/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY src/server/*.py ./server/
COPY src/server/routers/ ./server/routers/

USER mallard

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8080"]
