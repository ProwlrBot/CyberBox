#!/usr/bin/env python3
"""Local, read-mostly API for the CyberBox csbx Plugin Center."""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import socket
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import yaml

HOME = Path(os.environ.get("CSBX_HOME", Path.home() / ".csbx"))
REGISTRY = HOME / "registry.yaml"
INSTALLED = HOME / "installed.yaml"
STATIC = Path(__file__).parent / "static"
NAME = re.compile(r"^[A-Za-z0-9._-]+$")
ANSI = re.compile(r"\x1b\[[0-9;]*m")
SECRET = re.compile(r"(?i)(api[_-]?key|token|password|authorization)(\s*[:=]\s*)(\S+)")
CAPABILITY = secrets.token_urlsafe(32)
CONTROL_API_URL = os.environ.get("CYBERBOX_CONTROL_API_URL", "http://control-plane:8787/api/v1")
INTERNAL_SERVICE_TOKEN = os.environ.get("CYBERBOX_INTERNAL_SERVICE_TOKEN", "")
NOISE_PATTERNS = (
    "bus.cc(",
    "dbus",
    "fm_registration_token_uploader",
    "registration_request.cc(",
    "registration response error message",
    "devtools listening on",
    "Failed to connect to the bus",
)
RECOVERABLE_SERVICES = {
    "browser": ("browser", "/var/log/gem/browser.log"),
    "terminal": ("python-server", "/var/log/gem/python-server.log"),
    "jupyter": ("jupyter", "/var/log/gem/jupyter.log"),
    "code-server": ("code-server", "/var/log/gem/code-server.log"),
    "mcp-hub": ("mcp-hub", "/var/log/gem/mcp-hub.log"),
}

