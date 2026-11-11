"""SARIF 2.1.0 export — turn code_findings into the format GitHub code scanning ingests.

Kept pure and dependency-free so it can serialize any finding list (github scan, pr_review,
scheduled rescan). The shape follows the OASIS SARIF 2.1.0 schema: one run, one tool driver
with a rules catalog, and one result per finding pointing at a physical location.
"""
from __future__ import annotations

from typing import Iterable

_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json"

# SARIF level is one of error|warning|note. Map our severities onto it, and carry the raw
# severity in properties so nothing is lost.
_LEVEL = {"critical": "error", "high": "error", "medium": "warning", "low": "note"}
# security-severity is a 0-10 string GitHub uses to bucket findings in the UI.
_SECURITY_SEVERITY = {"critical": "9.5", "high": "8.1", "medium": "5.5", "low": "3.1"}


def _rule(finding: dict) -> dict:
    rid = finding["rule_id"]
    sev = (finding.get("severity") or "medium").lower()
    return {
        "id": rid,
        "name": finding.get("detector", rid),
        "shortDescription": {"text": finding.get("detector", rid)},
        "defaultConfiguration": {"level": _LEVEL.get(sev, "warning")},
        "properties": {
            "security-severity": _SECURITY_SEVERITY.get(sev, "5.5"),
            "tags": ["security"],
        },
    }


def _result(finding: dict) -> dict:
    sev = (finding.get("severity") or "medium").lower()
    result = {
        "ruleId": finding["rule_id"],
        "level": _LEVEL.get(sev, "warning"),
        "message": {"text": finding.get("message") or finding.get("detector", finding["rule_id"])},
        "locations": [{
            "physicalLocation": {
                "artifactLocation": {"uri": finding["file"]},
                "region": {"startLine": max(1, int(finding.get("line") or 1))},
            },
        }],
        "properties": {"severity": sev},
    }
    fp = finding.get("fingerprint")
    if fp:
        # partialFingerprints lets GitHub track a finding across commits even if the line moves.
        result["partialFingerprints"] = {"cyberbox/v1": fp}
    snippet = finding.get("snippet")
    if snippet:
        result["locations"][0]["physicalLocation"]["region"]["snippet"] = {"text": snippet}
    return result


def to_sarif(findings: Iterable[dict], tool_name: str = "CyberBox",
             version: str = "0.1.0", info_uri: str = "https://github.com/kdairatchi/CyberBox") -> dict:
    """Build a SARIF 2.1.0 log from an iterable of finding dicts.

    Each finding needs: rule_id, detector, severity, file, line, message; optional
    fingerprint, snippet. Rules are de-duplicated by rule_id into the driver's catalog.
    """
    findings = list(findings)
    rules: dict[str, dict] = {}
    for f in findings:
        rules.setdefault(f["rule_id"], _rule(f))
    return {
        "version": "2.1.0",
        "$schema": _SCHEMA,
        "runs": [{
            "tool": {
                "driver": {
                    "name": tool_name,
                    "version": version,
                    "informationUri": info_uri,
                    "rules": list(rules.values()),
                },
            },
            "results": [_result(f) for f in findings],
        }],
    }
