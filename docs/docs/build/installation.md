---
id: installation
title: Install CUP
sidebar_label: Installation
description: Install the TypeScript package and verify the toolchain.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Install CUP

CUP is distributed as a TypeScript package with no runtime dependency on a UI library, database, MCP SDK, or agent framework.

Until public npm is available, install from GitHub Packages (`@capability-ui` scope, org `Capability-UI`) using a PAT with `read:packages`. Do not commit the token.

```ini
# .npmrc
@capability-ui:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=TOKEN
```

```bash
npm i @capability-ui/core@0.2.0
```

## Requirements

- Node.js 20 or newer
- TypeScript 5.6 or newer for TypeScript projects
- A host authentication system
- A resource adapter for data-backed resources
- A GitHub PAT with `read:packages` while the package is only on GitHub Packages

For a project that compiles ESM TypeScript:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "node --test"
  },
  "dependencies": {
    "@capability-ui/core": "^0.2.0"
  }
}
```

## First verification

Host setup (CUP tab) registers policy. After that, discovery is the same request over MCP or the CLI.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

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

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list",
  "params": {
    "subjectId": "user:john",
    "context": { "purpose": "open-dashboard" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/first-cup.js --subject user:john \
  --purpose open-dashboard resources list
```

</TabItem>
</Tabs>

`resources/list` is CUP `discover`. A missing allow still returns an empty list rather than leaking the resource id.

## Host responsibilities

CUP needs a verified subject, resources, policy inputs, and handlers. The host supplies these pieces:

- Authentication turns a verified session into a `Subject`.
- Resource adapters read from your database or service.
- Execution handlers call your application services.
- A durable `ReceiptSink` stores evidence in production.
- Transport adapters connect HTTP, WebSocket, MCP, native mobile, or voice clients.

## Development checklist

Before adding a feature, write down the resource ID, version, sensitivity, supported operations, schema, side effects, risk, confirmation mode, idempotency behavior, and reversibility. Then write at least one allow test and one denial test for each protected operation.
