"""CyberBox CLI — run a code scan in CI without a running server (Strix OSS-CLI equivalent).

    python -m cyberbox.cli github-scan <repo> [--base origin/main] [--scope diff|full]
                                        [--fail-on high] [--sarif findings.sarif]

Exit codes mirror the scan gate: 0 pass, 2 findings at or above --fail-on, 1 error. Drop it
into a pipeline step and gate the build on the exit code; upload the SARIF to code scanning.
"""
from __future__ import annotations

import argparse
import json
import sys

from . import db
from .services import github, sarif


def _github_scan(args: argparse.Namespace) -> int:
    db.ensure_journal_mode()
    db.init_db()
    try:
        scan = github.scan_repository(
            args.repo, base=args.base, scope=args.scope, fail_on=args.fail_on)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if args.sarif:
        with open(args.sarif, "w") as fh:
            json.dump(sarif.to_sarif(scan["findings"]), fh, indent=2)
        print(f"SARIF written to {args.sarif}")
    counts = scan["summary"].get("counts", {})
    total = scan["summary"].get("total", 0)
    breakdown = ", ".join(f"{n} {s}" for s, n in counts.items() if n) or "none"
    print(f"CyberBox scan ({scan['scope']}): {total} finding(s) — {breakdown}")
    for f in scan.get("findings", []):
        print(f"  {f['severity'].upper():8} {f['file']}:{f['line']}  {f['detector']}")
    gate = scan["exit_code"] or 0
    verdict = "FAILED" if gate == 2 else "passed"
    print(f"gate ({args.fail_on}+): {verdict}")
    return gate


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="cyberbox")
    sub = parser.add_subparsers(dest="cmd")
    g = sub.add_parser("github-scan", help="scan a repo checkout for code vulnerabilities")
    g.add_argument("repo", help="path to the repository checkout")
    g.add_argument("--base", help="diff base (e.g. origin/main) for scope=diff")
    g.add_argument("--scope", default="diff", choices=["diff", "full"])
    g.add_argument("--fail-on", default="high", dest="fail_on",
                   choices=["critical", "high", "medium", "low"])
    g.add_argument("--sarif", help="write SARIF 2.1.0 to this path")
    args = parser.parse_args(argv)
    if args.cmd == "github-scan":
        return _github_scan(args)
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
