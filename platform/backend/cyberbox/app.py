"""CyberBox FastAPI application entrypoint."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from . import db, seed
from .auth import bootstrap_admin, current_user
from .config import get_settings
from .hub import hub
from .routers import api
from . import __version__

TITLE = "CyberBox"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_settings().ensure_dirs()
    db.init_db()
    seed.seed()
    bootstrap_admin()
    hub.bind_loop(asyncio.get_running_loop())
    yield


app = FastAPI(title=TITLE, version=__version__, lifespan=lifespan)
app.include_router(api.router)


@app.get("/", response_class=HTMLResponse)
def root() -> str:
    settings = get_settings()
    base = f"http://{settings.host}:{settings.port}"
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{TITLE}</title>
  <style>
    :root {{
      --cb-ink: #0b0f17;
      --cb-violet-500: #8b5cf6;
      --cb-violet-400: #a78bfa;
      --cb-violet-200: #ddd6fe;
    }}
    body {{
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      max-width: 52rem;
      margin: 3rem auto;
      padding: 0 1rem;
      color: var(--cb-violet-200);
      background: var(--cb-ink);
      line-height: 1.5;
    }}
    h1 {{
      color: var(--cb-violet-400);
      letter-spacing: -0.02em;
      font-weight: 700;
    }}
    a {{ color: var(--cb-violet-500); }}
    a:hover {{ color: var(--cb-violet-400); }}
    code {{
      background: #111827;
      padding: 0.1rem 0.35rem;
      border-radius: 0.25rem;
      font-family: "JetBrains Mono", ui-monospace, monospace;
    }}
    .card {{
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 0.75rem;
      padding: 1rem 1.25rem;
      margin: 1rem 0;
    }}
    .tag {{
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--cb-violet-500);
      margin-bottom: 0.5rem;
    }}
  </style>
</head>
<body>
  <p class="tag">Local platform</p>
  <h1>{TITLE}</h1>
  <p>Local-first security testing platform. API is running.</p>
  <div class="card">
    <p><strong>Quick links</strong></p>
    <ul>
      <li><a href="{base}/health">Health</a></li>
      <li><a href="{base}/docs">API docs</a></li>
      <li><a href="{base}/redoc">ReDoc</a></li>
      <li><a href="{base}/ws">WebSocket hub</a> (connect from client)</li>
    </ul>
  </div>
  <div class="card">
    <p><strong>Auth</strong></p>
    <p>Send your admin key as <code>X-Api-Key</code> or <code>Authorization: Bearer …</code>.</p>
    <p>Key file: <code>~/.cyberbox/admin.key</code></p>
  </div>
  <div class="card">
    <p><strong>Start from repo</strong></p>
    <pre><code>./bin/cyberbox start</code></pre>
  </div>
</body>
</html>"""


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "cyberbox", "version": __version__}


@app.get("/me")
def me(user: dict = Depends(current_user)) -> dict:
    return {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await hub.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(ws)
