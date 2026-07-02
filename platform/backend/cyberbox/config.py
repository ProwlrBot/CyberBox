"""Central configuration — all knobs overridable via env or ~/.cyberbox/config.yaml."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml


def _home() -> Path:
    legacy = os.environ.get("NEO_HOME")
    preferred = os.environ.get("CYBERBOX_HOME", legacy or str(Path.home() / ".cyberbox"))
    return Path(preferred).expanduser()


@dataclass
class Settings:
    home: Path = field(default_factory=_home)
    host: str = os.environ.get("CYBERBOX_HOST", os.environ.get("NEO_HOST", "127.0.0.1"))
    port: int = int(os.environ.get("CYBERBOX_PORT", os.environ.get("NEO_PORT", "8787")))
    severities: tuple[str, ...] = ("critical", "high", "medium", "low", "info", "unknown")
    sla_defaults: dict[str, int] = field(
        default_factory=lambda: {"critical": 14, "high": 60, "medium": 90, "low": 120}
    )
    tools: dict[str, str] = field(
        default_factory=lambda: {
            "subfinder": os.environ.get(
                "CYBERBOX_SUBFINDER", os.environ.get("NEO_SUBFINDER", "subfinder")
            ),
            "httpx": os.environ.get("CYBERBOX_HTTPX", os.environ.get("NEO_HTTPX", "httpx")),
            "nuclei": os.environ.get("CYBERBOX_NUCLEI", os.environ.get("NEO_NUCLEI", "nuclei")),
        }
    )

    @property
    def db_path(self) -> Path:
        cyberbox_db = self.home / "cyberbox.db"
        legacy_db = self.home / "neo.db"
        if cyberbox_db.exists() or not legacy_db.exists():
            return cyberbox_db
        return legacy_db

    @property
    def scans_dir(self) -> Path:
        return self.home / "scans"

    @property
    def templates_dir(self) -> Path:
        return self.home / "templates"

    @property
    def config_path(self) -> Path:
        return self.home / "config.yaml"

    def ensure_dirs(self) -> None:
        for p in (self.home, self.scans_dir, self.templates_dir):
            p.mkdir(parents=True, exist_ok=True)

    def load_yaml(self) -> None:
        if not self.config_path.exists():
            return
        data = yaml.safe_load(self.config_path.read_text()) or {}
        for key, value in data.items():
            if hasattr(self, key):
                setattr(self, key, value)

    def save_yaml(self) -> None:
        snapshot = {"host": self.host, "port": self.port,
                    "sla_defaults": self.sla_defaults, "tools": self.tools}
        self.config_path.write_text(yaml.safe_dump(snapshot, sort_keys=False))


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        s = Settings()
        s.ensure_dirs()
        s.load_yaml()
        _settings = s
    return _settings
