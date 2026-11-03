"""Built-in workspace profiles and their safe default manifests."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from .. import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _profile(profile_id: str, name: str, description: str, playbook: str,
             domains: list[str], panels: list[str], *, maturity: str = "preview",
             network: str = "restricted", agents: list[str] | None = None,
             controls: dict | None = None) -> dict:
    return {
        "id": profile_id, "name": name, "version": "1.0.0", "maturity": maturity,
        "manifest": {
            "description": description,
            "agents": agents or ["scope-guardian", "researcher", "evidence-custodian", "reporter"],
            "playbooks": [playbook],
            "knowledge": [],
            "default_autonomy": "guided" if maturity != "stable" else "balanced",
            "default_layout": profile_id,
            "recommended_panels": panels,
            "domains": domains,
            "runtime": {"network_mode": network, "rootless": True,
                        "cpu_limit": 2, "memory_mb": 4096, "pids_limit": 512},
            "controls": {"authorization_required": True, "scope_check_each_action": True,
                         "approval_for_state_change": True, **(controls or {})},
            "evidence": {"artifact_hashing": True, "timeline_required": True},
        },
    }


BUILTIN_PROFILES = [
    _profile("bug-bounty", "Bug Bounty", "Evidence-driven authorized web and API research",
             "bounty-research", ["web", "api", "recon"],
             ["targets", "browser", "traffic", "terminal", "findings"], maturity="stable"),
    _profile("web-application-testing", "Web Application Testing",
             "Structured browser, proxy, and source-assisted application assessment",
             "web-application-assessment", ["web"],
             ["browser", "proxy", "traffic", "code", "findings"]),
    _profile("api-security", "API Security", "Schema-led and traffic-derived API assessment",
             "api-security-assessment", ["api", "graphql", "websocket"],
             ["targets", "traffic", "proxy", "code", "findings"]),
    _profile("mobile-security", "Mobile Security", "Capability-gated Android and iOS research",
             "mobile-application-assessment", ["android", "ios"],
             ["devices", "traffic", "terminal", "code", "evidence"]),
    _profile("cloud-security", "Cloud Security", "Read-only-first cloud configuration review",
             "cloud-configuration-audit", ["aws", "azure", "gcp", "saas"],
             ["targets", "terminal", "notebooks", "findings", "evidence"]),
    _profile("container-kubernetes-security", "Container and Kubernetes Security",
             "Image, supply-chain, and read-only-first cluster assessment",
             "container-kubernetes-assessment", ["containers", "kubernetes", "supply-chain"],
             ["containers", "code", "terminal", "findings", "evidence"]),
    _profile("malware-analysis", "Malware Analysis", "Strictly contained static malware triage",
             "malware-static-triage", ["malware", "reverse-engineering"],
             ["files", "code", "terminal", "notebooks", "evidence"], network="offline",
             controls={"disposable_runtime": True, "host_mounts": False,
                       "shared_clipboard": False, "dynamic_execution": False}),
    _profile("digital-forensics", "Digital Forensics", "Integrity-preserving artifact analysis",
             "digital-forensics-intake", ["disk", "memory", "pcap", "logs"],
             ["files", "timeline", "notebooks", "evidence", "reports"], network="offline",
             controls={"chain_of_custody": True, "read_only_evidence": True}),
    _profile("osint", "OSINT", "Source-attributed public-information research",
             "osint-case", ["public-sources", "infrastructure", "identity"],
             ["browser", "targets", "notes", "timeline", "evidence"]),
    _profile("soc-incident-response", "SOC and Incident Response",
             "Defensive triage, hunting, containment review, and recovery",
             "soc-incident-investigation", ["endpoint", "network", "identity", "cloud"],
             ["traffic", "timeline", "notebooks", "findings", "evidence"]),
    _profile("ctf", "CTF", "Isolated challenge-solving workspace for designated lab targets",
             "ctf-challenge", ["lab", "challenge"],
             ["code", "browser", "terminal", "notebooks", "notes"],
             controls={"lab_targets_only": True}),
    _profile("security-education", "Security Education",
             "Guided exercises against explicitly separated local training fixtures",
             "security-learning-lab", ["learning", "local-lab"],
             ["docs", "browser", "terminal", "code", "notes"],
             controls={"local_training_targets_only": True}),
    _profile("custom", "Custom", "Minimal deny-by-default workspace for operator-selected capabilities",
             "custom-workspace", ["custom"], ["code", "terminal", "docs"], network="offline"),
    # Compatibility profiles retained for existing projects and team workflows.
    _profile("red-team", "Red Team", "Authorized adversary emulation with explicit approvals",
             "red-team-engagement", ["emulation", "identity", "cloud", "web-api"],
             ["targets", "terminal", "traffic", "evidence", "reports"]),
    _profile("blue-team", "Blue Team", "Defensive monitoring, investigation, and detection engineering",
             "blue-team-investigation", ["endpoint", "identity", "network", "cloud"],
             ["traffic", "timeline", "notebooks", "evidence", "reports"]),
    _profile("purple-team", "Purple Team", "Controlled technique validation and detection improvement",
             "purple-team-validation", ["technique-validation", "telemetry", "detections"],
             ["workflows", "traffic", "timeline", "evidence", "reports"]),
]


def seed() -> None:
    for profile in BUILTIN_PROFILES:
        row = {**profile, "manifest": json.dumps(profile["manifest"], sort_keys=True),
               "builtin": 1, "created_at": _now()}
        db.upsert("profiles", row, ["id"],
                  ["name", "version", "maturity", "manifest", "builtin"])