PREVIEWS = [
    {"id": "hydra", "name": "Hydra", "kind": "credential-testing", "maturity": "preview",
     "description": "Bounded, authorized authentication testing with scoped targets and rate limits.",
     "command": "hydra -L <users> -P <passwords> -t 4 <in-scope-target> <service>",
     "controls": ["scope required", "command preview", "explicit confirmation", "attempt limit"],
     "profiles": ["web-application-testing", "api-security", "ctf",
                  "security-education", "red-team", "purple-team"], "binary": "hydra"},
    {"id": "browser-capture", "name": "Browser Capture", "kind": "browser", "maturity": "preview",
     "description": "Capture screenshots, page metadata, and session notes from the sandbox browser.",
     "command": "browser-capture <in-scope-url> --output ~/exports/evidence/",
     "controls": ["scope required", "evidence hashing", "metadata redaction"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "mobile-security", "osint", "ctf", "security-education",
                  "custom", "red-team", "blue-team", "purple-team"], "binary": ""},
    {"id": "proxy-handoff", "name": "Proxy Handoff", "kind": "browser", "maturity": "preview",
     "description": "Open an in-scope target with approved Caido or mitmproxy routing presets.",
     "command": "browser-proxy --profile caido <in-scope-url>",
     "controls": ["scope required", "proxy status", "session isolation"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "mobile-security", "red-team", "purple-team"], "binary": ""},
    {"id": "nuclei", "name": "Nuclei", "kind": "vulnerability-validation", "maturity": "preview",
     "description": "Run signed or reviewed templates against an explicitly scoped target.",
     "command": "nuclei -u <in-scope-url> -severity low,medium,high,critical -rl 25 -jsonl -o ~/exports/evidence/nuclei.jsonl",
     "controls": ["scope required", "template review", "rate limit", "evidence output"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "container-kubernetes-security", "ctf", "security-education",
                  "red-team", "purple-team"], "binary": "nuclei"},
    {"id": "ffuf", "name": "ffuf", "kind": "content-discovery", "maturity": "preview",
     "description": "Bounded content discovery with an approved wordlist and request budget.",
     "command": "ffuf -u <in-scope-url>/FUZZ -w <approved-wordlist> -rate 20 -maxtime 300 -of json -o ~/exports/evidence/ffuf.json",
     "controls": ["scope required", "approved wordlist", "request budget", "time limit"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "ctf", "security-education", "red-team"], "binary": "ffuf"},
    {"id": "httpx", "name": "httpx", "kind": "surface-validation", "maturity": "preview",
     "description": "Probe an authorized target list and record normalized service metadata.",
     "command": "httpx -l <in-scope-targets> -rate-limit 25 -json -o ~/exports/evidence/httpx.jsonl",
     "controls": ["scope required", "rate limit", "target list review", "evidence output"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "cloud-security", "container-kubernetes-security", "osint",
                  "ctf", "security-education", "red-team", "purple-team"], "binary": "httpx"},
    {"id": "subfinder", "name": "subfinder", "kind": "passive-discovery", "maturity": "preview",
     "description": "Passive subdomain discovery for an engagement-owned root domain.",
     "command": "subfinder -d <in-scope-domain> -silent -o ~/exports/evidence/subdomains.txt",
     "controls": ["scope required", "passive sources", "root-domain validation"],
     "profiles": ["bug-bounty", "web-application-testing", "cloud-security",
                  "osint", "security-education", "red-team"], "binary": "subfinder"},
    {"id": "sigma", "name": "Sigma Rules", "kind": "detection-engineering", "maturity": "preview",
     "description": "Review and validate portable detection rules against approved telemetry fixtures.",
     "command": "csbx install sigma",
     "controls": ["fixture based", "rule provenance", "false-positive review"],
     "profiles": ["cloud-security", "digital-forensics", "soc-incident-response",
                  "blue-team", "purple-team"], "binary": "", "plugin": "sigma"},
    {"id": "yara", "name": "YARA Rules", "kind": "malware-analysis", "maturity": "preview",
     "description": "Install reviewed community rules for isolated artifact classification.",
     "command": "csbx install yara-rules-community",
     "controls": ["isolated artifacts", "rule provenance", "match review"],
     "profiles": ["mobile-security", "malware-analysis", "digital-forensics",
                  "soc-incident-response", "blue-team", "purple-team"], "binary": "yara",
     "plugin": "yara-rules-community"},
    {"id": "dalfox", "name": "Dalfox", "kind": "web-validation", "maturity": "preview",
     "description": "Validate an authorized XSS hypothesis with bounded workers and evidence output.",
     "command": "dalfox url <in-scope-url> --worker 5 --timeout 10 --format json -o ~/exports/evidence/dalfox.json",
     "controls": ["scope required", "hypothesis required", "worker limit", "evidence output"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "ctf", "security-education", "red-team"], "binary": "dalfox", "risk": "active"},
    {"id": "arjun", "name": "Arjun", "kind": "parameter-discovery", "maturity": "preview",
     "description": "Discover hidden request parameters on an explicitly scoped endpoint.",
     "command": "arjun -u <in-scope-url> -t 5 --rate-limit 10 -oJ ~/exports/evidence/arjun.json",
     "controls": ["scope required", "thread limit", "rate limit", "evidence output"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "ctf", "security-education", "red-team"], "binary": "arjun", "risk": "active"},
    {"id": "sqlmap", "name": "SQLMap", "kind": "injection-validation", "maturity": "preview",
     "description": "Conservatively validate a reviewed SQL injection hypothesis.",
     "command": "sqlmap -u <in-scope-url> --batch --level=1 --risk=1 --threads=2 --output-dir=~/exports/evidence/sqlmap",
     "controls": ["approval required", "scope required", "low risk preset", "no data extraction"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "ctf", "security-education", "red-team"], "binary": "sqlmap", "risk": "approval"},
    {"id": "jwt-hack", "name": "JWT Hack", "kind": "token-validation", "maturity": "preview",
     "description": "Inspect and test an engagement-provided JWT without storing raw secrets.",
     "command": "jwt-hack decode <redacted-jwt>",
     "controls": ["test token only", "secret redaction", "offline first"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "mobile-security", "ctf", "security-education", "red-team",
                  "blue-team", "purple-team"],
     "binary": "jwt-hack", "risk": "passive"},
    {"id": "trufflehog", "name": "TruffleHog", "kind": "secret-discovery", "maturity": "preview",
     "description": "Scan an authorized local repository and preserve verified findings.",
     "command": "trufflehog filesystem <authorized-repository> --json > ~/exports/evidence/trufflehog.jsonl",
     "controls": ["local source", "authorization required", "secret redaction", "evidence output"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "cloud-security", "container-kubernetes-security", "osint",
                  "soc-incident-response", "ctf", "security-education", "red-team",
                  "blue-team", "purple-team"],
     "binary": "trufflehog", "risk": "passive"},
    {"id": "gitleaks", "name": "Gitleaks", "kind": "secret-discovery", "maturity": "preview",
     "description": "Audit an approved repository for credential exposure with a reproducible report.",
     "command": "gitleaks git <authorized-repository> --report-format json --report-path ~/exports/evidence/gitleaks.json",
     "controls": ["local source", "authorization required", "report redaction", "evidence output"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "cloud-security", "container-kubernetes-security", "osint",
                  "soc-incident-response", "ctf", "security-education", "red-team",
                  "blue-team", "purple-team"],
     "binary": "gitleaks", "risk": "passive"},
    {"id": "nmap", "name": "Nmap", "kind": "network-validation", "maturity": "preview",
     "description": "Validate approved hosts and a narrow port set without broad autonomous scanning.",
     "command": "nmap -sT -Pn --max-rate 50 -p <approved-ports> -oA ~/exports/evidence/nmap <in-scope-hosts>",
     "controls": ["scope required", "approved ports", "rate limit", "no scripts by default"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "cloud-security", "container-kubernetes-security", "digital-forensics",
                  "soc-incident-response", "ctf", "security-education", "red-team",
                  "blue-team", "purple-team"], "binary": "nmap", "risk": "active"},
    {"id": "mitmproxy", "name": "mitmproxy", "kind": "traffic-analysis", "maturity": "preview",
     "description": "Start an isolated interception session for explicitly configured test clients.",
     "command": "mitmproxy --set confdir=~/.mitmproxy --save-stream-file ~/exports/evidence/session.flow",
     "controls": ["test clients only", "certificate review", "session isolation", "evidence output"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "mobile-security", "malware-analysis", "digital-forensics",
                  "soc-incident-response", "ctf", "security-education", "red-team",
                  "blue-team", "purple-team"],
     "binary": "mitmproxy", "risk": "active"},
    {"id": "wafw00f", "name": "WAFW00F", "kind": "control-fingerprinting", "maturity": "preview",
     "description": "Identify edge security controls on an in-scope application endpoint.",
     "command": "wafw00f <in-scope-url> -o ~/exports/evidence/wafw00f.json -f json",
     "controls": ["scope required", "single target", "evidence output"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "cloud-security", "ctf", "security-education", "red-team",
                  "purple-team"], "binary": "wafw00f", "risk": "low-impact"},
    {"id": "commix", "name": "Commix", "kind": "command-injection-validation", "maturity": "preview",
     "description": "Validate a reviewed command-injection hypothesis using conservative settings.",
     "command": "commix --url=<in-scope-url> --batch --level=1 --output-dir=~/exports/evidence/commix",
     "controls": ["approval required", "scope required", "hypothesis required", "low level preset"],
     "profiles": ["bug-bounty", "web-application-testing", "api-security",
                  "ctf", "security-education", "red-team"], "binary": "commix", "risk": "approval"},
    {"id": "tshark", "name": "TShark", "kind": "network-observability", "maturity": "preview",
     "description": "Capture a bounded packet sample for defensive analysis and evidence.",
     "command": "tshark -i <approved-interface> -a duration:60 -w ~/exports/evidence/capture.pcapng",
     "controls": ["approved interface", "60 second limit", "sensitive-data review"],
     "profiles": ["mobile-security", "malware-analysis", "digital-forensics",
                  "soc-incident-response", "blue-team", "purple-team"], "binary": "tshark", "risk": "passive"},
    {"id": "metasploit", "name": "Metasploit", "kind": "controlled-emulation", "maturity": "requires configuration",
     "description": "Optional isolated provider; not baked into the core image because upstream distribution is not reproducibly pinned.",
     "command": "msfconsole -q",
     "controls": ["separate provider required", "approval required", "scenario required", "activity logging"],
     "profiles": ["ctf", "red-team", "purple-team"], "binary": "msfconsole", "risk": "approval"},
    {"id": "shodan", "name": "Shodan CLI", "kind": "passive-intelligence", "maturity": "preview",
     "description": "Query passive Internet exposure data for an engagement-owned organization.",
     "command": "shodan search '<authorized-query>' --fields ip_str,port,org,hostnames",
     "controls": ["authorized query", "passive source", "result review"],
     "profiles": ["bug-bounty", "web-application-testing", "cloud-security",
                  "osint", "soc-incident-response", "red-team", "blue-team"],
     "binary": "shodan", "risk": "passive"},
    {"id": "censys", "name": "Censys CLI", "kind": "passive-intelligence", "maturity": "preview",
     "description": "Review passive host and certificate intelligence for approved assets.",
     "command": "censys search '<authorized-query>' --index-type hosts",
     "controls": ["authorized query", "passive source", "result review"],
     "profiles": ["bug-bounty", "web-application-testing", "cloud-security",
                  "osint", "soc-incident-response", "red-team", "blue-team"],
     "binary": "censys", "risk": "passive"},
]

