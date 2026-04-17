"""Smoke tests for the agent-sandbox Python SDK.

These do not hit a live sandbox. They verify the package surface is
importable and the client constructors accept their documented kwargs
without raising. If the Fern regeneration breaks public API shape, these
tests fail and catch it before it ships.
"""

from __future__ import annotations

import agent_sandbox


def test_top_level_exports() -> None:
    """The two documented entry points must be importable from the root."""
    assert hasattr(agent_sandbox, "Sandbox")
    assert hasattr(agent_sandbox, "AsyncSandbox")


def test_sync_client_constructs() -> None:
    """Sandbox() must accept the documented kwargs and produce a client."""
    client = agent_sandbox.Sandbox(base_url="http://localhost:8080", timeout=5.0)
    assert client is not None
    # Namespaces promised in the README.
    for name in ("sandbox", "shell", "bash", "file", "jupyter", "nodejs",
                 "mcp", "browser", "skills", "proxy", "auth"):
        assert hasattr(client, name), f"client.{name} missing"


def test_async_client_constructs() -> None:
    """AsyncSandbox() must accept the documented kwargs and produce a client."""
    client = agent_sandbox.AsyncSandbox(base_url="http://localhost:8080", timeout=5.0)
    assert client is not None
    for name in ("sandbox", "shell", "file", "jupyter", "mcp"):
        assert hasattr(client, name), f"async client.{name} missing"


def test_documented_shell_method_name() -> None:
    """README advertises client.shell.exec_command — protect against rename drift."""
    client = agent_sandbox.Sandbox(base_url="http://localhost:8080")
    assert hasattr(client.shell, "exec_command")
    assert hasattr(client.shell, "view")


def test_documented_file_methods() -> None:
    """README advertises read_file / write_file / list_path."""
    client = agent_sandbox.Sandbox(base_url="http://localhost:8080")
    for name in ("read_file", "write_file", "list_path", "find_files",
                 "search_in_file", "grep_files"):
        assert hasattr(client.file, name), f"client.file.{name} missing"


def test_documented_mcp_methods() -> None:
    """README advertises list_mcp_servers / list_mcp_tools / execute_mcp_tool."""
    client = agent_sandbox.Sandbox(base_url="http://localhost:8080")
    for name in ("list_mcp_servers", "list_mcp_tools", "execute_mcp_tool"):
        assert hasattr(client.mcp, name), f"client.mcp.{name} missing"
