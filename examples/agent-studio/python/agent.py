#!/usr/bin/env python3
"""PydanticAI agent that calls CUP through JSON-RPC MCP."""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from dataclasses import dataclass
from typing import Any
from urllib.request import Request, urlopen
from uuid import uuid4

SYSTEM_PROMPT = """You are the Keel floor copilot. Harbor is a warehouse.

When they ask for a dashboard or KPIs, emit only stat surfaces. When they ask for a briefing, count sheet, worklist, or submit desk, invent a layout from the authorized view (custom titles, column subsets, cards vs tables). Do not only reuse the green shortcut chips.

You may only change data by calling CUP MCP tools. The canvas is not a security boundary.
After tools run, summarize the receipt status. If a tool is denied, explain the reason code
and do not pretend the write succeeded.

When they ask to see, add, or build UI, emit a fenced cup-ui JSON block after a short reply:

```cup-ui
{"op":"upsert","surfaces":[{"id":"table:products-low","title":"Below reorder","kind":"table","resourceId":"inventory.products","filter":"belowReorder"}]}
```

ops:
- upsert: add or replace surfaces by id
- replace: rebuild the canvas
- clear: empty the canvas

kind must be table, form, stat, cards, or notice.
Use only resource ids and capability ids from the authorized view in this turn.
Do not include a submit form unless inventory.submitPurchaseOrder is listed.
Do not include unitCost in columns unless that field is present for this shift.

Prefer inventory.draftPurchaseOrder for restock. Include a short reason string.
Use inventory.submitPurchaseOrder only when they clearly ask to send the order.
Use inventory.adjust for count corrections.
"""

CUP_UI_RE = re.compile(r"```cup-ui\s*([\s\S]*?)```", re.IGNORECASE)


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


def upsert_surfaces(current: list[Any], incoming: list[Any]) -> list[Any]:
    by_id: dict[str, Any] = {}
    for item in current:
        if isinstance(item, dict) and item.get("id"):
            by_id[str(item["id"])] = item
    for item in incoming:
        if isinstance(item, dict) and item.get("id"):
            by_id[str(item["id"])] = item
    return list(by_id.values())


def apply_cup_ui(text: str, surfaces: list[Any]) -> tuple[str, list[Any]]:
    match = CUP_UI_RE.search(text)
    if not match:
        return text.strip(), surfaces
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return CUP_UI_RE.sub("", text).strip(), surfaces
    op = payload.get("op") if isinstance(payload, dict) else "upsert"
    incoming = payload.get("surfaces") if isinstance(payload, dict) else []
    if not isinstance(incoming, list):
        incoming = []
    if op == "clear":
        next_surfaces: list[Any] = []
    elif op == "replace":
        next_surfaces = incoming
    else:
        next_surfaces = upsert_surfaces(surfaces, incoming)
    return CUP_UI_RE.sub("", text).strip(), next_surfaces


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


def view_brief(view: Any) -> str:
    if not isinstance(view, dict):
        return "{}"
    resources = view.get("resources") or []
    capabilities = view.get("capabilities") or []
    resource_ids = []
    for item in resources:
        if isinstance(item, dict):
            ref = item.get("ref") or {}
            resource_ids.append({
                "id": ref.get("id"),
                "visibility": item.get("visibility"),
                "hiddenFields": [field.get("path") for field in (item.get("fields") or []) if isinstance(field, dict) and field.get("readable") is False],
            })
    cap_ids = [item.get("id") for item in capabilities if isinstance(item, dict)]
    return json.dumps({"resources": resource_ids, "capabilities": cap_ids})


async def handle(request: dict[str, Any]) -> dict[str, Any]:
    openai = request.get("openai") or {}
    api_key = openai.get("apiKey") or os.environ.get("OPENAI_API_KEY") or ""
    base_url = openai.get("baseUrl") or os.environ.get("OPENAI_BASE_URL") or ""
    model_name = openai.get("model") or os.environ.get("OPENAI_MODEL") or "gpt-4.1-mini"
    subject_id = str(request.get("subjectId") or "user:nia")
    message = str(request.get("message") or "")
    surfaces = request.get("surfaces") if isinstance(request.get("surfaces"), list) else []
    mcp_url = os.environ.get("CUP_MCP_URL") or "http://127.0.0.1:8784/mcp"
    cup = CupClient(url=mcp_url, subject_id=subject_id)

    if not api_key:
        listing = await cup.call("tools/list", {"goal": "manage inventory"})
        tools = listing.get("tools") if isinstance(listing, dict) else listing
        names = [item.get("name") for item in tools] if isinstance(tools, list) else []
        return {
            "text": (
                "No OpenAI API key configured. The canvas still generates tables and forms "
                f"from this shift. Set OPENAI_API_KEY to change data in chat. Usable tools: {names}"
            ),
            "surfaces": surfaces,
        }

    prompt = (
        f"{message}\n\n"
        f"Authorized view: {view_brief(request.get('view'))}\n"
        f"Current canvas: {json.dumps(surfaces)}\n"
        "If they want to see data, add UI. If they want a count or PO change, call CUP tools."
    )

    try:
        agent = build_agent(model_name, api_key, base_url or None)
        result = await agent.run(prompt, deps=cup)
        text = getattr(result, "output", None) or getattr(result, "data", None) or str(result)
        cleaned, next_surfaces = apply_cup_ui(str(text), surfaces)
        return {"text": cleaned, "surfaces": next_surfaces}
    except Exception as exc:  # noqa: BLE001
        return {"text": f"Agent error: {exc}", "surfaces": surfaces}


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