PROFILE_TYPES = {
    "bug-bounty": {"wordlist", "nuclei-templates", "config"},
    "web-application-testing": {"wordlist", "nuclei-templates", "config", "tool"},
    "api-security": {"wordlist", "nuclei-templates", "config", "tool"},
    "mobile-security": {"config", "tool", "yara-rules"},
    "cloud-security": {"config", "tool", "threat-intel"},
    "container-kubernetes-security": {"config", "tool", "nuclei-templates"},
    "malware-analysis": {"yara-rules", "config", "tool", "threat-intel"},
    "digital-forensics": {"yara-rules", "config", "tool", "threat-intel"},
    "osint": {"config", "tool", "threat-intel"},
    "soc-incident-response": {"sigma", "yara-rules", "threat-intel", "config"},
    "ctf": {"wordlist", "config", "tool"},
    "security-education": {"wordlist", "config", "nuclei-templates"},
    "custom": {"wordlist", "config", "tool", "sigma", "yara-rules", "threat-intel", "nuclei-templates"},
    "red-team": {"wordlist", "nuclei-templates", "config", "tool"},
    "blue-team": {"sigma", "yara-rules", "threat-intel"},
    "purple-team": {"sigma", "yara-rules", "threat-intel", "nuclei-templates"},
}

PROFILE_NAMES = {
    "bug-bounty": "Bug Bounty", "web-application-testing": "Web Application Testing",
    "api-security": "API Security", "mobile-security": "Mobile Security",
    "cloud-security": "Cloud Security",
    "container-kubernetes-security": "Container and Kubernetes Security",
    "malware-analysis": "Malware Analysis", "digital-forensics": "Digital Forensics",
    "osint": "OSINT", "soc-incident-response": "SOC and Incident Response",
    "ctf": "CTF", "security-education": "Security Education", "custom": "Custom",
    "red-team": "Red Team", "blue-team": "Blue Team", "purple-team": "Purple Team",
}

