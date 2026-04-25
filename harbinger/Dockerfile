## harbinger — runtime image with Playwright + Chromium for phase_validate evidence capture.
## Built on python:3.11-slim to keep size down; Chromium is the only browser we need.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    HARBINGER_DIR=/work \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# System packages: jq for JSONL parsing, curl for AI helpers, ca-certs for TLS,
# and Playwright's documented Debian dependencies for headless Chromium.
RUN apt-get update && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        jq \
        # Playwright Chromium runtime deps (subset of `playwright install-deps`)
        libnss3 \
        libnspr4 \
        libdbus-1-3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libpango-1.0-0 \
        libcairo2 \
        libasound2 \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/harbinger

# Install Playwright Python + Chromium binaries.
# We pin the same range as pyproject.toml so the Docker build and local dev stay aligned.
RUN pip install "playwright>=1.45,<2.0" \
    && playwright install chromium \
    && playwright --version

# Copy harbinger sources after deps so dependency layer caches across edits.
COPY bin/ /opt/harbinger/bin/
RUN chmod +x /opt/harbinger/bin/*

# Make the helpers discoverable on PATH.
ENV PATH="/opt/harbinger/bin:${PATH}"

WORKDIR /work
ENTRYPOINT ["/opt/harbinger/bin/harbinger"]
CMD ["--help"]
