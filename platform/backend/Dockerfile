FROM python:3.13-slim@sha256:eb43ff125d8d58d7449dcba7d336c23bcac412f526d861db493b9994d8010280

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY pyproject.toml /app/pyproject.toml
COPY uv.lock /app/uv.lock
COPY cyberbox/ /app/cyberbox/
RUN python -m pip install --no-cache-dir uv==0.11.6 \
 && uv sync --frozen --no-dev --no-editable \
 && useradd --uid 1000 --create-home --shell /usr/sbin/nologin cyberbox \
 && mkdir -p /data \
 && chown 1000:1000 /data

USER 1000:1000
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=4 \
  CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/health', timeout=2)"]

CMD ["/app/.venv/bin/uvicorn", "cyberbox.app:app", "--host", "0.0.0.0", "--port", "8787", "--root-path", "/control"]
