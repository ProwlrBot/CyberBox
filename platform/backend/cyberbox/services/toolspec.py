"""ToolSpec — the single plugin contract every tool is declared through.

One spec per tool carries everything the rest of the platform needs to route to it:
  - catalog + policy metadata (category, danger_tier, scope_required) — read by tool_registry
  - which modes may reach it (manual operator, AI orchestrator, or both)
  - the taxonomy classes its evidence covers (the engine/coverage axis)
  - how to run it (an async `runner`, bound by the module that implements it)
  - an optional availability probe

Register a spec once and BOTH execution paths resolve from it:
  - manual mode  → the generic POST /tools/{name}/run route
  - AI mode      → tool_runner._dispatch_tool (campaign orchestrator)

The spec's metadata lives here and is importable with no service dependencies, so the
catalog can be seeded at startup before any runner binds. The heavy `runner` callable is
attached later via bind_runner() by whichever module implements the tool — this keeps the
contract free of circular imports.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Awaitable, Callable, Optional

# An async runner shares the tool_runner signature:
#   (campaign_id, project_id, args, execution_id, phase, max_runtime) -> (returncode, result)
Runner = Callable[[Optional[str], str, dict, str, str, int], Awaitable[tuple[int, object]]]

_MODES = ("manual", "ai")
_TIERS = ("passive", "active", "exploit")


@dataclass(frozen=True)
class ToolSpec:
    name: str
    category: str
    danger_tier: str                     # passive | active | exploit  (→ policy risk_class)
    scope_required: int                  # 0 = intel-only (no target), 1 = needs in-scope target
    description: str
    modes: tuple[str, ...] = _MODES      # which operating modes may route to this tool
    covers: tuple[str, ...] = ()         # taxonomy class-ids this tool's evidence reaches
    phase: str = "recon"                 # default hunt phase for progress/labelling
    runner: Optional[Runner] = None      # bound by the implementing module; None = catalog-only
    available: Optional[Callable[[], bool]] = None

    def __post_init__(self) -> None:
        if self.danger_tier not in _TIERS:
            raise ValueError(f"bad danger_tier {self.danger_tier!r} for tool {self.name}")
        for m in self.modes:
            if m not in _MODES:
                raise ValueError(f"bad mode {m!r} for tool {self.name}")

    def allows_mode(self, mode: str) -> bool:
        return mode in self.modes

    def is_available(self) -> bool:
        return self.available() if self.available else True


_SPECS: dict[str, ToolSpec] = {}


def register(spec: ToolSpec) -> ToolSpec:
    """Register (or replace) a tool spec. Returns the stored spec. Idempotent by name."""
    _SPECS[spec.name] = spec
    return spec


def bind_runner(name: str, runner: Runner, available: Optional[Callable[[], bool]] = None) -> None:
    """Attach the execution callable (and optional availability probe) to an already-registered
    spec. Called by the module that implements the tool, after its functions are defined."""
    spec = _SPECS.get(name)
    if spec is None:
        raise KeyError(f"no spec registered for tool {name!r} — register() it before bind_runner()")
    _SPECS[name] = replace(spec, runner=runner,
                           available=available if available is not None else spec.available)


def get(name: str) -> Optional[ToolSpec]:
    return _SPECS.get(name)


def all_specs() -> list[ToolSpec]:
    return list(_SPECS.values())


def specs_for_mode(mode: str) -> list[ToolSpec]:
    return [s for s in _SPECS.values() if s.allows_mode(mode)]


def catalog_rows() -> list[dict]:
    """Rows for tool_registry to seed the catalog table from — one per spec."""
    return [
        {"name": s.name, "category": s.category, "danger_tier": s.danger_tier,
         "scope_required": s.scope_required, "description": s.description}
        for s in _SPECS.values()
    ]


# ── Built-in tool specs ────────────────────────────────────────────────────────
# Metadata only; the executable `runner` for each is bound by tool_runner once its
# async handlers are defined. Catalog-only tools (their own dedicated route) leave
# runner None but still declare their modes/tier so the catalog and policy agree.

register(ToolSpec(
    name="subfinder", category="recon", danger_tier="passive", scope_required=1,
    description="Passive subdomain enumeration (API-driven)", phase="recon"))
register(ToolSpec(
    name="httpx", category="recon", danger_tier="active", scope_required=1,
    description="Live HTTP probing and tech detection", phase="recon"))
register(ToolSpec(
    name="nuclei", category="scanner", danger_tier="active", scope_required=1,
    description="Template-based vulnerability scanning", phase="fuzz"))
register(ToolSpec(
    name="ffuf", category="fuzzer", danger_tier="active", scope_required=1,
    description="Content/endpoint fuzzing", phase="fuzz"))
# vulnx: passive intel (no target), reachable in both modes. Its AI runner is bound by
# engines.py (which owns apply_vulnx_hit coverage); gowitness's runner is bound by
# screenshots.py. Each implementing module declares/binds its own tool — the plugin pattern.
register(ToolSpec(
    name="vulnx", category="osint", danger_tier="passive", scope_required=0,
    description="ProjectDiscovery vulnerability.sh CVE intel (search/analyze) — tags/CWE/KEV/EPSS; "
                "feeds the vulnx coverage engine. Queries intel API only, never the target.",
    modes=("manual", "ai"), phase="recon"))
