from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from cyberbox.services import wordfence


class WordfenceProviderTest(unittest.TestCase):
    def test_commands_are_allowlisted_and_never_accept_a_target(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            lab = root / "labs" / "tools" / "bin"
            lab.mkdir(parents=True)
            (lab / "lab").touch()
            built = wordfence.commands("fluentform", "hunt", root)
        self.assertEqual(built[0][-2:], ["hunt", "fluentform"])
        self.assertTrue(all("http" not in part for command in built for part in command))
        self.assertTrue(all(command[0].endswith("/labs/tools/bin/lab") for command in built))

    def test_rejects_shell_and_live_target_inputs(self) -> None:
        with self.assertRaises(ValueError):
            wordfence.validate("fluentform;id", "hunt")
        with self.assertRaises(ValueError):
            wordfence.validate("fluentform", "live")

    def test_requires_a_mounted_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            import os
            old = os.environ.get("CYBERBOX_CVE_INTEL_ROOT")
            os.environ["CYBERBOX_CVE_INTEL_ROOT"] = temp
            try:
                with self.assertRaises(RuntimeError):
                    wordfence.cve_intel_root()
            finally:
                if old is None:
                    os.environ.pop("CYBERBOX_CVE_INTEL_ROOT", None)
                else:
                    os.environ["CYBERBOX_CVE_INTEL_ROOT"] = old
