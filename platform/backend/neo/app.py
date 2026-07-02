"""Neo FastAPI application entrypoint."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect

from . import db, seed
from .auth import bootstrap_admin, current_user
from .config import get_settings
from .hub import hub
from . import __version__


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_settings().ensure_dirs()
    db.init_db()
    seed.seed()
    bootstrap_admin()
    hub.bind_loop(asyncio.get_running_loop())
    yield


app = FastAPI(title="Neo", version=__version__, lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


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