SERVICE_COMPONENTS = {
    "dashboard": ("nginx", "http://127.0.0.1:8080/index.html"),
    "browser": ("browser", "http://127.0.0.1:9222/json/version"),
    "terminal": ("python-server", "http://127.0.0.1:8080/terminal"),
    "jupyter": ("jupyter", "http://127.0.0.1:8080/jupyter"),
    "code-server": ("code-server", "http://127.0.0.1:8080/code-server/"),
    "mcp": ("mcp-hub", None),
}

VERSION_COMMANDS = {
    "nuclei": ["nuclei", "-version"], "httpx": ["httpx", "-version"],
    "nmap": ["nmap", "--version"], "python3": ["python3", "--version"],
    "csbx": ["csbx", "--help"], "prowl": ["prowl", "--version"],
}


def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def state() -> dict:
    registry = load_yaml(REGISTRY)
    installed = load_yaml(INSTALLED).get("plugins", {})
    plugins = []
    for name, item in sorted(registry.get("plugins", {}).items()):
        if not NAME.fullmatch(name) or not isinstance(item, dict):
            continue
        current = installed.get(name)
        plugin_type = item.get("type", "other")
        plugins.append({"name": name, "type": plugin_type,
                        "description": item.get("description", ""), "size": item.get("size", "?"),
                        "tags": item.get("tags", []), "repo": item.get("repo", ""),
                        "installed": bool(current), "installed_info": current,
                        "profiles": [profile for profile, types in PROFILE_TYPES.items()
                                     if plugin_type in types]})
    previews = [{**preview, "available": bool(
                    (preview.get("binary") and shutil.which(preview["binary"])) or
                    (preview.get("plugin") and preview["plugin"] in installed))}
                for preview in PREVIEWS]
    return {"plugins": plugins, "previews": previews,
            "profiles": [{"id": profile_id, "name": PROFILE_NAMES[profile_id]}
                         for profile_id in PROFILE_TYPES],
            "registry": {"version": registry.get("version"),
                         "policy_version": registry.get("policy_version"),
                         "updated": registry.get("updated")},
            "paths": {"home": str(HOME), "registry": str(REGISTRY),
                      "installed": str(INSTALLED)}}


