# ── Build stage ───────────────────────────────────────────────────────────────
FROM python:3.14-slim AS builder

WORKDIR /build

RUN pip install --no-cache-dir uv

COPY pyproject.toml .
# Install into a self-contained venv instead of system site-packages: copying
# /usr/local/lib/pythonX.Y/site-packages hardcoded the interpreter minor
# version and silently broke on base-image bumps (it already bit once with
# 3.13→3.14). The venv path is version-independent; both stages use the same
# base image so the interpreter symlink inside the venv stays valid.
RUN uv venv /opt/venv && uv pip install --python /opt/venv/bin/python --no-cache .

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.14-slim

WORKDIR /app

RUN groupadd -r -g 1000 mallard && useradd -r -u 1000 -g mallard mallard

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY src/server/*.py ./server/
COPY src/server/routers/ ./server/routers/

USER mallard

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8080"]
