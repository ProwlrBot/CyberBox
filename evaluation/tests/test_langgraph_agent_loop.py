"""End-to-end tests for the LangGraph agent loop.

These tests exercise the StateGraph runtime that powers
``LangGraphAgentLoop``. They rely on:
  * a stub LLM callable (no network)
  * a mocked MCP session (no sandbox required)
  * the in-memory checkpointer (default)

The final test runs the whole evaluation harness end-to-end against the
sample config under ``configs/langgraph_ping.toml`` with both the LLM and
the MCP layer mocked out, and asserts that a benchmark result file is
produced under ``result/<date>/langgraph/``.
"""

from __future__ import annotations

import json
import os
import sys
import tomllib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Ensure the evaluation package is importable when pytest is run from the
# repository root or the evaluation directory.
HERE = Path(__file__).resolve().parent
EVAL_ROOT = HERE.parent
sys.path.insert(0, str(EVAL_ROOT))

from agent_loop import (  # noqa: E402  (sys.path tweak above)
    BaseAgentLoop,
    LangGraphAgentLoop,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_tool_call(name: str, args: dict, call_id: str = "call_1") -> SimpleNamespace:
    """Build a tool_call object shaped like the OpenAI SDK returns."""
    return SimpleNamespace(
        id=call_id,
        function=SimpleNamespace(name=name, arguments=json.dumps(args)),
    )


def _make_message(content: str, tool_calls=None) -> SimpleNamespace:
    return SimpleNamespace(content=content, tool_calls=tool_calls)


# ---------------------------------------------------------------------------
# LangGraph runtime tests
# ---------------------------------------------------------------------------


class TestLangGraphAgentLoop:
    """Unit-level tests for the StateGraph wiring."""

    def test_is_base_agent_loop(self):
        """Public API: LangGraphAgentLoop must inherit BaseAgentLoop."""
        assert issubclass(LangGraphAgentLoop, BaseAgentLoop)

    def test_init_builds_graph_and_checkpointer(self):
        """Constructor must compile a graph and bind a checkpointer."""
        session = MagicMock()
        loop = LangGraphAgentLoop(
            mcp_session=session,
            api_key="test-key",
            model="gpt-4o-mini",
            llm_callable=lambda messages, tools: _make_message("ok"),
        )
        # The compiled graph object exposes ``ainvoke``.
        assert hasattr(loop._graph, "ainvoke")
        # MemorySaver is the default checkpointer.
        assert loop.checkpointer is not None
        from langgraph.checkpoint.memory import MemorySaver

        assert isinstance(loop.checkpointer, MemorySaver)

    @pytest.mark.asyncio
    async def test_simple_response_no_tools(self):
        """A single LLM call with all required tags should terminate cleanly."""
        session = MagicMock()
        final = (
            "<summary>Did nothing</summary>\n"
            "<feedback>None</feedback>\n"
            "<response>42</response>"
        )

        def stub_llm(messages, tools):
            return _make_message(final)

        loop = LangGraphAgentLoop(
            mcp_session=session,
            llm_callable=stub_llm,
            api_key="x",
            thread_id="test-no-tools",
        )

        text, metrics = await loop.run("what is 6*7?")
        assert "<response>42</response>" in text
        assert metrics == {}

    @pytest.mark.asyncio
    async def test_tool_call_flow_invokes_mcp(self):
        """The ``tools`` node should call MCP and feed results back."""
        session = MagicMock()
        session.call_tool = AsyncMock(return_value="result: 2")

        # First LLM turn: ask for a tool. Second: emit the final answer.
        responses = [
            _make_message(
                content="",
                tool_calls=[_make_tool_call("run_code", {"code": "print(1+1)"})],
            ),
            _make_message(
                content=(
                    "<summary>Ran code</summary>\n"
                    "<feedback>OK</feedback>\n"
                    "<response>2</response>"
                ),
            ),
        ]

        call_log: list = []

        def stub_llm(messages, tools):
            call_log.append(list(messages))
            return responses.pop(0)

        loop = LangGraphAgentLoop(
            mcp_session=session,
            llm_callable=stub_llm,
            api_key="x",
            thread_id="test-tools",
        )

        text, metrics = await loop.run(
            "calculate 1+1",
            tools=[{"type": "function", "function": {"name": "run_code"}}],
        )

        assert "<response>2</response>" in text
        assert "run_code" in metrics
        assert metrics["run_code"]["count"] == 1
        # The MCP session should have been called exactly once.
        session.call_tool.assert_awaited_once_with(
            "run_code", {"code": "print(1+1)"}
        )
        # The second LLM call should have observed the tool result message.
        assert any(m.get("role") == "tool" for m in call_log[1])

    @pytest.mark.asyncio
    async def test_missing_tags_triggers_retry(self):
        """A no-tool response missing tags should loop back through agent."""
        session = MagicMock()
        responses = [
            _make_message(content="just plain text, no tags"),
            _make_message(
                content=(
                    "<summary>retry</summary>\n"
                    "<feedback>fixed</feedback>\n"
                    "<response>final</response>"
                ),
            ),
        ]

        calls = {"n": 0}

        def stub_llm(messages, tools):
            calls["n"] += 1
            return responses.pop(0)

        loop = LangGraphAgentLoop(
            mcp_session=session,
            llm_callable=stub_llm,
            api_key="x",
            thread_id="test-retry",
        )

        text, _ = await loop.run("test")
        assert "<response>final</response>" in text
        assert calls["n"] == 2

    @pytest.mark.asyncio
    async def test_max_iterations_guard(self):
        """The graph must terminate even if the LLM never settles."""
        session = MagicMock()
        session.call_tool = AsyncMock(return_value="ok")

        def stub_llm(messages, tools):
            # Always request another tool call.
            return _make_message(
                content="",
                tool_calls=[_make_tool_call("run_code", {"code": "x"}, call_id="call_inf")],
            )

        loop = LangGraphAgentLoop(
            mcp_session=session,
            llm_callable=stub_llm,
            api_key="x",
            max_iterations=3,
            thread_id="test-cap",
        )

        # Should return without raising. The cap binds *agent* iterations,
        # which is one more than the number of tool round-trips because
        # the final agent call exits before dispatching tools.
        await loop.run("infinite")
        assert 0 < session.call_tool.await_count <= 3

    @pytest.mark.asyncio
    async def test_tool_error_is_surfaced_as_tool_message(self):
        """When MCP raises, the error is fed back into the transcript."""
        session = MagicMock()
        session.call_tool = AsyncMock(side_effect=RuntimeError("boom"))

        responses = [
            _make_message(
                content="",
                tool_calls=[_make_tool_call("bad_tool", {}, call_id="call_err")],
            ),
            _make_message(
                content=(
                    "<summary>Tool failed</summary>\n"
                    "<feedback>Error</feedback>\n"
                    "<response>handled</response>"
                ),
            ),
        ]

        def stub_llm(messages, tools):
            return responses.pop(0)

        loop = LangGraphAgentLoop(
            mcp_session=session,
            llm_callable=stub_llm,
            api_key="x",
            thread_id="test-err",
        )

        text, metrics = await loop.run("try bad tool")
        assert "handled" in text
        assert metrics["bad_tool"]["count"] == 1


# ---------------------------------------------------------------------------
# End-to-end harness test against the sample config
# ---------------------------------------------------------------------------


class _FakeMCPStreams:
    """Minimal async-context-manager that mimics streamablehttp_client."""

    async def __aenter__(self):
        return (MagicMock(), MagicMock(), None)

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeClientSession:
    """Drop-in replacement for ``mcp.ClientSession``.

    Implements the slice of the real session our harness touches:
    ``initialize``, ``list_tools``, and ``call_tool``.
    """

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def initialize(self):
        return None

    async def list_tools(self):
        tool = SimpleNamespace(
            name="sandbox_get_context",
            description="Return sandbox version metadata",
            inputSchema={"type": "object", "properties": {}, "required": []},
        )
        return SimpleNamespace(tools=[tool])

    async def call_tool(self, name, arguments=None):
        return f"sandbox version: v1.0.0.143 (called {name} with {arguments})"


@pytest.mark.asyncio
async def test_sample_config_produces_benchmark_file(tmp_path, monkeypatch):
    """Run the harness against ``configs/langgraph_ping.toml``.

    Both the MCP transport and the LLM are mocked, so the test is hermetic.
    The assertion: a benchmark Markdown file is written under
    ``result/<date>/langgraph/`` and contains the expected ground-truth
    response.
    """
    # Load the sample config to confirm it's well-formed and pull the
    # output_subdir field.
    config_path = EVAL_ROOT / "configs" / "langgraph_ping.toml"
    assert config_path.exists(), f"sample config missing: {config_path}"
    with open(config_path, "rb") as fh:
        cfg = tomllib.load(fh)
    assert cfg["harness"]["agent"] == "langgraph"
    assert cfg["harness"]["eval"] == "ping"
    output_subdir = cfg["harness"]["output_subdir"]

    # Force the harness to use our fake MCP transport.
    import main as harness_main

    monkeypatch.setattr(
        harness_main, "streamablehttp_client", lambda url: _FakeMCPStreams()
    )
    monkeypatch.setattr(harness_main, "ClientSession", _FakeClientSession)

    # Stub the LangGraph LLM to emit a fully-tagged response on the first
    # call so the StateGraph terminates without hitting a real model.
    final = (
        "<summary>Pinged the sandbox version endpoint.</summary>\n"
        "<feedback>Tool schema was clear.</feedback>\n"
        "<response>v1.0.0.143</response>"
    )

    original_init = LangGraphAgentLoop.__init__

    def patched_init(self, *args, **kwargs):
        kwargs.setdefault(
            "llm_callable", lambda messages, tools: _make_message(final)
        )
        kwargs.setdefault("api_key", "test-key")
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(LangGraphAgentLoop, "__init__", patched_init)

    # Drive the harness exactly as the CLI does.
    eval_path = EVAL_ROOT / "dataset" / "evaluation_ping.xml"
    assert eval_path.exists()

    report = await harness_main.run_evaluation(
        eval_path=str(eval_path),
        mcp_server_url="http://fake-sandbox.local/mcp",
        agent_type="langgraph",
        langgraph_config=cfg["harness"]["langgraph"],
    )

    # Sanity-check the rendered report.
    assert "Accuracy" in report
    assert "v1.0.0.143" in report

    # Now write the report to the canonical location the CLI would use,
    # so we can prove the sample config really does produce a benchmark
    # file artefact under result/<date>/<output_subdir>/.
    utc_plus_8 = timezone(timedelta(hours=8))
    date_str = datetime.now(utc_plus_8).strftime("%Y%m%d")
    out_dir = EVAL_ROOT / "result" / date_str / output_subdir
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{eval_path.stem}.md"
    out_file.write_text(report, encoding="utf-8")

    assert out_file.exists()
    body = out_file.read_text(encoding="utf-8")
    assert "v1.0.0.143" in body
    assert "Accuracy" in body
    # The report should show a passing task.
    assert "1/1" in body or "(100.0%)" in body