def health(*, opener=urlopen, runner=subprocess.run, finder=shutil.which,
           disk_usage=shutil.disk_usage, database_path: Path | None = None,
           database_connector=sqlite3.connect) -> dict:
    """Return honest component states without mutating runtime state."""
    try:
        result = runner(["supervisorctl", "status"], capture_output=True, text=True, timeout=3)
        supervisor = result.stdout if result.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        supervisor = ""
    components = []
    for component, (process, url) in SERVICE_COMPONENTS.items():
        process_ready = bool(re.search(rf"^{re.escape(process)}\s+RUNNING\b", supervisor, re.M))
        route_ready = True
        route_error = ""
        if url:
            try:
                with opener(url, timeout=2) as response:
                    route_ready = 200 <= response.status < 400
            except Exception as exc:  # probe failures become data, never a service crash
                route_ready, route_error = False, type(exc).__name__
        ready = process_ready and route_ready
        cause = "" if ready else (
            f"{process} is not running" if not process_ready else f"route probe failed: {route_error}")
        components.append({"id": component, "name": component.replace("-", " ").title(),
                           "state": "Ready" if ready else "Unavailable", "cause": cause,
                           "actions": ["View logs", "Restart service"] if not ready else []})

    control_url = os.environ.get("CYBERBOX_CONTROL_PLANE_URL", "").strip()
    if not control_url:
        control_plane = {"id": "control-plane", "name": "Control Plane", "state": "Preview",
                         "cause": "Control-plane sidecar is not configured in this runtime.",
                         "actions": ["Use the root Docker Compose deployment"]}
    else:
        try:
            with opener(control_url, timeout=2) as response:
                control_ready = 200 <= response.status < 400
        except Exception:
            control_ready = False
        control_plane = {"id": "control-plane", "name": "Control Plane",
                         "state": "Ready" if control_ready else "Unavailable",
                         "cause": "" if control_ready else "Control-plane health probe failed.",
                         "actions": [] if control_ready else ["View control-plane logs"]}
    components.append(control_plane)

    required = ["csbx", "prowl", "python3", "nuclei", "httpx", "nmap"]
    missing = [command for command in required if not finder(command)]
    components.append({"id": "toolchain", "name": "Core toolchain",
                       "state": "Ready" if not missing else "Missing dependency",
                       "cause": "" if not missing else "Missing: " + ", ".join(missing),
                       "actions": [] if not missing else ["Open Plugin Center", "View image logs"]})
    db_path = database_path or Path(os.environ.get(
        "CYBERBOX_DATABASE_PATH", "/home/hunter/.cyberbox/cyberbox.db"))
    try:
        database_exists = db_path.exists()
    except OSError:
        database_exists = None
    if control_url:
        database = {"id": "database", "name": "Control Plane Database",
                    "state": "Ready" if control_ready else "Unavailable",
                    "cause": "" if control_ready else "Control-plane database probe failed.",
                    "actions": [] if control_ready else ["View control-plane logs"]}
    elif database_exists is None:
        database = {"id": "database", "name": "Control Plane Database", "state": "Degraded",
                    "cause": "Configured database path is not accessible to the control plane.",
                    "actions": ["Review workspace ownership and permissions"]}
    elif not database_exists:
        database = {"id": "database", "name": "Control Plane Database", "state": "Preview",
                    "cause": "Control plane is not promoted into this workstation runtime.",
                    "actions": ["Review Phase 2 control-plane setup"]}
    else:
        try:
            with database_connector(f"file:{db_path}?mode=ro", uri=True, timeout=1) as connection:
                result = connection.execute("PRAGMA quick_check(1)").fetchone()
            if not result or result[0] != "ok":
                raise sqlite3.DatabaseError("quick check failed")
            database = {"id": "database", "name": "Control Plane Database", "state": "Ready",
                        "cause": "", "actions": []}
        except (OSError, sqlite3.Error):
            database = {"id": "database", "name": "Control Plane Database", "state": "Degraded",
                        "cause": "Configured SQLite database failed its read-only integrity probe.",
                        "actions": ["Review database logs", "Restore a verified backup"]}
    components.append(database)
    usage = disk_usage(Path.home())
    percent = round((usage.used / usage.total) * 100) if usage.total else 0
    disk_state = "Degraded" if percent >= 85 else "Ready"
    components.append({"id": "storage", "name": "Workspace storage", "state": disk_state,
                       "cause": f"{percent}% used" if disk_state == "Degraded" else "",
                       "usage_percent": percent,
                       "actions": ["Review artifacts", "Export workspace"] if disk_state == "Degraded" else []})
    failures = [item for item in components if item["state"] in (
        "Degraded", "Unavailable", "Missing dependency")]
    previews = [item for item in components if item["state"] in (
        "Preview", "Development stub", "Experimental", "Requires configuration")]
    return {"state": "Ready" if not failures else "Degraded", "components": components,
            "summary": {"ready": len(components) - len(failures) - len(previews),
                        "attention": len(failures), "preview": len(previews)}}


