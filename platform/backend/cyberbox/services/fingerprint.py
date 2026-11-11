"""Passive, unauthenticated fingerprinting of WordPress and GitLab targets.

Every request here is a GET to a fixed, well-known path — no user-controlled path segment, no
body, no auth. The point is a fast "what is this and where's the soft surface" preview that the
UI can render visually, not an exploit. Two safety layers apply before any socket opens:

  1. Cloud-metadata endpoints (169.254.169.254 and friends) are hard-blocked, always — they are
     never a legitimate target and are the crown-jewel SSRF destination.
  2. Everything else is the caller's responsibility to scope-gate (policy.evaluate) — lab/CTF
     engagements legitimately scope private ranges, so we do not blanket-block RFC1918 here.

Parsing is defensive: a missing or garbage response for one probe never sinks the whole result,
it just leaves that field empty. The caller gets a structured dict either way.
"""
from __future__ import annotations

import ipaddress
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

_UA = "CyberBox-Fingerprint/1.0"
_TIMEOUT = 6
_MAX_BYTES = 512 * 1024

# Link-local / cloud-metadata ranges that must never be probed.
_METADATA_NETS = [
    ipaddress.ip_network("169.254.0.0/16"),       # AWS/GCP/Azure IMDS, incl. 169.254.169.254
    ipaddress.ip_network("fd00:ec2::/64"),         # AWS IMDSv2 over IPv6
    ipaddress.ip_network("fe80::/10"),             # IPv6 link-local
]


class ProbeBlocked(Exception):
    """Raised when a host resolves to a hard-blocked (metadata) address."""


def _assert_not_metadata(host: str) -> None:
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ProbeBlocked(f"cannot resolve host: {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if any(ip in net for net in _METADATA_NETS):
            raise ProbeBlocked("target resolves to a link-local / cloud-metadata address")


def _get(url: str) -> tuple[int, dict, str]:
    """GET a URL. Returns (status, headers_lower, body_text). Redirects are not followed so a
    probe cannot be bounced onto a different host. Non-2xx still returns — a 401/405 is signal."""
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ProbeBlocked("invalid probe URL")
    _assert_not_metadata(parsed.hostname)

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_a, **_k):  # noqa: ANN002, ANN003
            return None

    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "*/*"}, method="GET")
    try:
        with opener.open(req, timeout=_TIMEOUT) as resp:
            raw = resp.read(_MAX_BYTES)
            hdrs = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, hdrs, raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:  # 4xx/5xx carry signal (401 gitlab, 405 xmlrpc)
        hdrs = {k.lower(): v for k, v in (exc.headers or {}).items()}
        body = ""
        try:
            body = exc.read(_MAX_BYTES).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            pass
        return exc.code, hdrs, body
    except (urllib.error.URLError, socket.timeout, OSError):
        return 0, {}, ""


def _base(url: str) -> str:
    parsed = urllib.parse.urlsplit(url if "://" in url else f"https://{url}")
    return f"{parsed.scheme}://{parsed.netloc}"


_SEC_HEADERS = [
    "strict-transport-security", "content-security-policy", "x-frame-options",
    "x-content-type-options", "referrer-policy", "permissions-policy",
]


def _security_headers(hdrs: dict) -> dict:
    return {h: (hdrs.get(h) or None) for h in _SEC_HEADERS}


# ── WordPress ────────────────────────────────────────────────────────────────────

_GEN_RE = re.compile(r'<meta[^>]+name=["\']generator["\'][^>]+content=["\']([^"\']+)["\']', re.I)
_WP_VER_RE = re.compile(r"WordPress\s+([0-9][0-9.]*)", re.I)
_PLUGIN_RE = re.compile(r"/wp-content/plugins/([a-z0-9][a-z0-9_.-]+)/[^\"'?]*(?:\?ver=([0-9][0-9.]*))?", re.I)
_THEME_RE = re.compile(r"/wp-content/themes/([a-z0-9][a-z0-9_.-]+)/[^\"'?]*(?:\?ver=([0-9][0-9.]*))?", re.I)


