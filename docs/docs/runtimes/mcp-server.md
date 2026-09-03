---
id: mcp-server
title: Expose CUP through MCP
sidebar_label: MCP server
description: Map CUP-controlled resources and capabilities to MCP JSON-RPC methods.
---

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

```ts
const response = await mcp.handle({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { token: process.env.MCP_SESSION_TOKEN },
});
console.log(response.result);
```

The server advertises resources and tools. It also advertises subscriptions in the reference profile. A production HTTP or WebSocket host must implement framing, authentication transport, rate limits, and session lifecycle around `handle()`.

## List authorized resources

```ts
const response = await mcp.handle({
  jsonrpc: '2.0', id: 2, method: 'resources/list',
  params: { context: { workspace: 'acme', purpose: 'support-review' }, token: process.env.MCP_SESSION_TOKEN },
});
console.log(response.result);
```

`resources/list` calls CUP discovery. It does not return records. The client must call `resources/read` and pass a resource URI.

## Read through MCP

```ts
const response = await mcp.handle({
  jsonrpc: '2.0', id: 3, method: 'resources/read',
  params: { uri: 'cup://support.tickets', context: { workspace: 'acme', purpose: 'support-review' }, token: process.env.MCP_SESSION_TOKEN },
});
console.log(response.result);
```

The reference profile maps the URI to a CUP resource ID and returns the CUP read result, including its receipt ID.

## List and call tools

```ts
const tools = await mcp.handle({
  jsonrpc: '2.0', id: 4, method: 'tools/list',
  params: { goal: 'review support tickets', context: { workspace: 'acme', purpose: 'support-review' }, token: process.env.MCP_SESSION_TOKEN },
});

const call = await mcp.handle({
  jsonrpc: '2.0', id: 5, method: 'tools/call',
  params: { name: 'tickets.create', arguments: { title: 'Follow up' }, context: { workspace: 'acme', purpose: 'support-review' }, token: process.env.MCP_SESSION_TOKEN },
});
```

`tools/list` uses an authorized CUP view. `tools/call` still calls CUP execution directly. A tool that is absent from the list can still be denied if a caller sends its name manually.

## MCP errors

Unknown methods return JSON-RPC `-32601`. Authentication, policy, validation, and handler failures return a JSON-RPC `-32000` response with the CUP reason embedded in the message. A production profile may map reason codes into a stable public error schema.