def _cgroup_value(name: str) -> str:
    path = Path("/sys/fs/cgroup") / name
    try:
        return path.read_text().strip()
    except OSError:
        return ""


def _version_line(output: str) -> str:
    lines = [ANSI.sub("", line).strip() for line in output.splitlines() if line.strip()]
    for line in lines:
        if "version" in line.lower():
            return line[:160]
    return lines[0][:160] if lines else ""


def runtime(*, reader=_cgroup_value, runner=subprocess.run, finder=shutil.which) -> dict:
    memory_current = int(reader("memory.current") or 0)
    raw_limit = reader("memory.max")
    memory_limit = 0 if raw_limit in ("", "max") else int(raw_limit)
    memory_percent = round(memory_current / memory_limit * 100, 1) if memory_limit else None
    cpu_raw = (reader("cpu.max") or "max 100000").split()
    cpu_quota = None if cpu_raw[0] == "max" else round(int(cpu_raw[0]) / int(cpu_raw[1]), 2)
    raw_pids = reader("pids.max")
    tools = []
    for tool, command in VERSION_COMMANDS.items():
        path = finder(tool)
        version = ""
        if path:
            try:
                result = runner(command, capture_output=True, text=True, timeout=3)
                version = _version_line((result.stdout or "") + "\n" + (result.stderr or ""))
            except (OSError, subprocess.SubprocessError, IndexError):
                version = "version probe failed"
        tools.append({"id": tool, "path": path or "", "version": version,
                      "state": "Ready" if path and version != "version probe failed" else
                               "Degraded" if path else "Missing dependency"})
    return {"container": {"hostname": socket.gethostname(), "user": os.environ.get("USER", "")},
            "resources": {"memory_current": memory_current, "memory_limit": memory_limit,
                          "memory_percent": memory_percent, "cpu_limit": cpu_quota,
                          "pids_current": int(reader("pids.current") or 0),
                          "pids_limit": None if raw_pids in ("", "max") else int(raw_pids)},
            "tools": tools}


def _cookie_value(header: str, name: str) -> str:
    for item in header.split(";"):
        key, separator, value = item.strip().partition("=")
        if separator and key == name:
            return value
    return ""


def _redact(text: str) -> str:
    return SECRET.sub(r"\1\2[REDACTED]", ANSI.sub("", text))


def _filter_runtime_noise(lines: list[str]) -> tuple[list[str], int]:
    filtered: list[str] = []
    noise = 0
    for line in lines:
        if any(pattern.lower() in line.lower() for pattern in NOISE_PATTERNS):
            noise += 1
            continue
        filtered.append(line)
    return filtered, noise


def _authorized(headers: object) -> bool:
    token = _cookie_value(headers.get("Cookie", ""), "cbx_cap")
    origin = headers.get("Origin", "")
    host = headers.get("Host", "")
    same_origin = origin in (f"http://{host}", f"https://{host}")
    fetch_metadata = not origin and headers.get("Sec-Fetch-Site", "") == "same-origin"
    return (same_origin or fetch_metadata) and secrets.compare_digest(token, CAPABILITY)


