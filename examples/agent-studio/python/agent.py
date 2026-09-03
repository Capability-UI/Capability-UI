#!/usr/bin/env python3
"""PydanticAI agent that calls CUP through JSON-RPC MCP."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import dataclass
from typing import Any
from urllib.request import Request, urlopen
from uuid import uuid4

SYSTEM_PROMPT = """You are an operations assistant for Harbor inventory.
You may only change data by calling CUP MCP tools. The web UI renders an AuthorizedView;
it is not a security boundary. After tools run, summarize the receipt status.
If a tool is denied, explain the reason code and do not pretend the write succeeded.
Prefer inventory.draftPurchaseOrder for restock suggestions. Include a short reason string in the tool arguments. Use inventory.submitPurchaseOrder
only when the user clearly asks to send the order. Use inventory.adjust for count corrections.
"""


@dataclass
class CupClient:
    url: str
    subject_id: str

    def _payload(self, method: str, params: dict[str, Any], request_id: int = 1) -> dict[str, Any]:
        merged = {
            "subjectId": self.subject_id,
            "context": {"purpose": "agent_studio", "channel": "agent"},
            **params,
        }
        return {"jsonrpc": "2.0", "id": request_id, "method": method, "params": merged}

    async def call(self, method: str, params: dict[str, Any] | None = None) -> Any:
        payload = json.dumps(self._payload(method, params or {})).encode("utf-8")
        request = Request(self.url, data=payload, headers={"content-type": "application/json"}, method="POST")
        with urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
        if body.get("error"):
            raise RuntimeError(body["error"].get("message", "MCP error"))
        return body.get("result")


def build_agent(model_name: str, api_key: str, base_url: str | None):
    from pydantic_ai import Agent, RunContext
    try:
        from pydantic_ai.models.openai import OpenAIChatModel
    except ImportError:  # pydantic-ai < 1.0
        from pydantic_ai.models.openai import OpenAIModel as OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider

    provider_kwargs: dict[str, Any] = {"api_key": api_key}
    if base_url:
        provider_kwargs["base_url"] = base_url
    model = OpenAIChatModel(model_name, provider=OpenAIProvider(**provider_kwargs))
    agent = Agent(model, system_prompt=SYSTEM_PROMPT, deps_type=CupClient)

    @agent.tool
    async def cup_list_resources(ctx: RunContext[CupClient]) -> str:
        """List CUP resources this principal may discover."""
        result = await ctx.deps.call("resources/list")
        return json.dumps(result, indent=2)

    @agent.tool
    async def cup_read_resource(ctx: RunContext[CupClient], uri: str) -> str:
        """Read a CUP resource. uri looks like cup://inventory.products."""
        if not uri.startswith("cup://"):
            uri = f"cup://{uri}"
        result = await ctx.deps.call("resources/read", {"uri": uri})
        return json.dumps(result, indent=2)

    @agent.tool
    async def cup_list_tools(ctx: RunContext[CupClient]) -> str:
        """List CUP capabilities the principal may execute."""
        result = await ctx.deps.call("tools/list", {"goal": "manage inventory"})
        return json.dumps(result, indent=2)

    @agent.tool
    async def cup_call_tool(ctx: RunContext[CupClient], name: str, arguments_json: str) -> str:
        """Execute a CUP capability. arguments_json is a JSON object. Confirmation is bound automatically."""
        arguments = json.loads(arguments_json or "{}")
        result = await ctx.deps.call(
            "tools/call",
            {
                "name": name,
                "arguments": arguments,
                "confirmation": {"confirmedBy": ctx.deps.subject_id},
                "idempotencyKey": f"agent-{name}-{uuid4()}",
            },
        )
        return json.dumps(result, indent=2)

    return agent


async def handle(request: dict[str, Any]) -> dict[str, Any]:
    openai = request.get("openai") or {}
    api_key = openai.get("apiKey") or os.environ.get("OPENAI_API_KEY") or ""
    base_url = openai.get("baseUrl") or os.environ.get("OPENAI_BASE_URL") or ""
    model_name = openai.get("model") or os.environ.get("OPENAI_MODEL") or "gpt-4.1-mini"
    subject_id = str(request.get("subjectId") or "user:nia")
    message = str(request.get("message") or "")
    mcp_url = os.environ.get("CUP_MCP_URL") or "http://127.0.0.1:8784/mcp"
    cup = CupClient(url=mcp_url, subject_id=subject_id)

    if not api_key:
        listing = await cup.call("tools/list", {"goal": "manage inventory"})
        tools = listing.get("tools") if isinstance(listing, dict) else listing
        names = [item.get("name") for item in tools] if isinstance(tools, list) else []
        return {
            "text": (
                "No OpenAI API key configured. Set OPENAI_API_KEY, optional OPENAI_BASE_URL, "
                f"and OPENAI_MODEL, or fill the sidebar. CUP MCP is up. Usable tools: {names}"
            )
        }

    try:
        agent = build_agent(model_name, api_key, base_url or None)
        result = await agent.run(message, deps=cup)
        text = getattr(result, "output", None) or getattr(result, "data", None) or str(result)
        return {"text": text}
    except Exception as exc:  # noqa: BLE001
        return {"text": f"Agent error: {exc}"}


async def main() -> None:
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)
    while True:
        line = await reader.readline()
        if not line:
            break
        raw = line.decode("utf-8").strip()
        if not raw:
            continue
        request = json.loads(raw)
        result = await handle(request)
        sys.stdout.write(json.dumps({"id": request.get("id"), "result": result}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())
