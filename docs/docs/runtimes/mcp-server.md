---
id: mcp-server
title: Expose CUP through MCP
sidebar_label: MCP server
description: Map CUP-controlled resources and capabilities to MCP JSON-RPC methods.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Expose CUP through MCP

The reference package includes a dependency-free JSON-RPC MCP server profile. It maps MCP methods to CUP operations. MCP carries the request. CUP remains responsible for the authorization decision.

## Create a server

```ts
import { CapabilityUI, createMCPServer, subject } from '@capability-ui/core';

const cup = new CapabilityUI();

const mcp = createMCPServer({
  cup,
  name: 'acme-cup-server',
  authenticate: async request => {
    // Replace this with token verification in the transport host.
    const token = request.params?.token;
    if (token !== process.env.MCP_SESSION_TOKEN) throw new Error('MCP_AUTH_FAILED');
    return subject('service:mcp-client', { workspace: 'acme' }, true);
  },
});
```

The authentication callback returns a CUP subject. It should verify the transport credential, bind the session to a tenant, and reject invalid sessions before the request reaches data or tools.

## Initialize

<Tabs groupId="surface">
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": { "token": "<session-token>" }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin init
```

</TabItem>
<TabItem value="cup" label="CUP">

```ts
const response = await mcp.handle({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { token: process.env.MCP_SESSION_TOKEN },
});
```

</TabItem>
</Tabs>

The server advertises resources and tools. It also advertises subscriptions in the reference profile. A production HTTP or WebSocket host must implement framing, authentication transport, rate limits, and session lifecycle around `handle()`.

## List authorized resources

<Tabs groupId="surface">
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/list",
  "params": {
    "subjectId": "user:maya",
    "context": { "workspace": "acme", "purpose": "support-review" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:maya \
  --purpose support-review --context '{"workspace":"acme"}' \
  resources list
```

</TabItem>
<TabItem value="cup" label="CUP">

```ts
await cup.discover({
  subject: maya,
  purpose: 'support-review',
  context: { workspace: 'acme', purpose: 'support-review' },
});
```

</TabItem>
</Tabs>

`resources/list` calls CUP discovery. It does not return records. The client must call `resources/read` and pass a resource URI.

## Read through MCP

<Tabs groupId="surface">
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "resources/read",
  "params": {
    "subjectId": "user:maya",
    "uri": "cup://support.tickets",
    "context": { "workspace": "acme", "purpose": "support-review" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:maya \
  --purpose support-review --context '{"workspace":"acme"}' \
  resources read cup://support.tickets
```

</TabItem>
<TabItem value="cup" label="CUP">

```ts
await cup.read({
  subject: maya,
  resource: 'support.tickets',
  purpose: 'support-review',
  context: { workspace: 'acme', purpose: 'support-review' },
});
```

</TabItem>
</Tabs>

The reference profile maps the URI to a CUP resource ID and returns the CUP read result, including its receipt ID.

## List and call tools

<Tabs groupId="surface">
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/list",
  "params": {
    "subjectId": "user:maya",
    "goal": "review support tickets",
    "context": { "workspace": "acme", "purpose": "support-review" }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "subjectId": "user:maya",
    "name": "tickets.create",
    "arguments": { "title": "Follow up" },
    "context": { "workspace": "acme", "purpose": "support-review" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:maya \
  --goal "review support tickets" --purpose support-review \
  --context '{"workspace":"acme"}' tools list

cup --host ./dist/setup.js --subject user:maya \
  --purpose support-review --context '{"workspace":"acme"}' \
  tools call tickets.create --args '{"title":"Follow up"}' --confirm
```

</TabItem>
<TabItem value="cup" label="CUP">

```ts
await cup.project({
  subject: maya,
  goal: 'review support tickets',
  context: { workspace: 'acme', purpose: 'support-review' },
});

await cup.execute({
  subject: maya,
  capability: 'tickets.create',
  input: { title: 'Follow up' },
  purpose: 'support-review',
  context: { workspace: 'acme', purpose: 'support-review' },
});
```

</TabItem>
</Tabs>

`tools/list` uses an authorized CUP view. `tools/call` still calls CUP execution directly. A tool that is absent from the list can still be denied if a caller sends its name manually.

## MCP errors

Unknown methods return JSON-RPC `-32601`. Authentication, policy, validation, and handler failures return a JSON-RPC `-32000` response with the CUP reason embedded in the message. A production profile may map reason codes into a stable public error schema.

The same methods are available from the [CUP CLI](cli). Use that when a person or script should issue Path A operations without an MCP agent.
