"""The ToolSpec plugin contract — registration, binding, mode routing, catalog derivation."""
from __future__ import annotations

import asyncio
import unittest

from cyberbox.services import toolspec


class ToolSpecContractTest(unittest.TestCase):
    def test_builtin_specs_registered(self) -> None:
        names = {s.name for s in toolspec.all_specs()}
        self.assertTrue({"subfinder", "httpx", "nuclei", "ffuf", "vulnx"} <= names)

    def test_executable_builtins_have_runners_bound(self) -> None:
        # Importing tool_runner binds the async handlers to their specs.
        from cyberbox.services import tool_runner  # noqa: F401
        for name in ("subfinder", "httpx", "nuclei", "ffuf"):
            self.assertIsNotNone(toolspec.get(name).runner, f"{name} runner not bound")

    def test_retrofitted_tools_bind_runners_on_import(self) -> None:
        # engines.py binds the vulnx runner; screenshots.py registers+binds gowitness.
        from cyberbox.services import engines, screenshots  # noqa: F401
        vulnx = toolspec.get("vulnx")
        self.assertIsNotNone(vulnx.runner)
        self.assertTrue(vulnx.allows_mode("ai") and vulnx.allows_mode("manual"))
        self.assertEqual(vulnx.scope_required, 0)       # intel-only, no target
        gw = toolspec.get("gowitness")
        self.assertIsNotNone(gw)
        self.assertIsNotNone(gw.runner)
        self.assertEqual(gw.danger_tier, "active")      # live GET to the target
        self.assertEqual(gw.scope_required, 1)

    def test_importing_tool_runner_binds_every_builtin(self) -> None:
        # Guards the harden-import: a campaign can queue gowitness/vulnx, and _dispatch_tool
        # must resolve them even if screenshots/engines weren't imported elsewhere. Importing
        # the runner alone must leave all six built-ins registered AND bound.
        from cyberbox.services import tool_runner  # noqa: F401
        for name in ("subfinder", "httpx", "nuclei", "ffuf", "vulnx", "gowitness"):
            spec = toolspec.get(name)
            self.assertIsNotNone(spec, f"{name} spec missing")
            self.assertIsNotNone(spec.runner, f"{name} runner not bound after tool_runner import")

    def test_bad_danger_tier_rejected(self) -> None:
        with self.assertRaises(ValueError):
            toolspec.ToolSpec(name="x", category="recon", danger_tier="nuclear",
                              scope_required=1, description="")

    def test_bad_mode_rejected(self) -> None:
        with self.assertRaises(ValueError):
            toolspec.ToolSpec(name="x", category="recon", danger_tier="passive",
                              scope_required=1, description="", modes=("telepathy",))

    def test_bind_runner_unknown_tool_raises(self) -> None:
        async def _noop(*_a):  # pragma: no cover - never called
            return (0, None)
        with self.assertRaises(KeyError):
            toolspec.bind_runner("does-not-exist", _noop)

    def test_catalog_rows_cover_every_spec(self) -> None:
        self.assertEqual(len(toolspec.catalog_rows()), len(toolspec.all_specs()))
        row = next(r for r in toolspec.catalog_rows() if r["name"] == "nuclei")
        self.assertEqual(row["danger_tier"], "active")
        self.assertEqual(row["scope_required"], 1)

    def test_register_and_dispatch_a_custom_spec(self) -> None:
        # A plugin can register a spec + runner and immediately be AI-dispatchable.
        calls: list[str] = []

        async def _runner(campaign_id, project_id, args, execution_id, phase, max_runtime):
            calls.append(project_id)
            return (0, {"ok": True})

        toolspec.register(toolspec.ToolSpec(
            name="_test_plugin", category="recon", danger_tier="passive",
            scope_required=1, description="unit-test plugin", modes=("manual", "ai")))
        toolspec.bind_runner("_test_plugin", _runner)
        spec = toolspec.get("_test_plugin")
        self.assertTrue(spec.allows_mode("ai"))
        rc, result = asyncio.run(spec.runner(None, "proj-1", {}, "exec-1", "recon", 60))
        self.assertEqual(rc, 0)
        self.assertEqual(calls, ["proj-1"])
        # cleanup so other tests see a clean registry
        toolspec._SPECS.pop("_test_plugin", None)


if __name__ == "__main__":
    unittest.main()
