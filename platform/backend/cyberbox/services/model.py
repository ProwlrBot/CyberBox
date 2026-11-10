"""Provider-agnostic model router.

Provider configuration lives in the `model_providers` DB table, managed
through the API (/api/v1/providers). Built-in defaults are only used to seed
the table on first run — they are not hardcoded into runtime paths.

Supported kinds:
  openai_compat — OpenAI Chat Completions API (LM Studio, Ollama, DeepSeek, Pi, OpenAI)
  anthropic     — Anthropic Messages API
  ollama        — Ollama /api/generate (also supports openai_compat via /v1)

Privacy gate: providers with local=0 require allow_external=True. Use this to
prevent private program data from leaving the host without explicit opt-in.
"""
from __future__ import annotations

import json
import os
import uuid
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Any

from .. import db

# ---------------------------------------------------------------------------
# Built-in provider seeds — only written once on first run, then DB wins
# ---------------------------------------------------------------------------

_BUILTIN_SEEDS = [
    {
        "id":            "lmstudio",
        "name":          "LM Studio",
        "kind":          "openai_compat",
        "base_url":      "http://localhost:1234/v1",
        "api_key_env":   None,
        "default_model": None,          # uses whatever model is currently loaded
        "local":         1,
        "metadata":      json.dumps({"note": "Any model loaded in LM Studio works automatically"}),
    },
    {
        "id":            "ollama",
        "name":          "Ollama",
        "kind":          "openai_compat",
        "base_url":      "http://localhost:11434/v1",
        "api_key_env":   None,
        "default_model": "llama3.2",
        "local":         1,
        "metadata":      json.dumps({"note": "hermes3, deepseek-coder, llama3.2 all work via /v1"}),
    },
    {
        "id":            "anthropic",
        "name":          "Claude (Anthropic)",
        "kind":          "anthropic",
        "base_url":      "https://api.anthropic.com/v1",
        "api_key_env":   "ANTHROPIC_API_KEY",
        "default_model": "claude-sonnet-4-5",
        "local":         0,
        "metadata":      json.dumps({"models": ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"]}),
    },
    {
        "id":            "openai",
        "name":          "OpenAI / Codex",
        "kind":          "openai_compat",
        "base_url":      "https://api.openai.com/v1",
        "api_key_env":   "OPENAI_API_KEY",
        "default_model": "gpt-4o",
        "local":         0,
        "metadata":      json.dumps({"models": ["gpt-4o", "gpt-4o-mini", "o3", "o3-mini"]}),
    },
    {
        "id":            "deepseek",
        "name":          "DeepSeek",
        "kind":          "openai_compat",
        "base_url":      "https://api.deepseek.com/v1",
        "api_key_env":   "DEEPSEEK_API_KEY",
        "default_model": "deepseek-chat",
        "local":         0,
        "metadata":      json.dumps({"models": ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"]}),
    },
    {
        "id":            "pi",
        "name":          "Pi (Inflection)",
        "kind":          "openai_compat",
        "base_url":      "https://api.inflection.ai/v1",
        "api_key_env":   "PI_API_KEY",
        "default_model": "inflection_3_pi",
        "local":         0,
        "metadata":      json.dumps({"models": ["inflection_3_pi", "inflection_3_productivity"]}),
    },
    {
        "id":            "pentestcode",
        "name":          "PentestCoder (Ollama)",
        "kind":          "openai_compat",
        "base_url":      "http://localhost:11434/v1",
        "api_key_env":   None,
        "default_model": "pentestcoder",
        "local":         1,
        "metadata":      json.dumps({"note": "Requires: ollama pull pentestcoder"}),
    },
    {
        "id":            "hermes",
        "name":          "Hermes (Ollama)",
        "kind":          "openai_compat",
        "base_url":      "http://localhost:11434/v1",
        "api_key_env":   None,
        "default_model": "hermes3",
        "local":         1,
        "metadata":      json.dumps({"note": "Requires: ollama pull hermes3"}),
    },
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def seed_providers() -> None:
    """Write built-in providers only if the table is empty."""
    existing = db.query("SELECT id FROM model_providers LIMIT 1")
    if existing:
        return
    for p in _BUILTIN_SEEDS:
        row = {**p, "enabled": 1, "created_at": _now()}
        try:
            db.insert("model_providers", row)
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------------------
# DB accessors
# ---------------------------------------------------------------------------

def get_provider(provider_id: str) -> dict:
    row = db.query_one("SELECT * FROM model_providers WHERE id=? AND enabled=1", [provider_id])
    if not row:
        raise ValueError(f"provider not found or disabled: {provider_id!r}")
    return dict(row)


def list_all_providers() -> list[dict]:
    return [dict(r) for r in db.query("SELECT * FROM model_providers ORDER BY local DESC, name")]


def upsert_provider(data: dict) -> dict:
    pid = data.get("id") or str(uuid.uuid4())
    required = ("name", "kind", "base_url")
    for f in required:
        if not data.get(f):
            raise ValueError(f"missing required field: {f}")
    if data["kind"] not in ("openai_compat", "anthropic", "ollama", "custom"):
        raise ValueError(f"unknown kind: {data['kind']!r}")
    row = {
        "id":            pid,
        "name":          data["name"],
        "kind":          data["kind"],
        "base_url":      data["base_url"].rstrip("/"),
        "api_key_env":   data.get("api_key_env"),
        "default_model": data.get("default_model"),
        "enabled":       int(data.get("enabled", 1)),
        "local":         int(data.get("local", 0)),
        "metadata":      json.dumps(data.get("metadata") or {}),
        "created_at":    _now(),
    }
    db.upsert("model_providers", row, ["id"],
              ["name", "kind", "base_url", "api_key_env", "default_model",
               "enabled", "local", "metadata"])
    return row


def delete_provider(provider_id: str) -> None:
    db.execute("DELETE FROM model_providers WHERE id=?", [provider_id])


# ---------------------------------------------------------------------------
# API key resolution — reads from env, never stored in DB
# ---------------------------------------------------------------------------

def _resolve_key(cfg: dict) -> str | None:
    env = cfg.get("api_key_env")
    if env:
        return os.environ.get(env)
    return "no-key"       # local providers accept any key


# ---------------------------------------------------------------------------
# Completion
# ---------------------------------------------------------------------------

def complete(
    messages: list[dict],
    provider_id: str = "lmstudio",
    model: str | None = None,
    max_tokens: int = 2048,
    temperature: float = 0.3,
    system: str | None = None,
    allow_external: bool = False,
    timeout: int = 60,
) -> str:
    """Call the model and return the response text.

    For Anthropic: messages use role 'user'/'assistant'.
    For openai_compat: a 'system' role message is prepended automatically.
    """
    cfg = get_provider(provider_id)

    if not cfg["local"] and not allow_external:
        raise ValueError(
            f"provider '{provider_id}' is external. "
            "Pass allow_external=True or set it on the engagement to permit."
        )

    effective_model = model or cfg.get("default_model")
    base = cfg["base_url"].rstrip("/")
    key = _resolve_key(cfg)

    if cfg["kind"] == "anthropic":
        return _call_anthropic(base, key, effective_model, messages, system,
                               max_tokens, temperature, timeout)
    # openai_compat and ollama both use the Chat Completions path
    return _call_openai_compat(base, key, effective_model, messages, system,
                               max_tokens, temperature, timeout)


# ---------------------------------------------------------------------------
# Probe
# ---------------------------------------------------------------------------

def probe(provider_id: str) -> dict:
    """Return {id, name, status, model_count, models?, error?}."""
    try:
        cfg = get_provider(provider_id)
    except ValueError as exc:
        return {"id": provider_id, "status": "not_found", "error": str(exc)}

    if not cfg["local"]:
        key = _resolve_key(cfg)
        if not key:
            env = cfg.get("api_key_env") or "KEY"
            return {"id": provider_id, "name": cfg["name"],
                    "status": "no_key", "error": f"{env} not set in environment"}

    try:
        base = cfg["base_url"].rstrip("/")
        key = _resolve_key(cfg) or "no-key"
        if cfg["kind"] == "anthropic":
            return _probe_anthropic(provider_id, cfg["name"], base, key)
        return _probe_openai_compat(provider_id, cfg["name"], base, key)
    except Exception as exc:  # noqa: BLE001
        return {"id": provider_id, "name": cfg["name"], "status": "error",
                "error": str(exc)[:160]}


def probe_all() -> list[dict]:
    return [probe(r["id"]) for r in list_all_providers()]


# ---------------------------------------------------------------------------
# OpenAI-compatible
# ---------------------------------------------------------------------------

def _call_openai_compat(
    base: str, key: str | None, model: str | None,
    messages: list[dict], system: str | None,
    max_tokens: int, temperature: float, timeout: int,
) -> str:
    all_msgs: list[dict] = []
    if system:
        all_msgs.append({"role": "system", "content": system})
    all_msgs.extend(messages)
    payload: dict[str, Any] = {
        "messages": all_msgs,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if model:
        payload["model"] = model
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {key or 'no-key'}"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        data = json.loads(resp.read().decode())
    return data["choices"][0]["message"]["content"]


def _probe_openai_compat(pid: str, name: str, base: str, key: str) -> dict:
    req = urllib.request.Request(
        f"{base}/models",
        headers={"Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310
        data = json.loads(resp.read().decode())
    models = data.get("data", [])
    return {"id": pid, "name": name, "status": "ok",
            "model_count": len(models),
            "models": [m.get("id") for m in models[:15]]}


# ---------------------------------------------------------------------------
# Anthropic Messages API
# ---------------------------------------------------------------------------

def _call_anthropic(
    base: str, key: str | None, model: str | None,
    messages: list[dict], system: str | None,
    max_tokens: int, temperature: float, timeout: int,
) -> str:
    if not key:
        raise ValueError("ANTHROPIC_API_KEY not set")
    payload: dict[str, Any] = {
        "model":       model or "claude-sonnet-4-5",
        "max_tokens":  max_tokens,
        "temperature": temperature,
        "messages":    messages,
    }
    if system:
        payload["system"] = system
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{base}/messages",
        data=body,
        headers={"Content-Type": "application/json",
                 "x-api-key": key,
                 "anthropic-version": "2023-06-01"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        data = json.loads(resp.read().decode())
    return "".join(
        b.get("text", "") for b in data.get("content", [])
        if b.get("type") == "text"
    )


def _probe_anthropic(pid: str, name: str, base: str, key: str) -> dict:
    req = urllib.request.Request(
        f"{base}/models",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
    )
    with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310
        data = json.loads(resp.read().decode())
    models = data.get("data", [])
    return {"id": pid, "name": name, "status": "ok",
            "model_count": len(models),
            "models": [m.get("id") for m in models[:15]]}
