---
id: installation
title: Install CUP
sidebar_label: Installation
description: Install the TypeScript package and verify the toolchain.
---

# Install CUP

CUP is distributed as a TypeScript package with no runtime dependency on a UI library, database, MCP SDK, or agent framework.

## Requirements

- Node.js 20 or newer
- TypeScript 5.6 or newer for TypeScript projects
- A host authentication system
- A resource adapter for data-backed resources

```bash
npm install @capability-ui/core
```

For a project that compiles ESM TypeScript:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "node --test"
  },
  "dependencies": {
    "@capability-ui/core": "^0.1.1"
  }
}
```

## First verification

```ts
// first-cup.ts
import { CapabilityUI, subject } from '@capability-ui/core';

const cup = new CapabilityUI();
const user = subject('user:john', { role: 'owner' });

cup.policy.allow({
  id: 'john-can-discover',
  principal: { id: user.id },
  operation: 'discover',
  resource: { id: 'workspace.project' },
  priority: 10,
});

const decision = await cup.authorize({
  subject: user,
  operation: 'discover',
  resource: { id: 'workspace.project' },
  context: { purpose: 'open-dashboard' },
});

console.log(decision.effect, decision.reasonCode);
// allow ALLOWED
```

## Host responsibilities

CUP needs a verified subject, resources, policy inputs, and handlers. The host supplies these pieces:

- Authentication turns a verified session into a `Subject`.
- Resource adapters read from your database or service.
- Execution handlers call your application services.
- A durable `ReceiptSink` stores evidence in production.
- Transport adapters connect HTTP, WebSocket, MCP, native mobile, or voice clients.

## Development checklist

Before adding a feature, write down the resource ID, version, sensitivity, supported operations, schema, side effects, risk, confirmation mode, idempotency behavior, and reversibility. Then write at least one allow test and one denial test for each protected operation.