def _control_json(method: str, path: str, body: dict, headers: dict | None = None,
                  opener=urlopen) -> dict:
    url = CONTROL_API_URL.rstrip("/") + path
    data = json.dumps(body).encode()
    request = Request(url, data=data, method=method, headers={
        "Content-Type": "application/json", **(headers or {}),
    })
    with opener(request, timeout=5) as response:
        return json.loads(response.read().decode() or "{}")


def capture_evidence(project_id: str, title: str, content: str, metadata: dict,
                     opener=urlopen) -> dict:
    if not INTERNAL_SERVICE_TOKEN:
        return {"ok": False, "error": "control-plane internal bridge disabled"}
    issued = _control_json("POST", f"/internal/projects/{project_id}/capabilities", {
        "subject_type": "provider",
        "subject_id": "plugin-center",
        "permissions": ["evidence.write"],
        "ttl_seconds": 120,
        "metadata": {"source": "csbx-plugin-center"},
    }, {"X-CyberBox-Internal-Token": INTERNAL_SERVICE_TOKEN}, opener)
    payload = {
        "kind": "plugin-center-note",
        "media_type": "application/json",
        "content_base64": base64.b64encode(json.dumps({
            "title": title,
            "content": content,
            "metadata": metadata,
        }, sort_keys=True).encode()).decode(),
        "metadata": {"collector": "plugin-center", **metadata},
    }
    artifact = _control_json("POST", f"/provider/projects/{project_id}/artifacts", payload,
                             {"X-CyberBox-Capability": issued["token"]}, opener)
    return {"ok": True, "artifact": artifact}


def authorize_registry_sync(opener=urlopen) -> dict:
    return _authorize_internal_permission("plugin.registry.sync", opener=opener)


def authorize_service_restart(opener=urlopen) -> dict:
    return _authorize_internal_permission("service.restart", opener=opener)


def authorize_service_logs(opener=urlopen) -> dict:
    return _authorize_internal_permission("service.read", opener=opener)


