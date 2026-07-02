"""CyberBox Neo HTTP API."""
from __future__ import annotations

import re
import threading
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..auth import current_user
from ..services import analytics, scanner, triage

router = APIRouter(prefix="/api/v1", tags=["api"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "project"


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=120)
    description: str = ""


class ScanCreate(BaseModel):
    target: str = Field(min_length=1, max_length=253)
    tool: str = "full"


@router.get("/projects")
def list_projects(_user: dict = Depends(current_user)) -> list[dict]:
    return db.query("SELECT * FROM projects ORDER BY created_at DESC")


@router.post("/projects", status_code=201)
def create_project(body: ProjectCreate, _user: dict = Depends(current_user)) -> dict:
    slug = body.slug or _slugify(body.name)
    if db.query_one("SELECT id FROM projects WHERE slug=?", [slug]):
        raise HTTPException(status_code=409, detail=f"project slug already exists: {slug}")
    project = {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "name": body.name,
        "description": body.description,
        "created_at": _now(),
    }
    db.insert("projects", project)
    return project


@router.get("/projects/{project_id}")
def get_project(project_id: str, _user: dict = Depends(current_user)) -> dict:
    project = db.query_one("SELECT * FROM projects WHERE id=?", [project_id])
    if not project:
        raise HTTPException(status_code=404, detail="project not found")
    return project


@router.get("/projects/{project_id}/analytics/score")
def project_score(project_id: str, _user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    return analytics.security_score(project_id)


@router.post("/projects/{project_id}/scans", status_code=202)
def start_scan(project_id: str, body: ScanCreate, _user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    scan = {
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "task_id": None,
        "target": body.target,
        "tool": body.tool,
        "status": "queued",
        "log": "",
        "stats": "{}",
        "started_at": None,
        "finished_at": None,
        "created_at": _now(),
    }
    db.insert("scans", scan)
    threading.Thread(target=scanner.run_full_scan, args=(scan["id"],), daemon=True).start()
    return scan


@router.get("/scans/{scan_id}")
def get_scan(scan_id: str, _user: dict = Depends(current_user)) -> dict:
    scan = db.query_one("SELECT * FROM scans WHERE id=?", [scan_id])
    if not scan:
        raise HTTPException(status_code=404, detail="scan not found")
    return scan


@router.get("/projects/{project_id}/vulnerabilities")
def list_vulnerabilities(project_id: str, _user: dict = Depends(current_user)) -> list[dict]:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    rows = db.query(
        "SELECT * FROM vulnerabilities WHERE project_id=? ORDER BY detected_at DESC",
        [project_id],
    )
    return [db.decode_row(r) for r in rows]


@router.post("/projects/{project_id}/triage")
def run_triage(project_id: str, _user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    return triage.auto_triage(project_id)
