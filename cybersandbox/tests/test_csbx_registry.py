from __future__ import annotations

import importlib.util
from importlib.machinery import SourceFileLoader
import json
import os
import stat
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

import yaml


ROOT = Path(__file__).parents[2]
HELPER = ROOT / "prowl" / "bin" / "csbx-registry"
CSBX = ROOT / "prowl" / "bin" / "csbx"

spec = importlib.util.spec_from_loader("csbx_registry", SourceFileLoader("csbx_registry", str(HELPER)))
registry = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(registry)


def fixture() -> dict:
    return {
        "version": 1,
        "policy_version": "2026-04-25",
        "updated": "2026-04-25",
        "pdtm_tools": {
            "subfinder": {
                "repo": "projectdiscovery/subfinder", "install_type": "go",
                "go_install_path": "github.com/projectdiscovery/subfinder/v2/cmd/subfinder",
                "version": "v2.13.0",
            }
        },
        "plugins": {
            "lists": {
                "repo": "https://github.com/example/lists", "type": "wordlist",
                "description": "Authorized test wordlists", "size": "1MB", "tags": ["lab"],
            },
            "pinned": {
                "repo": "https://github.com/example/tool", "type": "tool",
                "description": "Pinned authorized test tool", "size": "2MB", "tags": ["lab"],
                "commit": "a" * 40,
            },
        },
        "caido_plugins": {
            "signed": {
                "repo": "https://github.com/example/caido-plugin", "type": "caido-plugin",
                "description": "Signed Caido test plugin", "size": "1MB", "tags": ["caido"],
                "release": "v1.0.0", "manifest": "caido.json",
                "signature": {"method": "cosign", "issuer": "https://token.actions.githubusercontent.com",
                              "identity": "https://github.com/example/caido-plugin/.github/workflows/release.yml@refs/tags/v1.0.0"},
            }
        },
    }


class RegistryContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.registry_path = self.home / "registry.yaml"
        self.registry_path.write_text(yaml.safe_dump(fixture(), sort_keys=False))

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_valid_registry_and_all_install_plans(self) -> None:
        root = registry.load_registry(self.registry_path)
        self.assertTrue(registry.plan(root, "pdtm_tools", "subfinder")["reproducible"])
        self.assertTrue(registry.plan(root, "plugins", "lists")["mutable_source"])
        self.assertTrue(registry.plan(root, "plugins", "pinned")["reproducible"])
        self.assertEqual(registry.plan(root, "caido_plugins", "signed")["trust_tier"], "strict")
        self.assertEqual(len(registry.catalog(root)), 4)

    def test_legacy_embedded_pdtm_version_is_normalized_once(self) -> None:
        data = fixture()
        data["pdtm_tools"]["subfinder"]["go_install_path"] += "@v2.13.0"
        self.registry_path.write_text(yaml.safe_dump(data))
        root = registry.load_registry(self.registry_path)
        self.assertEqual(registry.plan(root, "pdtm_tools", "subfinder")["source"],
                         "github.com/projectdiscovery/subfinder/v2/cmd/subfinder@v2.13.0")

    def test_unknown_registry_version_fails_closed(self) -> None:
        data = fixture(); data["version"] = 2
        self.registry_path.write_text(yaml.safe_dump(data))
        with self.assertRaisesRegex(registry.RegistryError, "unsupported registry version"):
            registry.load_registry(self.registry_path)

    def test_unknown_fields_and_unsafe_manifest_are_rejected(self) -> None:
        data = fixture(); data["plugins"]["lists"]["surprise"] = True
        self.registry_path.write_text(yaml.safe_dump(data))
        with self.assertRaisesRegex(registry.RegistryError, "unsupported fields"):
            registry.load_registry(self.registry_path)
        data = fixture(); data["caido_plugins"]["signed"]["manifest"] = "../../escape.json"
        self.registry_path.write_text(yaml.safe_dump(data))
        with self.assertRaisesRegex(registry.RegistryError, "unsafe"):
            registry.load_registry(self.registry_path)

    def test_safe_zip_rejects_traversal_and_symlinks(self) -> None:
        bad = self.home / "bad.zip"
        with zipfile.ZipFile(bad, "w") as bundle:
            bundle.writestr("../escape", "no")
        with self.assertRaises(registry.RegistryError):
            registry.safe_extract_zip(bad, self.home / "bad-out", "caido.json")

        link = self.home / "link.zip"
        with zipfile.ZipFile(link, "w") as bundle:
            info = zipfile.ZipInfo("link")
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            bundle.writestr(info, "target")
            bundle.writestr("caido.json", "{}")
        with self.assertRaisesRegex(registry.RegistryError, "symlinks"):
            registry.safe_extract_zip(link, self.home / "link-out", "caido.json")

    def test_named_pdtm_uses_registry_version(self) -> None:
        bin_dir = self.home / "bin"; bin_dir.mkdir()
        log = self.home / "go.log"
        go = bin_dir / "go"
        go.write_text(
            f"#!/bin/sh\nprintf '%s' \"$*\" > '{log}'\n"
            "mkdir -p \"$GOBIN\"\n: > \"$GOBIN/subfinder\"\nchmod +x \"$GOBIN/subfinder\"\n")
        go.chmod(0o755)
        env = {
            **os.environ, "CSBX_HOME": str(self.home / "state"),
            "CSBX_REGISTRY_URL": "https://invalid.test/registry.yaml",
            "PATH": f"{bin_dir}:{os.environ['PATH']}", "NO_COLOR": "1",
        }
        state = Path(env["CSBX_HOME"]); state.mkdir()
        (state / "registry.yaml").write_text(self.registry_path.read_text())
        result = subprocess.run([str(CSBX), "pdtm", "subfinder"], env=env,
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log.read_text(), "install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@v2.13.0")
        installed = yaml.safe_load((state / "installed.yaml").read_text())
        self.assertEqual(installed["plugins"]["subfinder"]["source"], "pdtm")

    def test_cli_plan_is_machine_readable(self) -> None:
        result = subprocess.run([str(CSBX), "plan", "--caido", "signed"],
                                env={**os.environ, "CSBX_HOME": str(self.home),
                                     "CSBX_REGISTRY_HELPER": str(HELPER)},
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["trust_tier"], "strict")

    def _fake_git(self, fixture_dir: Path) -> Path:
        bin_dir = self.home / "fake-git-bin"
        bin_dir.mkdir(exist_ok=True)
        script = bin_dir / "git"
        script.write_text(
            "#!/bin/sh\n"
            "if [ \"$1\" = clone ]; then\n"
            "  for argument in \"$@\"; do target=$argument; done\n"
            "  mkdir -p \"$target\"\n"
            "  cp -R \"$CSBX_TEST_PLUGIN\"/. \"$target\"/\n"
            "  exit 0\n"
            "fi\n"
            "if [ \"$1\" = -C ] && [ \"$3\" = rev-parse ]; then\n"
            "  echo 0123456789abcdef0123456789abcdef01234567\n"
            "  exit 0\n"
            "fi\n"
            "exit 0\n")
        script.chmod(0o755)
        return bin_dir

    def test_standard_install_records_commit_and_remove_is_scoped(self) -> None:
        fixture_dir = self.home / "plugin-fixture"
        (fixture_dir / "bin").mkdir(parents=True)
        (fixture_dir / "bin" / "fixture-tool").write_text("fixture\n")
        (fixture_dir / "csbx.yaml").write_text(
            "name: lists\ntype: tool\nbinaries: [bin/fixture-tool]\n")
        fake_bin = self._fake_git(fixture_dir)
        state = self.home / "install-state"
        state.mkdir()
        (state / "registry.yaml").write_text(self.registry_path.read_text())
        env = {**os.environ, "CSBX_HOME": str(state), "CSBX_REGISTRY_HELPER": str(HELPER),
               "CSBX_ALLOW_ROOT": "1", "CSBX_YES": "1", "NO_COLOR": "1",
               "CSBX_TEST_PLUGIN": str(fixture_dir), "PATH": f"{fake_bin}:{os.environ['PATH']}"}
        result = subprocess.run([str(CSBX), "install", "lists"], env=env,
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        installed = yaml.safe_load((state / "installed.yaml").read_text())["plugins"]["lists"]
        self.assertEqual(installed["resolved_commit"], "0123456789abcdef0123456789abcdef01234567")
        self.assertTrue(installed["mutable_source"])
        self.assertTrue((state / "bin" / "fixture-tool").is_symlink())

        removed = subprocess.run([str(CSBX), "remove", "lists"], env=env,
                                 text=True, capture_output=True, timeout=10)
        self.assertEqual(removed.returncode, 0, removed.stderr)
        self.assertFalse((state / "bin" / "fixture-tool").exists())
        self.assertNotIn("lists", yaml.safe_load((state / "installed.yaml").read_text())["plugins"])

    def test_failed_install_hook_does_not_activate_or_record_plugin(self) -> None:
        fixture_dir = self.home / "failing-plugin"
        fixture_dir.mkdir()
        (fixture_dir / "csbx.yaml").write_text(
            "name: lists\ntype: tool\ninstall: |\n  exit 7\n")
        fake_bin = self._fake_git(fixture_dir)
        state = self.home / "failure-state"
        state.mkdir()
        (state / "registry.yaml").write_text(self.registry_path.read_text())
        env = {**os.environ, "CSBX_HOME": str(state), "CSBX_REGISTRY_HELPER": str(HELPER),
               "CSBX_ALLOW_ROOT": "1", "CSBX_YES": "1", "CSBX_ACCEPT_HOOKS": "1",
               "NO_COLOR": "1", "CSBX_TEST_PLUGIN": str(fixture_dir),
               "PATH": f"{fake_bin}:{os.environ['PATH']}"}
        result = subprocess.run([str(CSBX), "install", "lists"], env=env,
                                text=True, capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((state / "plugins" / "tool" / "lists").exists())
        self.assertNotIn("lists", yaml.safe_load((state / "installed.yaml").read_text())["plugins"])


if __name__ == "__main__":
    unittest.main()
