"""Template assistant — NL → nuclei YAML (offline rule-based or local LLM)."""
from __future__ import annotations

import json
import os
import re
import urllib.request

SEVERITY_HINTS = {
    "rce": "critical", "remote code": "critical", "sqli": "critical", "sql injection": "critical",
    "ssrf": "high", "auth bypass": "high", "secrets": "high", "idor": "high",
    "xss": "medium", "open redirect": "medium", "csrf": "medium",
    "debug": "low", "panel": "info",
}


def _guess_severity(text: str) -> str:
    low = text.lower()
    for k, v in SEVERITY_HINTS.items():
        if k in low:
            return v
    return "info"


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return "-".join(s.split("-")[:5]) or "custom-template"


def _rule_based(description: str) -> str:
    severity = _guess_severity(description)
    tid = _slug(description)
    low = description.lower()
    if "redirect" in low:
        matcher = '    path: ["{{BaseURL}}/redirect?url=https://example.org"]\n    matchers:\n      - type: regex\n        part: header\n        regex: ["(?i)Location:\\\\s*https?://example\\\\.org"]'
    elif "login" in low or "panel" in low:
        matcher = '    path: ["{{BaseURL}}/login"]\n    matchers:\n      - type: word\n        part: body\n        words: ["Sign in", "Log in"]'
    elif "debug" in low:
        matcher = '    path: ["{{BaseURL}}/?XDEBUG_SESSION_START=phpstorm"]\n    matchers:\n      - type: word\n        part: body\n        words: ["Whoops", "stack trace"]'
    elif "xss" in low:
        matcher = '    path: ["{{BaseURL}}/profile?name=<script>alert(1)</script>"]\n    matchers:\n      - type: word\n        part: body\n        words: ["<script>alert(1)</script>"]'
    else:
        matcher = '    path: ["{{BaseURL}}"]\n    matchers:\n      - type: status\n        status: [200]'
    return f"id: {tid}\ninfo:\n  name: {description.strip()[:80]}\n  author: cyberbox-assistant\n  severity: {severity}\n  tags: {tid}\nrequests:\n  - method: GET\n{matcher}\n"


def _ollama_generate(description: str, host: str, model: str) -> str | None:
    prompt = ("You are a nuclei template author. Output ONLY valid nuclei YAML v3. No prose.\n\n"
              + description)
    body = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode()
    req = urllib.request.Request(f"{host}/api/generate", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
            text = json.loads(r.read().decode()).get("response", "").strip()
            text = re.sub(r"^```ya?ml\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
            return text if text.startswith("id:") else None
    except Exception:  # noqa: BLE001
        return None


def generate_template(description: str, provider: str = "auto") -> dict:
    yaml_out = None
    source = "rule-based"
    if provider in ("auto", "ollama"):
        host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
        model = os.environ.get("CYBERBOX_TEMPLATE_MODEL", os.environ.get("NEO_TEMPLATE_MODEL", "qwen2.5-coder"))
        yaml_out = _ollama_generate(description, host, model)
        if yaml_out:
            source = f"ollama:{model}"
    if not yaml_out:
        yaml_out = _rule_based(description)
    m = re.search(r"^id:\s*(\S+)", yaml_out, re.MULTILINE)
    sev = re.search(r"severity:\s*(\w+)", yaml_out)
    return {"yaml": yaml_out, "template_id": m.group(1) if m else _slug(description),
            "severity": sev.group(1) if sev else _guess_severity(description), "source": source}