def fingerprint_wordpress(target_url: str) -> dict:
    base = _base(target_url)
    out: dict = {"target": base, "is_wordpress": False, "version": None, "generator": None,
                 "rest_enabled": False, "namespaces": [], "route_count": 0, "users": [],
                 "plugins": [], "themes": [], "exposed": {}, "security_headers": {},
                 "server": None, "errors": []}

    # Landing page: generator, plugins/themes, headers.
    status, hdrs, html = _get(base + "/")
    if status:
        out["server"] = hdrs.get("server")
        out["security_headers"] = _security_headers(hdrs)
        gen = _GEN_RE.search(html)
        if gen:
            out["generator"] = gen.group(1)
            m = _WP_VER_RE.search(gen.group(1))
            if m:
                out["version"] = m.group(1)
                out["is_wordpress"] = True
        plugins: dict[str, str | None] = {}
        for slug, ver in _PLUGIN_RE.findall(html):
            plugins.setdefault(slug, None)
            if ver:
                plugins[slug] = ver
        out["plugins"] = [{"slug": s, "version": v} for s, v in sorted(plugins.items())]
        themes: dict[str, str | None] = {}
        for slug, ver in _THEME_RE.findall(html):
            themes.setdefault(slug, None)
            if ver:
                themes[slug] = ver
        out["themes"] = [{"slug": s, "version": v} for s, v in sorted(themes.items())]
        if plugins or themes:
            out["is_wordpress"] = True

    # REST index: namespaces + route surface.
    status, _h, body = _get(base + "/wp-json/")
    if status == 200 and body:
        try:
            data = json.loads(body)
            out["rest_enabled"] = True
            out["is_wordpress"] = True
            out["namespaces"] = data.get("namespaces", [])[:40]
            out["route_count"] = len(data.get("routes", {}))
            if not out["version"] and isinstance(data.get("description"), str):
                pass
        except json.JSONDecodeError:
            out["errors"].append("wp-json returned non-JSON")

    # User enumeration — the classic.
    status, _h, body = _get(base + "/wp-json/wp/v2/users")
    if status == 200 and body:
        try:
            users = json.loads(body)
            if isinstance(users, list):
                out["users"] = [{"id": u.get("id"), "name": u.get("name"), "slug": u.get("slug")}
                                for u in users[:50] if isinstance(u, dict)]
        except json.JSONDecodeError:
            pass

    # Exposed soft surface.
    xmlrpc_status, _h, _b = _get(base + "/xmlrpc.php")
    readme_status, _rh, readme = _get(base + "/readme.html")
    if not out["version"] and readme_status == 200:
        m = _WP_VER_RE.search(readme)
        if m:
            out["version"] = m.group(1)
    out["exposed"] = {
        "xmlrpc": xmlrpc_status in (200, 405),           # 405 on GET = present
        "readme": readme_status == 200,
        "login": _get(base + "/wp-login.php")[0] in (200, 302),
        "rest_users": bool(out["users"]),
        "user_enum_count": len(out["users"]),
    }
    return out


# ── GitLab ───────────────────────────────────────────────────────────────────────

_GON_REV_RE = re.compile(r'"revision":"([0-9a-f]{6,})"')
_GL_VER_META_RE = re.compile(r'content=["\']GitLab\s+([0-9][0-9.]*)', re.I)


def fingerprint_gitlab(target_url: str) -> dict:
    base = _base(target_url)
    out: dict = {"target": base, "is_gitlab": False, "version": None, "revision": None,
                 "enterprise": None, "signup_enabled": None, "api_reachable": False,
                 "public_projects": [], "public_project_count": 0, "exposed": {},
                 "security_headers": {}, "server": None, "errors": []}

    # /api/v4/version — public on some instances, 401 (still a GitLab tell) on most.
    status, hdrs, body = _get(base + "/api/v4/version")
    if status:
        out["api_reachable"] = True
        if hdrs.get("x-gitlab-feature-category") is not None or "gitlab" in (hdrs.get("server") or "").lower():
            out["is_gitlab"] = True
    if status == 200 and body:
        try:
            v = json.loads(body)
            out["version"] = v.get("version")
            out["revision"] = v.get("revision")
            out["enterprise"] = v.get("enterprise")
            out["is_gitlab"] = True
        except json.JSONDecodeError:
            pass
    elif status == 401:
        out["is_gitlab"] = True  # auth-required API is itself a GitLab signal

    # Landing page: gon.revision, meta generator, headers.
    status, hdrs, html = _get(base + "/")
    if status:
        out["server"] = out["server"] or hdrs.get("server")
        out["security_headers"] = _security_headers(hdrs)
        rev = _GON_REV_RE.search(html)
        if rev and not out["revision"]:
            out["revision"] = rev.group(1)
            out["is_gitlab"] = True
        mv = _GL_VER_META_RE.search(html)
        if mv and not out["version"]:
            out["version"] = mv.group(1)
        if "gitlab" in html.lower()[:4000]:
            out["is_gitlab"] = out["is_gitlab"] or ("gitlab" in (hdrs.get("x-request-id") or "").lower())

    # Open sign-up?
    signup_status, _h, _b = _get(base + "/users/sign_up")
    out["signup_enabled"] = signup_status == 200

    # Public projects (no auth).
    status, _h, body = _get(base + "/api/v4/projects?visibility=public&per_page=10&order_by=last_activity_at")
    if status == 200 and body:
        try:
            projects = json.loads(body)
            if isinstance(projects, list):
                out["public_projects"] = [
                    {"path": p.get("path_with_namespace"), "name": p.get("name"),
                     "star_count": p.get("star_count"), "last_activity_at": p.get("last_activity_at")}
                    for p in projects[:15] if isinstance(p, dict)]
                out["public_project_count"] = len(out["public_projects"])
                out["is_gitlab"] = True
        except json.JSONDecodeError:
            pass

    out["exposed"] = {
        "open_signup": bool(out["signup_enabled"]),
        "public_api": out["api_reachable"],
        "public_projects": out["public_project_count"] > 0,
        "explore": _get(base + "/explore")[0] == 200,
        "graphql": _get(base + "/api/graphql")[0] in (200, 400, 401, 405),
    }
    return out
