"""ToolSpec integration tests for the passive Caido toolkit adapters."""
from __future__ import annotations

import asyncio
import tempfile
import unittest
from unittest import mock

from cyberbox.services import toolspec


class CaidoToolsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        from cyberbox.services import tool_runner  # noqa: F401

    def test_all_specs_are_registered_and_bound(self) -> None:
        for name in ("caido_query", "caido_jwt", "caido_harvest", "caido_analyze"):
            spec = toolspec.get(name)
            self.assertIsNotNone(spec, f"{name} spec missing")
            self.assertIsNotNone(spec.runner, f"{name} runner not bound")
            self.assertEqual(spec.scope_required, 0)
            self.assertEqual(spec.danger_tier, "passive")
            self.assertTrue(spec.allows_mode("manual"))
            self.assertTrue(spec.allows_mode("ai"))

    def test_query_rejects_non_read_only_subcommand_without_shelling_out(self) -> None:
        spec = toolspec.get("caido_query")
        with mock.patch(
            "cyberbox.services.caido_tools.asyncio.create_subprocess_exec"
        ) as create_process:
            rc, result = asyncio.run(spec.runner(
                None, "project-1", {"subcommand": "replay"},
                "execution-1", "recon", 30,
            ))
        self.assertEqual(rc, 1)
        self.assertEqual(result, {"error": "subcommand not permitted (read-only only)"})
        create_process.assert_not_called()

    def test_missing_scripts_degrade_gracefully(self) -> None:
        with tempfile.TemporaryDirectory() as empty_dir, mock.patch.dict(
            "os.environ", {"CYBERBOX_BOUNTY_TOOLS_DIR": empty_dir}
        ):
            for name in ("caido_query", "caido_jwt", "caido_harvest", "caido_analyze"):
                spec = toolspec.get(name)
                self.assertFalse(spec.is_available())
                args = {"host": "example.test"} if name == "caido_jwt" else {}
                rc, result = asyncio.run(spec.runner(
                    None, "project-1", args, "execution-1", "recon", 30,
                ))
                self.assertEqual(rc, 1)
                self.assertIsInstance(result, dict)
                self.assertIn("error", result)


if __name__ == "__main__":
    unittest.main()
