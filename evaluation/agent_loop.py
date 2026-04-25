"""
Agent Loop Module

Provides different agent loop implementations (Azure OpenAI, OpenAI-compatible, LangGraph, etc.).
Follows the strategy pattern for easy runtime switching.

Supported backends:
- Azure OpenAI (AzureOpenAIAgentLoop)
- OpenAI and compatible APIs such as MiniMax (OpenAIAgentLoop)
- LangGraph (LangGraphAgentLoop) — backed by a StateGraph runtime
"""

import asyncio
import json
import os
import re
import time
from abc import ABC, abstractmethod
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple, TypedDict

from mcp import ClientSession
from openai import AzureOpenAI, OpenAI


# ============================================================================
# Default System Prompt
# ============================================================================

DEFAULT_SYSTEM_PROMPT = """You are an AI assistant with access to tools.

When given a task, you MUST:
1. Use the available tools to complete the task
2. Provide summary of each step in your approach, wrapped in <summary> tags
3. Provide feedback on the tools provided, wrapped in <feedback> tags
4. Provide your final response, wrapped in <response> tags
5. Don't use VLM tools, like screenshot, etc.

Summary Requirements:
- In your <summary> tags, you must explain:
  - The steps you took to complete the task
  - Which tools you used, in what order, and why
  - The inputs you provided to each tool
  - The outputs you received from each tool
  - A summary for how you arrived at the response

Feedback Requirements:
- In your <feedback> tags, provide constructive feedback on the tools:
  - Comment on tool names: Are they clear and descriptive?
  - Comment on input parameters: Are they well-documented? Are required vs optional parameters clear?
  - Comment on descriptions: Do they accurately describe what the tool does?
  - Comment on any errors encountered during tool usage: Did the tool fail to execute? Did the tool return too many tokens?
  - Identify specific areas for improvement and explain WHY they would help
  - Be specific and actionable in your suggestions

Response Requirements:
- Your response should be concise and directly address what was asked
- Always wrap your final response in <response> tags
- If you cannot solve the task return <response>NOT_FOUND</response>
- For numeric responses, provide just the number
- For IDs, provide just the ID
- For names or text, provide the exact text requested
- Your response should go last"""


# ============================================================================
# Base Agent Loop
# ============================================================================