def _authorize_internal_permission(permission: str, opener=urlopen) -> dict:
    if not INTERNAL_SERVICE_TOKEN:
        return {"ok": False, "error": "control-plane internal bridge disabled"}
    issued = _control_json("POST", "/internal/capabilities", {
        "subject_type": "provider",
        "subject_id": "plugin-center",
        "permissions": [permission],
        "ttl_seconds": 120,
        "metadata": {"source": "csbx-plugin-center", "permission": permission},
    }, {"X-CyberBox-Internal-Token": INTERNAL_SERVICE_TOKEN}, opener)
    verified = _control_json("POST", "/internal/capabilities/verify", {
        "token": issued["token"],
        "permission": permission,
        "project_id": issued["project_id"],
    }, {"X-CyberBox-Internal-Token": INTERNAL_SERVICE_TOKEN}, opener)
    return {"ok": True, "capability_id": verified["capability"]["id"],
            "project_id": issued["project_id"]}


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, value: object) -> None:
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def authorized(self) -> bool:
        return _authorized(self.headers)

    def read_json(self, limit: int = 65536) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > limit:
            raise ValueError("invalid request size")
        return json.loads(self.rfile.read(length).decode())

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/state":
            self.send_json(200, state())
            return
        if path == "/api/health":
            self.send_json(200, health())
            return
        if path == "/api/runtime":
            self.send_json(200, runtime())
            return
        match = re.fullmatch(r"/api/services/([a-z0-9-]+)/logs", path)
        if match:
            if not self.authorized():
                self.send_json(403, {"ok": False, "error": "capability denied"})
                return
            service = match.group(1)
            recovery = RECOVERABLE_SERVICES.get(service)
            if not recovery:
                self.send_json(404, {"ok": False, "error": "service not recoverable"})
                return
            try:
                authorization = authorize_service_logs()
            except Exception as exc:
                self.send_json(502, {"ok": False, "error": type(exc).__name__})
                return
            if not authorization.get("ok"):
                self.send_json(403, {"ok": False, "error": authorization.get("error", "logs not authorized")})
                return
            _process, log_path = recovery
            try:
                lines = Path(log_path).read_text(errors="replace").splitlines()[-200:]
                filtered_lines, noise_count = _filter_runtime_noise(lines)
                self.send_json(200, {"ok": True, "service": service,
                                     "required_permission": "service.read",
                                     "capability_id": authorization.get("capability_id"),
                                     "noise_count": noise_count,
                                     "noise_summary": (
                                         f"Filtered {noise_count} repetitive runtime noise lines."
                                         if noise_count else ""
                                     ),
                                     "lines": [_redact(line)[:2000] for line in filtered_lines]})
            except OSError as exc:
                self.send_json(404, {"ok": False, "error": type(exc).__name__})
            return
        relative = "index.html" if path in ("/", "") else path.lstrip("/")
        target = (STATIC / relative).resolve()
        if STATIC.resolve() not in target.parents and target != STATIC.resolve():
            self.send_error(404)
            return
        if not target.is_file():
            self.send_error(404)
            return
        data = target.read_bytes()
        mime = "text/html; charset=utf-8" if target.suffix == ".html" else "text/css" if target.suffix == ".css" else "application/javascript"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        if target.name == "index.html":
            self.send_header("Set-Cookie", f"cbx_cap={CAPABILITY}; Path=/csbx/; HttpOnly; SameSite=Strict")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if not self.authorized():
            self.send_json(403, {"ok": False, "error": "capability denied"})
            return
        restart = re.fullmatch(r"/api/services/([a-z0-9-]+)/restart", path)
        if restart:
            service = restart.group(1)
            if (self.headers.get("X-CyberBox-Action") != "restart-service" or
                    service not in RECOVERABLE_SERVICES):
                self.send_json(403, {"ok": False, "error": "restart not permitted"})
                return
            try:
                authorization = authorize_service_restart()
            except Exception as exc:
                self.send_json(502, {"ok": False, "service": service, "error": type(exc).__name__})
                return
            if not authorization.get("ok"):
                self.send_json(403, {"ok": False, "service": service,
                                     "error": authorization.get("error", "restart not authorized")})
                return
            process, _log_path = RECOVERABLE_SERVICES[service]
            try:
                result = subprocess.run(["supervisorctl", "restart", process], capture_output=True,
                                        text=True, timeout=20)
            except subprocess.TimeoutExpired:
                self.send_json(504, {"ok": False, "service": service,
                                     "error": "service restart timed out"})
                return
            self.send_json(200 if result.returncode == 0 else 502,
                           {"ok": result.returncode == 0, "service": service,
                            "required_permission": "service.restart",
                            "capability_id": authorization.get("capability_id"),
                            "output": _redact(result.stdout + result.stderr)[-2000:]})
            return
        if path != "/api/sync":
            if path == "/api/evidence/capture":
                if self.headers.get("X-CyberBox-Action") != "capture-evidence":
                    self.send_json(403, {"ok": False, "error": "missing action confirmation header"})
                    return
                try:
                    body = self.read_json()
                    project_id = str(body.get("project_id", "")).strip()
                    title = str(body.get("title", "Plugin Center evidence")).strip()
                    content = str(body.get("content", "")).strip()
                    metadata = body.get("metadata", {})
                    if not project_id or not content or not isinstance(metadata, dict):
                        raise ValueError("project_id, content, and metadata are required")
                    result = capture_evidence(project_id, title[:200], content[:12000], metadata)
                    self.send_json(200 if result.get("ok") else 502, result)
                except (ValueError, json.JSONDecodeError) as exc:
                    self.send_json(400, {"ok": False, "error": str(exc)})
                except Exception as exc:
                    self.send_json(502, {"ok": False, "error": type(exc).__name__})
                return
            self.send_error(404)
            return
        if self.headers.get("X-CSBX-Action") != "sync-registry":
            self.send_json(403, {"ok": False, "output": "missing action confirmation header"})
            return
        try:
            authorization = authorize_registry_sync()
        except Exception as exc:
            self.send_json(502, {"ok": False, "output": type(exc).__name__})
            return
        if not authorization.get("ok"):
            self.send_json(403, {"ok": False, "output": authorization.get("error", "sync not authorized")})
            return
        result = subprocess.run(["csbx", "sync"], capture_output=True, text=True, timeout=30,
                                env={**os.environ, "CSBX_HOME": str(HOME)})
        self.send_json(200 if result.returncode == 0 else 502,
                       {"ok": result.returncode == 0,
                        "capability_id": authorization.get("capability_id"),
                        "output": (result.stdout + result.stderr)[-4000:]})

    def log_message(self, fmt: str, *args: object) -> None:
        print("csbx-ui:", fmt % args, flush=True)


if __name__ == "__main__":
    HOME.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer(("127.0.0.1", 8199), Handler).serve_forever()
