"""Tool registry — catalogs executable tools and the danger tier that gates policy.

The registry is the single source of truth for "what can run and how dangerous is it".
danger_tier maps to a policy risk_class so the tool runner never hardcodes per-tool risk.
Built-in tools are curated here with verified tiers. The ~/Tools arsenal is imported as
DISABLED, pending-review rows (source='inventory') — model-catalogued data never auto-arms
a security-gating table; an operator promotes entries explicitly.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from .. import db

# danger_tier → policy risk_class. Conservative: an unknown/active tool needs approval
# under balanced autonomy, exploit tools need explicit approval, only passive runs freely.
TIER_RISK = {"passive": "passive", "active": "state-changing", "exploit": "destructive"}
_FALLBACK_RISK = "state-changing"  # default-deny friendly for unregistered tools

# category → (danger_tier, scope_required). Local-analysis categories don't hit the network.
CATEGORY_DEFAULT = {
    "recon":           ("active", 1),
    "fuzzer":          ("active", 1),
    "scanner":         ("active", 1),
    "exploit":         ("exploit", 1),
    "osint":           ("active", 1),
    "source-analysis": ("passive", 0),
    "binary":          ("passive", 0),
    "mobile":          ("passive", 0),
    "utility":         ("passive", 0),
}

# Verified built-ins the tool runner dispatches today.
BUILTIN_TOOLS = [
    {"name": "subfinder", "category": "recon", "danger_tier": "passive", "scope_required": 1,
     "description": "Passive subdomain enumeration (API-driven)"},
    {"name": "httpx", "category": "recon", "danger_tier": "active", "scope_required": 1,
     "description": "Live HTTP probing and tech detection"},
    {"name": "nuclei", "category": "scanner", "danger_tier": "active", "scope_required": 1,
     "description": "Template-based vulnerability scanning"},
    {"name": "ffuf", "category": "fuzzer", "danger_tier": "active", "scope_required": 1,
     "description": "Content/endpoint fuzzing"},
    {"name": "vulnx", "category": "osint", "danger_tier": "passive", "scope_required": 0,
     "description": "ProjectDiscovery vulnerability.sh CVE intel (search/analyze) — tags/CWE/KEV/EPSS; "
                    "feeds the vulnx coverage engine. Queries intel API only, never the target."},
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def seed() -> None:
    """Upsert the verified built-in tools. Idempotent."""
    for tool in BUILTIN_TOOLS:
        db.upsert(
            "tool_registry",
            {"id": str(uuid.uuid4()), "name": tool["name"], "category": tool["category"],
             "description": tool.get("description"), "danger_tier": tool["danger_tier"],
             "scope_required": tool["scope_required"], "binary_path": None, "invocation": None,
             "output_parser": None, "approval": "auto", "source": "builtin", "enabled": 1,
             "created_at": _now()},
            conflict_cols=["name"],
            update_cols=["category", "description", "danger_tier", "scope_required"],
        )


def get_tool(name: str) -> dict | None:
    row = db.query_one("SELECT * FROM tool_registry WHERE name=?", [name])
    return db.decode_row(row) if row else None


def list_tools(category: str | None = None, enabled_only: bool = False) -> list[dict]:
    sql = "SELECT * FROM tool_registry"
    clauses, params = [], []
    if category:
        clauses.append("category=?")
        params.append(category)
    if enabled_only:
        clauses.append("enabled=1")
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY category, name"
    return [db.decode_row(r) for r in db.query(sql, params)]


def risk_class_for(name: str) -> str:
    """Policy risk_class for a tool. Conservative fallback keeps unknown tools gated."""
    tool = get_tool(name)
    if not tool:
        return _FALLBACK_RISK
    return TIER_RISK.get(tool["danger_tier"], _FALLBACK_RISK)


def import_inventory(path: str) -> dict:
    """Import a pipe-delimited inventory (name|category|description) as DISABLED,
    pending-review rows. Returns counts. Existing names are left untouched."""
    import os
    if not os.path.isfile(path):
        return {"imported": 0, "skipped": 0, "error": "file not found"}
    imported = skipped = 0
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            parts = [p.strip() for p in line.rstrip("\n").split("|")]
            if len(parts) < 2 or not parts[0]:
                continue
            name, category = parts[0], parts[1]
            description = parts[2] if len(parts) > 2 else None
            if category not in CATEGORY_DEFAULT:
                category = "utility"
            if db.query_one("SELECT id FROM tool_registry WHERE name=?", [name]):
                skipped += 1
                continue
            tier, scope_required = CATEGORY_DEFAULT[category]
            db.insert("tool_registry", {
                "id": str(uuid.uuid4()), "name": name, "category": category,
                "description": description, "danger_tier": tier,
                "scope_required": scope_required, "binary_path": None, "invocation": None,
                "output_parser": None, "approval": "auto", "source": "inventory",
                "enabled": 0, "created_at": _now(),
            })
            imported += 1
    return {"imported": imported, "skipped": skipped}