class BaseAgentLoop(ABC):
    """
    Abstract base class for agent loop implementations.

    An agent loop is responsible for:
    1. Taking a user prompt and available tools
    2. Executing an LLM reasoning loop with tool calling
    3. Returning the final response and execution metrics
    """

    def __init__(
        self,
        mcp_session: ClientSession,
        system_prompt: str = DEFAULT_SYSTEM_PROMPT,
    ):
        """
        Initialize agent loop.

        Args:
            mcp_session: MCP client session for tool execution
            system_prompt: System prompt for the agent
        """
        self.mcp_session = mcp_session
        self.system_prompt = system_prompt

    @abstractmethod
    async def run(
        self,
        prompt: str,
        tools: List[Dict[str, Any]] = None,
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Execute agent loop.

        Args:
            prompt: User prompt/task
            tools: List of tool definitions

        Returns:
            Tuple of (response_text, tool_metrics)
            - response_text: Final LLM response (including <summary>, <feedback>, <response> tags)
            - tool_metrics: Dict mapping tool names to execution metrics
        """
        pass


# ============================================================================
# Azure OpenAI Agent Loop
# ============================================================================


class AzureOpenAIAgentLoop(BaseAgentLoop):
    """Agent loop implementation using Azure OpenAI."""

    def __init__(
        self,
        mcp_session: ClientSession,
        system_prompt: str = DEFAULT_SYSTEM_PROMPT,
        azure_endpoint: str = None,
        azure_api_key: str = None,
        azure_deployment: str = None,
        azure_api_version: str = None,
        max_iterations: int = 50,
    ):
        """
        Initialize Azure OpenAI agent loop.

        Args:
            mcp_session: MCP client session for tool execution
            system_prompt: System prompt for the agent
            azure_endpoint: Azure OpenAI endpoint (default: from env)
            azure_api_key: Azure OpenAI API key (default: from env)
            azure_deployment: Azure OpenAI deployment name (default: from env)
            azure_api_version: Azure OpenAI API version (default: from env)
            max_iterations: Maximum number of reasoning iterations
        """
        super().__init__(mcp_session, system_prompt)

        self.azure_endpoint = azure_endpoint or os.getenv(
            "AZURE_OPENAI_ENDPOINT", "https://your-endpoint.openai.azure.com"
        )
        self.azure_api_key = azure_api_key or os.getenv(
            "AZURE_OPENAI_API_KEY", "your-api-key"
        )
        self.azure_deployment = azure_deployment or os.getenv(
            "AZURE_OPENAI_DEPLOYMENT", "gpt-4"
        )
        self.azure_api_version = azure_api_version or os.getenv(
            "AZURE_OPENAI_API_VERSION", "2024-02-15-preview"
        )
        self.max_iterations = max_iterations

        self.client = AzureOpenAI(
            azure_endpoint=self.azure_endpoint,
            api_key=self.azure_api_key,
            api_version=self.azure_api_version,
        )

    async def run(
        self,
        prompt: str,
        tools: List[Dict[str, Any]] = None,
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Execute Azure OpenAI agent loop.

        Args:
            prompt: User prompt/task
            tools: List of tool definitions in Azure OpenAI format

        Returns:
            Tuple of (response_text, tool_metrics)
        """
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": prompt},
        ]

        tool_metrics = {}
        iteration = 0

        while iteration < self.max_iterations:
            iteration += 1

            # Make API call
            kwargs = {
                "model": self.azure_deployment,
                "messages": messages,
                "max_tokens": 4096,
            }

            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"

            response = self.client.chat.completions.create(**kwargs)
            message = response.choices[0].message

            # Add assistant message to conversation
            messages.append(
                {
                    "role": "assistant",
                    "content": message.content,
                    "tool_calls": message.tool_calls
                    if hasattr(message, "tool_calls") and message.tool_calls
                    else None,
                }
            )

            # Check if we're done
            if not message.tool_calls:
                final_content = message.content or ""
                print(f"\n🔍 DEBUG: Final LLM response (first 1000 chars):")
                print(f"{final_content[:1000]}")
                if len(final_content) > 1000:
                    print(
                        f"... (truncated, total length: {len(final_content)} chars)"
                    )
                print()

                # Verify response contains required tags - force retry if missing
                missing_tags = []
                if "<response>" not in final_content:
                    missing_tags.append("<response>")
                if "<summary>" not in final_content:
                    missing_tags.append("<summary>")
                if "<feedback>" not in final_content:
                    missing_tags.append("<feedback>")

                if missing_tags:
                    print(
                        f"⚠️  LLM response missing required tags: {', '.join(missing_tags)}"
                    )
                    print(
                        f"   Forcing retry (iteration {iteration}/{self.max_iterations})..."
                    )
                    messages.append(
                        {
                            "role": "user",
                            "content": f"ERROR: Your response is missing required tags: {', '.join(missing_tags)}. You MUST provide ALL THREE tags: <summary>, <feedback>, and <response>. Please provide your complete response now with all three tags.",
                        }
                    )
                    continue  # Go back to the loop

                return final_content, tool_metrics

            # Process tool calls
            for tool_call in message.tool_calls:
                tool_name = tool_call.function.name
                try:
                    tool_args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError as e:
                    print(f"❌ JSON decode error for tool {tool_name}")
                    print(f"   Arguments: {tool_call.function.arguments[:200]}...")
                    print(f"   Error: {e}")
                    raise

                print(f"🔧 Executing tool: {tool_name}")
                print(f"   Arguments: {json.dumps(tool_args, ensure_ascii=False)}")
                tool_start_ts = time.time()

                # Execute tool with error handling
                try:
                    tool_result = await self.mcp_session.call_tool(tool_name, tool_args)
                    tool_duration = time.time() - tool_start_ts
                    print(f"✅ Tool {tool_name} completed in {tool_duration:.2f}s")
                except Exception as e:
                    tool_duration = time.time() - tool_start_ts
                    error_type = type(e).__name__
                    error_msg = str(e)
                    print(f"❌ Tool {tool_name} failed after {tool_duration:.2f}s")
                    print(f"   Error: {error_type}: {error_msg}")
                    # Return error as tool result so LLM knows what happened
                    tool_result = {
                        "isError": True,
                        "content": [
                            {
                                "type": "text",
                                "text": f"ERROR: Tool execution failed\nType: {error_type}\nMessage: {error_msg}\n\nThis tool is not available or encountered an error. Please try a different approach.",
                            }
                        ],
                    }

                # Update tool metrics
                if tool_name not in tool_metrics:
                    tool_metrics[tool_name] = {"count": 0, "durations": [], "calls": []}
                tool_metrics[tool_name]["count"] += 1
                tool_metrics[tool_name]["durations"].append(tool_duration)
                tool_metrics[tool_name]["calls"].append(
                    {
                        "args": tool_args,
                        "duration": tool_duration,
                        "timestamp": tool_start_ts,
                    }
                )

                # Add tool response to conversation
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": str(tool_result),
                    }
                )

        # If we hit max iterations, return what we have
        return messages[-1].get("content", ""), tool_metrics


