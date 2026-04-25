"""Tests for evaluation/leaderboard_schema.json (spec 014, phase 7-1).

Locks in the contract that the JSON sidecar emitter (evaluation/main.py)
and the leaderboard merger (evaluation/merge_leaderboard.py) both depend
on. Catches schema drift at PR-time, before either side silently breaks.
"""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

HERE = Path(__file__).resolve().parent
EVAL_ROOT = HERE.parent
REPO_ROOT = EVAL_ROOT.parent

SCHEMA_PATH = EVAL_ROOT / "leaderboard_schema.json"
PUBLISHED_DATA = REPO_ROOT / "website" / "data" / "leaderboard.json"


@pytest.fixture
def schema():
    with open(SCHEMA_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture
def valid_row():
    """Minimal-yet-complete row that exercises every required schema field."""
    return {
        "id": "20260425-evaluation_ping",
        "config_ref": "evaluation/configs/langgraph_ping.toml",
        "eval_file": "evaluation/dataset/evaluation_ping.xml",
        "release_tag": None,
        "run_timestamp_utc": "2026-04-25T05:30:00Z",
        "harness_version": "0.1.0",
        "runtime": "langgraph",
        "cyberbox": {
            "pass_rate": 1.0,
            "total_tasks": 1,
            "passed_tasks": 1,
            "latency_ms_p50": 3430.0,
            "latency_ms_p95": None,
            "latency_ms_mean": 3430.0,
            "tool_calls": 5,
            "cost_usd": None,
            "token_input": None,
            "token_output": None,
        },
        "upstream": None,
    }


def test_schema_is_valid_draft_2020_12(schema):
    """The schema must itself be a valid JSON Schema."""
    jsonschema.Draft202012Validator.check_schema(schema)


def test_valid_row_accepted(schema, valid_row):
    """A complete, well-formed row passes."""
    jsonschema.validate(instance=valid_row, schema=schema)


def test_pass_rate_above_one_rejected(schema, valid_row):
    """pass_rate has range [0, 1]; values outside must be rejected."""
    valid_row["cyberbox"]["pass_rate"] = 1.5
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=valid_row, schema=schema)


def test_pass_rate_negative_rejected(schema, valid_row):
    valid_row["cyberbox"]["pass_rate"] = -0.1
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=valid_row, schema=schema)


def test_missing_required_metrics_field_rejected(schema, valid_row):
    """Removing pass_rate from the metrics block must fail."""
    del valid_row["cyberbox"]["pass_rate"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=valid_row, schema=schema)


def test_missing_required_top_level_field_rejected(schema, valid_row):
    """Top-level required fields are load-bearing for reproducibility."""
    del valid_row["config_ref"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=valid_row, schema=schema)


def test_unknown_runtime_rejected(schema, valid_row):
    """runtime is an enum of agent backend names."""
    valid_row["runtime"] = "made_up_agent"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=valid_row, schema=schema)


def test_id_pattern_enforced(schema, valid_row):
    """id format is <YYYYMMDD>-<eval_stem> — a freeform string is rejected."""
    valid_row["id"] = "not-a-date-prefix"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=valid_row, schema=schema)


def test_config_ref_pattern_enforced(schema, valid_row):
    """config_ref must point under evaluation/configs/ or evaluation/dataset/."""
    valid_row["config_ref"] = "/etc/passwd"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=valid_row, schema=schema)


def test_eval_file_must_be_xml_under_dataset(schema, valid_row):
    valid_row["eval_file"] = "evaluation/configs/foo.toml"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=valid_row, schema=schema)


def test_upstream_can_be_null(schema, valid_row):
    """Single-target runs (cybersandbox-only) are valid with upstream=null."""
    valid_row["upstream"] = None
    jsonschema.validate(instance=valid_row, schema=schema)


def test_upstream_can_be_metrics_block(schema, valid_row):
    """After phase 3 merge, upstream populates with the same shape as cyberbox."""
    valid_row["upstream"] = {
        "pass_rate": 0.5,
        "total_tasks": 4,
        "passed_tasks": 2,
        "latency_ms_p50": 5000.0,
        "latency_ms_p95": None,
        "latency_ms_mean": 5000.0,
        "tool_calls": 12,
        "cost_usd": None,
        "token_input": None,
        "token_output": None,
    }
    jsonschema.validate(instance=valid_row, schema=schema)


def test_extra_top_level_field_rejected(schema, valid_row):
    """additionalProperties: false at the top level — schema drift fails fast."""
    valid_row["surprise_field"] = "x"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=valid_row, schema=schema)


def test_extra_metrics_field_rejected(schema, valid_row):
    """additionalProperties: false on metrics_block too."""
    valid_row["cyberbox"]["weird_metric"] = 42
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=valid_row, schema=schema)


def test_per_task_array_optional(schema, valid_row):
    """per_task is optional but, when present, items must conform."""
    valid_row["per_task"] = [
        {
            "prompt": "p",
            "expected": "e",
            "actual": "e",
            "score": 1,
            "duration_ms": 3430.0,
            "num_tool_calls": 5,
        }
    ]
    jsonschema.validate(instance=valid_row, schema=schema)


def test_per_task_score_must_be_zero_or_one(schema, valid_row):
    valid_row["per_task"] = [
        {
            "prompt": "p",
            "expected": "e",
            "actual": "e",
            "score": 2,  # invalid — enum is [0, 1]
            "duration_ms": 3430.0,
            "num_tool_calls": 5,
        }
    ]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=valid_row, schema=schema)


def test_published_seed_validates(schema):
    """The checked-in website/data/leaderboard.json must validate row-by-row.

    This is the failure mode the validate-leaderboard.yml workflow gates
    against on every PR, but having it as a unit test means a contributor
    running pytest locally also catches it before pushing.
    """
    if not PUBLISHED_DATA.is_file():
        pytest.skip(f"published data not present at {PUBLISHED_DATA}")
    with open(PUBLISHED_DATA, "r", encoding="utf-8") as fh:
        published = json.load(fh)
    assert "rows" in published, "published data must have a top-level 'rows' array"
    for i, row in enumerate(published["rows"]):
        try:
            jsonschema.validate(instance=row, schema=schema)
        except jsonschema.ValidationError as e:
            pytest.fail(
                f"published row {i} (id={row.get('id', '<no id>')}) fails schema: {e.message}"
            )
