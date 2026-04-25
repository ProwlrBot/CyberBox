"""
Merge cybersandbox + upstream sidecars into a single leaderboard data file.

Walks the harness output tree, classifies each JSON sidecar as either a
cybersandbox baseline or an upstream comparison run (by directory
convention: any path component named ``upstream`` flips the
classification), pairs them by (date, eval_name), and emits a unified
rows file the Rspress leaderboard page reads at build time.

Each merged row is validated against ``evaluation/leaderboard_schema.json``
before it lands in the output. Schema-invalid rows abort the run rather
than partially publish — silent corruption of the public leaderboard is
the failure mode this gate exists to prevent.

Spec 014, phase 3. Run from repo root:

    python3 evaluation/merge_leaderboard.py \\
        --in evaluation/result \\
        --out website/data/leaderboard.json

Single-target runs (cybersandbox-only, no paired upstream sidecar) still
land in the output with ``upstream: null`` — the schema permits this and
the leaderboard page renders the upstream column blank.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Tuple

import jsonschema

SCHEMA_PATH = Path(__file__).parent / "leaderboard_schema.json"


def classify(path: Path) -> str:
    """Return ``"upstream"`` if any directory component is ``upstream``, else ``"cybersandbox"``.

    The convention matches what ``evaluation/run_upstream.sh`` produces and
    what the GH Actions matrix in phase 5 will write.
    """
    return "upstream" if "upstream" in path.parts else "cybersandbox"


def extract_date(path: Path, in_root: Path) -> str:
    """Pull the YYYYMMDD date segment out of the path relative to ``in_root``.

    The harness always writes to ``result/<YYYYMMDD>/...``; if we can't
    find an 8-digit segment, fall back to ``unknown`` so pairing still
    happens deterministically (just within the same fallback bucket).
    """
    try:
        rel_parts = path.relative_to(in_root).parts
    except ValueError:
        rel_parts = path.parts
    for part in rel_parts:
        if len(part) == 8 and part.isdigit():
            return part
    return "unknown"


def load_sidecar(path: Path) -> Dict[str, Any]:
    """Read a sidecar file. Bubble JSON errors with a clearer message."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError as e:
        raise SystemExit(f"error: {path} is not valid JSON: {e}") from e


def merge(
    in_root: Path, out: Path, schema: Dict[str, Any]
) -> Tuple[int, int, int]:
    """Walk ``in_root``, pair sidecars, write merged rows.

    Returns a (rows_written, cb_seen, up_seen) tuple for the caller to
    surface in stderr — useful when the merge produces unexpectedly few
    rows and you need to see which side was thin.
    """
    grouped: Dict[Tuple[str, str], Dict[str, Path]] = {}

    for sidecar in sorted(in_root.rglob("*.json")):
        # Don't accidentally pick up the merged output if it lives under
        # the same in_root tree.
        if sidecar.name == "leaderboard.json":
            continue
        # Don't pick up unrelated json files — only sidecars validate
        # against our schema. Skip anything that doesn't even have a
        # `cyberbox` field at the top level.
        try:
            preview = json.loads(sidecar.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if not isinstance(preview, dict) or "cyberbox" not in preview:
            continue

        date = extract_date(sidecar, in_root)
        eval_name = sidecar.stem
        target = classify(sidecar)
        grouped.setdefault((date, eval_name), {})[target] = sidecar

    cb_seen = sum(1 for v in grouped.values() if "cybersandbox" in v)
    up_seen = sum(1 for v in grouped.values() if "upstream" in v)
    rows = []

    for (date, eval_name), pair in sorted(grouped.items()):
        cb_path = pair.get("cybersandbox")
        up_path = pair.get("upstream")

        if cb_path is None:
            # Upstream-only runs are not promoted into the leaderboard;
            # cybersandbox is the canonical "us" — without a cybersandbox
            # baseline there's no row to anchor the comparison.
            print(
                f"[skip] {date}/{eval_name}: upstream sidecar without cybersandbox baseline",
                file=sys.stderr,
            )
            continue

        row = load_sidecar(cb_path)
        if up_path is not None:
            upstream_sidecar = load_sidecar(up_path)
            # The upstream sidecar emits its metrics under "cyberbox"
            # (because the schema requires that field name regardless of
            # which target the harness ran against). Lift those into the
            # merged row's "upstream" slot.
            row["upstream"] = upstream_sidecar["cyberbox"]

        try:
            jsonschema.validate(instance=row, schema=schema)
        except jsonschema.ValidationError as e:
            raise SystemExit(
                f"error: merged row from {cb_path} fails schema validation: {e.message}"
            ) from e
        rows.append(row)

    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"rows": rows}
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    return len(rows), cb_seen, up_seen


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument(
        "--in",
        dest="in_root",
        required=True,
        type=Path,
        help="Harness output root (typically evaluation/result).",
    )
    ap.add_argument(
        "--out",
        dest="out",
        required=True,
        type=Path,
        help="Destination JSON path (typically website/data/leaderboard.json).",
    )
    args = ap.parse_args()

    if not args.in_root.is_dir():
        print(f"error: --in {args.in_root} is not a directory", file=sys.stderr)
        return 2

    if not SCHEMA_PATH.is_file():
        print(f"error: schema not found at {SCHEMA_PATH}", file=sys.stderr)
        return 2

    with open(SCHEMA_PATH, "r", encoding="utf-8") as fh:
        schema = json.load(fh)
    jsonschema.Draft202012Validator.check_schema(schema)

    n_rows, cb_seen, up_seen = merge(args.in_root, args.out, schema)
    print(
        f"Wrote {n_rows} row(s) to {args.out} "
        f"(cybersandbox sidecars: {cb_seen}, upstream sidecars: {up_seen})",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