# ============================================================================
# OpenAI-Compatible Agent Loop
# ============================================================================

# Models that require temperature > 0
_TEMPERATURE_POSITIVE_MODELS = re.compile(r"MiniMax", re.IGNORECASE)

# Models that may wrap content in <think>...</think> tags
_THINKING_TAG_MODELS = re.compile(r"MiniMax-M2", re.IGNORECASE)


class OpenAIAgentLoop(BaseAgentLoop):
    """
    Agent loop implementation using the standard OpenAI SDK.

    Works with OpenAI and any OpenAI-compatible API by setting ``base_url``.
    For example, to use MiniMax::

        agent = OpenAIAgentLoop(
            mcp_session=session,
            api_key=os.getenv("MINIMAX_API_KEY"),
            base_url="https://api.minimax.io/v1",
            model="MiniMax-M2.7",
        )
    """

    def __init__(
        self,
        mcp_session: ClientSession,
        system_prompt: str = DEFAULT_SYSTEM_PROMPT,
        api_key: str = None,
        base_url: str = None,
        model: str = None,
        max_iterations: int = 50,
        temperature: float = None,
    ):
        """
        Initialize OpenAI-compatible agent loop.

        Args:
            mcp_session: MCP client session for tool execution
            system_prompt: System prompt for the agent
            api_key: API key (default: ``OPENAI_API_KEY`` env var)
            base_url: Base URL for the API. Set to
                ``https://api.minimax.io/v1`` for MiniMax, or leave as
                ``None`` for official OpenAI.
            model: Model name (default: ``OPENAI_MODEL`` env var or ``gpt-4``)
            max_iterations: Maximum number of reasoning iterations
            temperature: Sampling temperature. Auto-clamped for providers
                that require ``temperature > 0`` (e.g. MiniMax).
        """
        super().__init__(mcp_session, system_prompt)

        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.base_url = base_url or os.getenv("OPENAI_BASE_URL")
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4")
        self.max_iterations = max_iterations
        self.temperature = temperature

        client_kwargs: Dict[str, Any] = {}
        if self.api_key:
            client_kwargs["api_key"] = self.api_key
        if self.base_url:
            client_kwargs["base_url"] = self.base_url

        self.client = OpenAI(**client_kwargs)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _effective_temperature(self) -> float | None:
        """Return temperature, clamped if the model requires it."""
        temp = self.temperature
        if temp is not None and _TEMPERATURE_POSITIVE_MODELS.search(self.model):
            temp = max(temp, 0.01)
        return temp

    @staticmethod
    def _strip_thinking_tags(text: str) -> str:
        """Remove ``<think>…</think>`` blocks some models emit."""
        return re.sub(r"<think>[\s\S]*?</think>\s*", "", text)

    # ------------------------------------------------------------------
    # Run
    # ------------------------------------------------------------------

    async def run(
        self,
        prompt: str,
        tools: List[Dict[str, Any]] = None,
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Execute the agent loop.

        Args:
            prompt: User prompt/task
            tools: List of tool definitions in OpenAI format

        Returns:
            Tuple of (response_text, tool_metrics)
        """
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": prompt},
        ]

        tool_metrics: Dict[str, Any] = {}
        iteration = 0
        strip_think = bool(_THINKING_TAG_MODELS.search(self.model))

        while iteration < self.max_iterations:
            iteration += 1

            kwargs: Dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "max_tokens": 4096,
            }

            temp = self._effective_temperature()
            if temp is not None:
                kwargs["temperature"] = temp

            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"

            response = self.client.chat.completions.create(**kwargs)
            message = response.choices[0].message

            content = message.content or ""
            if strip_think:
                content = self._strip_thinking_tags(content)

            messages.append(
                {
                    "role": "assistant",
                    "content": content,
                    "tool_calls": message.tool_calls
                    if hasattr(message, "tool_calls") and message.tool_calls
                    else None,
                }
            )

            if not message.tool_calls:
                final_content = content
                print(f"\n🔍 DEBUG: Final LLM response (first 1000 chars):")
                print(f"{final_content[:1000]}")
                if len(final_content) > 1000:
                    print(
                        f"... (truncated, total length: {len(final_content)} chars)"
                    )
                print()

                missing_tags = []
                if "<response>" not in final_content:
                    missing_tags.append("<response>")
                if "<summary>" not in final_content:
                    missing_tags.append("<summary>")
                if "<feedback>" not in final_content:
                    missing_tags.append("<feedback>")

                if missing_tags:
                    print(
                        f"⚠️  LLM response missing required tags: {', '.join(missing_tags)}"
                    )
                    print(
                        f"   Forcing retry (iteration {iteration}/{self.max_iterations})..."
                    )
                    messages.append(
                        {
                            "role": "user",
                            "content": f"ERROR: Your response is missing required tags: {', '.join(missing_tags)}. You MUST provide ALL THREE tags: <summary>, <feedback>, and <response>. Please provide your complete response now with all three tags.",
                        }
                    )
                    continue

                return final_content, tool_metrics

            for tool_call in message.tool_calls:
                tool_name = tool_call.function.name
                try:
                    tool_args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError as e:
                    print(f"❌ JSON decode error for tool {tool_name}")
                    print(f"   Arguments: {tool_call.function.arguments[:200]}...")
                    print(f"   Error: {e}")
                    raise

                print(f"🔧 Executing tool: {tool_name}")
                print(f"   Arguments: {json.dumps(tool_args, ensure_ascii=False)}")
                tool_start_ts = time.time()

                try:
                    tool_result = await self.mcp_session.call_tool(tool_name, tool_args)
                    tool_duration = time.time() - tool_start_ts
                    print(f"✅ Tool {tool_name} completed in {tool_duration:.2f}s")
                except Exception as e:
                    tool_duration = time.time() - tool_start_ts
                    error_type = type(e).__name__
                    error_msg = str(e)
                    print(f"❌ Tool {tool_name} failed after {tool_duration:.2f}s")
                    print(f"   Error: {error_type}: {error_msg}")
                    tool_result = {
                        "isError": True,
                        "content": [
                            {
                                "type": "text",
                                "text": f"ERROR: Tool execution failed\nType: {error_type}\nMessage: {error_msg}\n\nThis tool is not available or encountered an error. Please try a different approach.",
                            }
                        ],
                    }

                if tool_name not in tool_metrics:
                    tool_metrics[tool_name] = {"count": 0, "durations": [], "calls": []}
                tool_metrics[tool_name]["count"] += 1
                tool_metrics[tool_name]["durations"].append(tool_duration)
                tool_metrics[tool_name]["calls"].append(
                    {
                        "args": tool_args,
                        "duration": tool_duration,
                        "timestamp": tool_start_ts,
                    }
                )

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": str(tool_result),
                    }
                )

        return messages[-1].get("content", ""), tool_metrics


# ============================================================================
# LangGraph Agent Loop
# ============================================================================


# --- LangGraph state schema --------------------------------------------------


class LangGraphAgentState(TypedDict, total=False):
    """State schema driven through the LangGraph StateGraph.

    - ``messages`` is a chat-completions-style transcript
    - ``tool_metrics`` aggregates per-tool execution counts and durations
    - ``iterations`` guards against runaway loops
    - ``final_response`` is populated when the agent emits a no-tool-call reply
      that contains all of <summary>, <feedback>, and <response>
    """

    messages: List[Dict[str, Any]]
    tool_metrics: Dict[str, Any]
    iterations: int
    final_response: Optional[str]


# Type alias for the LLM-call hook used by the agent node. Tests inject a
# fake to avoid hitting a real model. The signature mirrors the bits of
# the OpenAI SDK we actually consume: a list of messages and an optional
# list of OpenAI-format tool schemas, returning the assistant message.
LLMCallable = Callable[[List[Dict[str, Any]], Optional[List[Dict[str, Any]]]], Any]


class LangGraphAgentLoop(BaseAgentLoop):
    """Agent loop backed by a LangGraph ``StateGraph`` runtime.

    The graph has two nodes:

    1. ``agent``   — calls the underlying LLM (OpenAI-compatible by default)
    2. ``tools``   — invokes MCP tools chosen by the LLM and feeds the
                     results back as ``role="tool"`` messages

    A conditional edge from ``agent`` routes to ``tools`` while the model
    keeps calling tools, and to ``END`` once the model emits a final
    response with the required ``<summary>/<feedback>/<response>`` tags
    (matching the contract of the other agent loops). A ``MemorySaver``
    checkpointer is wired in by default so each task run is replayable;
    callers can swap in a ``SqliteSaver`` (or any LangGraph checkpointer)
    via the ``checkpointer`` argument.
    """

    def __init__(
        self,
        mcp_session: ClientSession,
        system_prompt: str = DEFAULT_SYSTEM_PROMPT,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        max_iterations: int = 25,
        temperature: Optional[float] = None,
        checkpointer: Any = None,
        llm_callable: Optional[LLMCallable] = None,
        thread_id: str = "evaluation",
    ):
        """Initialize the LangGraph agent loop.

        Args:
            mcp_session: MCP client session used to execute tools.
            system_prompt: System prompt for the agent.
            api_key: API key (default: ``OPENAI_API_KEY`` env var).
            base_url: Base URL for the LLM provider (OpenAI-compatible).
            model: Model name (default: ``OPENAI_MODEL`` env var or ``gpt-4``).
            max_iterations: Hard cap on agent <-> tool round-trips.
            temperature: Optional sampling temperature.
            checkpointer: LangGraph checkpointer. Defaults to ``MemorySaver``
                so the graph is replayable in tests; production configs
                may pass a ``SqliteSaver``.
            llm_callable: Optional injection point for tests. When provided,
                this callable is used in place of the real OpenAI client so
                the graph can be exercised without network calls.
            thread_id: Thread identifier used by the checkpointer.
        """
        super().__init__(mcp_session, system_prompt)

        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.base_url = base_url or os.getenv("OPENAI_BASE_URL")
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4")
        self.max_iterations = max_iterations
        self.temperature = temperature
        self.thread_id = thread_id

        # Lazy-import LangGraph so the package is only required when this
        # backend is actually instantiated. This keeps the existing Azure
        # / OpenAI paths usable even if a downstream user hasn't installed
        # the optional langgraph extra yet.
        from langgraph.checkpoint.memory import MemorySaver
        from langgraph.graph import END, StateGraph

        self._END = END
        self.checkpointer = checkpointer if checkpointer is not None else MemorySaver()

        # Build the OpenAI client only if the caller didn't inject a fake.
        # Tests pass ``llm_callable`` to keep the graph hermetic.
        if llm_callable is not None:
            self._llm_callable: LLMCallable = llm_callable
        else:
            client_kwargs: Dict[str, Any] = {}
            if self.api_key:
                client_kwargs["api_key"] = self.api_key
            if self.base_url:
                client_kwargs["base_url"] = self.base_url
            self._client = OpenAI(**client_kwargs)
            self._llm_callable = self._default_llm_callable

        # Compile the graph once per loop instance.
        graph = StateGraph(LangGraphAgentState)
        graph.add_node("agent", self._agent_node)
        graph.add_node("tools", self._tool_node)
        graph.set_entry_point("agent")
        graph.add_conditional_edges(
            "agent",
            self._route_after_agent,
            {"tools": "tools", "agent": "agent", "end": END},
        )
        graph.add_edge("tools", "agent")
        self._graph = graph.compile(checkpointer=self.checkpointer)

        # ``_pending_tools`` is set per-run so the graph nodes can see the
        # tool schema list without threading it through the state dict.
        self._pending_tools: Optional[List[Dict[str, Any]]] = None

    # ------------------------------------------------------------------
    # LLM dispatch
    # ------------------------------------------------------------------

    def _default_llm_callable(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]],
    ) -> Any:
        """Production LLM call — hits the configured OpenAI-compatible endpoint."""
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": 4096,
        }
        if self.temperature is not None:
            kwargs["temperature"] = self.temperature
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        response = self._client.chat.completions.create(**kwargs)
        return response.choices[0].message

    # ------------------------------------------------------------------
    # Graph nodes
    # ------------------------------------------------------------------

    def _agent_node(self, state: LangGraphAgentState) -> Dict[str, Any]:
        """LLM call node. Appends the assistant message to the transcript."""
        iterations = state.get("iterations", 0) + 1
        message = self._llm_callable(state["messages"], self._pending_tools)

        content = getattr(message, "content", None) or ""
        raw_tool_calls = getattr(message, "tool_calls", None)
        # Normalize tool_calls to plain dicts so the checkpointer can
        # serialize them. SDK objects (SimpleNamespace, OpenAI ChoiceMessage)
        # aren't msgpack-friendly.
        tool_calls = _normalize_tool_calls(raw_tool_calls) if raw_tool_calls else None

        assistant_msg: Dict[str, Any] = {"role": "assistant", "content": content}
        if tool_calls:
            assistant_msg["tool_calls"] = tool_calls

        new_messages = list(state["messages"]) + [assistant_msg]

        update: Dict[str, Any] = {
            "messages": new_messages,
            "iterations": iterations,
        }

        # If the assistant produced no tool calls and the response carries
        # all of <summary>/<feedback>/<response>, mark it final so the
        # router can terminate the graph.
        if not tool_calls:
            missing = [
                tag
                for tag in ("<summary>", "<feedback>", "<response>")
                if tag not in content
            ]
            if not missing:
                update["final_response"] = content
            else:
                # Nudge the model with a corrective user message and let
                # the conditional edge loop us back through ``agent``.
                new_messages.append(
                    {
                        "role": "user",
                        "content": (
                            "ERROR: Your response is missing required tags: "
                            f"{', '.join(missing)}. You MUST provide ALL THREE "
                            "tags: <summary>, <feedback>, and <response>."
                        ),
                    }
                )
                update["messages"] = new_messages

        return update

    def _tool_node(self, state: LangGraphAgentState) -> Dict[str, Any]:
        """Tool execution node. Runs each pending tool call against MCP."""
        last = state["messages"][-1]
        tool_calls = last.get("tool_calls") or []
        tool_metrics = dict(state.get("tool_metrics", {}))
        new_messages = list(state["messages"])

        for tool_call in tool_calls:
            # tool_calls are stored as plain dicts (see _normalize_tool_calls)
            # so they survive the checkpointer's msgpack serializer.
            tool_name = tool_call["name"]
            arguments = tool_call.get("arguments", "{}")
            try:
                tool_args = json.loads(arguments) if isinstance(arguments, str) else dict(arguments)
            except (json.JSONDecodeError, TypeError):
                tool_args = {}

            tool_start_ts = time.time()
            try:
                # ``call_tool`` is async; bridge to it from this sync node.
                tool_result = _run_coro_sync(
                    self.mcp_session.call_tool(tool_name, tool_args)
                )
                tool_duration = time.time() - tool_start_ts
            except Exception as exc:  # noqa: BLE001 — surface any tool error
                tool_duration = time.time() - tool_start_ts
                tool_result = {
                    "isError": True,
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                f"ERROR: Tool execution failed\n"
                                f"Type: {type(exc).__name__}\nMessage: {exc}"
                            ),
                        }
                    ],
                }

            metrics = tool_metrics.setdefault(
                tool_name, {"count": 0, "durations": [], "calls": []}
            )
            metrics["count"] += 1
            metrics["durations"].append(tool_duration)
            metrics["calls"].append(
                {
                    "args": tool_args,
                    "duration": tool_duration,
                    "timestamp": tool_start_ts,
                }
            )

            new_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.get("id", ""),
                    "content": str(tool_result),
                }
            )

        return {"messages": new_messages, "tool_metrics": tool_metrics}

    def _route_after_agent(self, state: LangGraphAgentState) -> str:
        """Conditional edge: continue to tools, terminate, or loop back."""
        if state.get("final_response"):
            return "end"
        if state.get("iterations", 0) >= self.max_iterations:
            return "end"
        # Find the most recent assistant message to see if it requested tools.
        for msg in reversed(state["messages"]):
            if msg.get("role") == "assistant":
                if msg.get("tool_calls"):
                    return "tools"
                # Assistant emitted a no-tool-call response that was missing
                # tags (otherwise final_response would be set); the agent
                # node already appended a corrective user message, so loop
                # back through ``agent`` for another attempt.
                return "agent"
        return "end"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(
        self,
        prompt: str,
        tools: List[Dict[str, Any]] = None,
    ) -> Tuple[str, Dict[str, Any]]:
        """Execute the LangGraph agent loop end-to-end."""
        self._pending_tools = tools or None
        initial_state: LangGraphAgentState = {
            "messages": [
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": prompt},
            ],
            "tool_metrics": {},
            "iterations": 0,
            "final_response": None,
        }
        config = {"configurable": {"thread_id": self.thread_id}}

        try:
            final_state = await self._graph.ainvoke(initial_state, config=config)
        finally:
            self._pending_tools = None

        response_text = final_state.get("final_response") or (
            final_state["messages"][-1].get("content", "") if final_state.get("messages") else ""
        )
        return response_text, final_state.get("tool_metrics", {})


def _normalize_tool_calls(raw: Any) -> List[Dict[str, Any]]:
    """Coerce SDK tool_call objects into msgpack-friendly dicts.

    The OpenAI SDK returns tool calls as objects with ``.id`` and a nested
    ``.function`` namespace. Our test fakes use ``SimpleNamespace`` with
    the same shape. The LangGraph checkpointer stores state via
    ``ormsgpack`` which can't serialize either form, so we flatten both
    into ``{"id", "name", "arguments"}`` dicts before they enter state.
    """
    out: List[Dict[str, Any]] = []
    for tc in raw or []:
        if isinstance(tc, dict):
            # Either already-flat or {"id", "function": {...}} shape.
            if "function" in tc and isinstance(tc["function"], dict):
                fn = tc["function"]
                out.append(
                    {
                        "id": tc.get("id", ""),
                        "name": fn.get("name", ""),
                        "arguments": fn.get("arguments", "{}"),
                    }
                )
            else:
                out.append(
                    {
                        "id": tc.get("id", ""),
                        "name": tc.get("name", ""),
                        "arguments": tc.get("arguments", "{}"),
                    }
                )
            continue
        # Object form (OpenAI SDK / SimpleNamespace).
        fn = getattr(tc, "function", None)
        out.append(
            {
                "id": getattr(tc, "id", "") or "",
                "name": getattr(fn, "name", "") if fn is not None else "",
                "arguments": getattr(fn, "arguments", "{}") if fn is not None else "{}",
            }
        )
    return out


def _run_coro_sync(coro: Awaitable[Any]) -> Any:
    """Run an awaitable from inside a sync graph node.

    LangGraph executes node callables synchronously by default. Our MCP
    ``call_tool`` is async, so we bridge with a small helper. We try the
    running loop first (the common case when the graph is invoked via
    ``ainvoke``), and fall back to ``asyncio.run`` for sync callers.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    # If we're inside a running loop, execute the coroutine on a fresh
    # thread-local loop so we don't deadlock the parent.
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()
