"""Runtime verification — confirms exploitability and produces reproducible PoCs."""
from __future__ import annotations

import urllib.parse
import urllib.request
import urllib.error


def _curl_poc(method: str, url: str, headers: dict | None = None, body: str | None = None) -> str:
    parts = [f"curl -sk -X {method}"]
    for k, v in (headers or {}).items():
        parts.append(f"-H '{k}: {v}'")
    if body:
        parts.append(f"--data '{body}'")
    parts.append(f"'{url}'")
    return " ".join(parts)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


_no_redirect_opener = urllib.request.build_opener(_NoRedirect)


def _fetch(url: str, headers: dict | None = None, method: str = "GET",
           timeout: int = 12, follow_redirects: bool = True) -> tuple[int, dict, str]:
    req = urllib.request.Request(url, method=method, headers=headers or {})
    opener = urllib.request.urlopen if follow_redirects else _no_redirect_opener.open
    try:
        with opener(req, timeout=timeout) as resp:  # noqa: S310
            return resp.status, dict(resp.headers), resp.read(65536).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), (e.read(8192).decode("utf-8", "replace") if e.fp else "")
    except Exception:  # noqa: BLE001
        return 0, {}, ""


def verify_open_redirect(url: str) -> tuple[bool, str, list]:
    canary = "https://cyberbox-oob.example.org/"
    test = url.split("?")[0] + "?url=" + urllib.parse.quote(canary)
    status, headers, _ = _fetch(test, follow_redirects=False)
    loc = headers.get("Location", "")
    if loc.startswith(canary) or "cyberbox-oob.example.org" in loc:
        poc = _curl_poc("GET", test)
        return True, f"Redirect honored to attacker host:\n{poc}\n-> {loc}", \
            [{"request": poc, "response": f"{status} Location: {loc}"}]
    return False, "", []


def verify_idor_sequential(matched_at: str) -> tuple[bool, str, list]:
    base = matched_at.rstrip("0123456789").rstrip("/")
    chain, distinct = [], set()
    for i in (1, 2, 3):
        u = f"{base}/{i}"
        status, _, body = _fetch(u)
        chain.append({"request": _curl_poc("GET", u), "response": f"{status} ({len(body)} bytes)"})
        if status == 200:
            distinct.add(body[:256])
    if len(distinct) >= 2:
        poc = "Sequential object IDs return distinct unauthenticated responses:\n" + \
              "\n".join(c["request"] for c in chain)
        return True, poc, chain
    return False, "", []


def verify_secrets_exposure(url: str) -> tuple[bool, str, list]:
    import re
    status, _, body = _fetch(url)
    if status == 200 and re.search(r"(?i)(secret|password|api[_-]?key|AKIA[0-9A-Z]{16})\s*[=:\"]", body):
        snippet = body[:300]
        poc = f"Config endpoint leaks secrets:\n{_curl_poc('GET', url)}\n\n{snippet}"
        return True, poc, [{"request": _curl_poc("GET", url), "response": f"{status}\n{snippet}"}]
    return False, "", []


def verify_cloud_metadata(url: str) -> tuple[bool, str, list]:
    status, _, body = _fetch(url, headers={"Metadata": "true"})
    if status == 200 and ("AccessKeyId" in body or "SecretAccessKey" in body):
        poc = _curl_poc("GET", url, {"Metadata": "true"})
        return True, f"SSRF reaches cloud IMDS:\n{poc}", \
            [{"request": poc, "response": f"{status}\n{body[:300]}"}]
    return False, "", []


VERIFIERS = {
    "open-redirect": verify_open_redirect,
    "idor-sequential-id": verify_idor_sequential,
    "unauth-config-secrets": verify_secrets_exposure,
    "aws-keys-exposure": verify_secrets_exposure,
    "cloud-metadata-ssrf": verify_cloud_metadata,
}


def verify_finding(template_id: str, matched_at: str, rec: dict) -> tuple[bool, str, list]:
    for key, fn in VERIFIERS.items():
        if key in template_id:
            try:
                return fn(matched_at)
            except Exception:  # noqa: BLE001
                break
    extracted = rec.get("extracted-results") or []
    poc = _curl_poc("GET", matched_at)
    if extracted:
        poc += "\n\nExtracted: " + ", ".join(map(str, extracted))
    return False, poc, [{"request": poc, "response": "matcher hit (pending runtime verification)"}]
