---
id: cli
title: CUP CLI
sidebar_label: CLI
description: Call the same CUP MCP methods from a command line client.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# CUP CLI

The `cup` binary is an MCP-shaped client. It does not add a second permission model. Each command becomes one JSON-RPC method and goes through `createMCPServer().handle()`. If CUP would deny the MCP call, the CLI prints that denial and exits `1`.

Install the package, compile a Stage 1 host that exports `{ cup }`, then run:

<Tabs groupId="surface">
<TabItem value="cli" label="CLI">

```bash
npx cup --host ./dist/setup.js --subject user:admin tools list
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": { "subjectId": "user:admin" }
}
```

</TabItem>
<TabItem value="cup" label="CUP">

```ts
import { runCupCli } from '@capability-ui/core';

await runCupCli({
  cup,
  argv: ['--subject', 'user:admin', 'tools', 'list'],
});
```

</TabItem>
</Tabs>

`setup.js` is the Stage 1 runtime from [From zero to production](../build/from-zero-to-production.md). The CLI authenticates `--subject` the same way the MCP profile reads `params.subjectId`.

## Command map

| CLI | MCP method | CUP call |
|---|---|---|
| `cup init` | `initialize` | Session bind |
| `cup resources list` | `resources/list` | `cup.discover()` |
| `cup resources read <uri>` | `resources/read` | `cup.read()` |
| `cup resources templates` | `resources/templates/list` | inspectable projection |
| `cup tools list` | `tools/list` | `cup.project()` capabilities |
| `cup tools call <name>` | `tools/call` | `cup.execute()` |
| `cup prompts list` | `prompts/list` | registered prompts |
| `cup prompts get <name>` | `prompts/get` | prompt template |

## Flags

| Flag | Meaning |
|---|---|
| `--host <module>` | ESM module exporting `{ cup }` |
| `--subject <id>` | Principal for this call |
| `--purpose <text>` | Purpose bound into context |
| `--context <json>` | Extra context object |
| `--goal <text>` | Goal for `tools list` |
| `--args <json>` | Arguments for `tools call` or `prompts get` |
| `--confirm` | Bind confirmation to the subject and canonical argument hash |
| `--idempotency-key <key>` | Idempotency key for mutating tools |
| `--delegation <json>` | Delegation grant for an attenuated call |
| `--help` | Print usage |

Output is the MCP JSON-RPC response. Exit `1` for CUP or JSON-RPC failures. Exit `2` for usage errors.

## Discover and read

<Tabs groupId="surface">
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:bob \
  --context '{"workspaceId":"acme"}' --purpose contact_lookup \
  resources list

cup --host ./dist/setup.js --subject user:bob \
  --context '{"workspaceId":"acme"}' --purpose contact_lookup \
  resources read cup://crm.contacts
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list",
  "params": {
    "subjectId": "user:bob",
    "context": { "workspaceId": "acme", "purpose": "contact_lookup" }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": {
    "subjectId": "user:bob",
    "uri": "cup://crm.contacts",
    "context": { "workspaceId": "acme", "purpose": "contact_lookup" }
  }
}
```

</TabItem>
<TabItem value="cup" label="CUP">

```ts
await cup.discover({
  subject: bob,
  purpose: 'contact_lookup',
  context: { workspaceId: 'acme', purpose: 'contact_lookup' },
});

await cup.read({
  subject: bob,
  resource: 'crm.contacts',
  purpose: 'contact_lookup',
  context: { workspaceId: 'acme', purpose: 'contact_lookup' },
});
```

</TabItem>
</Tabs>

## List and call tools

A first mutating call without `--confirm` is denied when the capability requires confirmation. That is the same `CONFIRMATION_REQUIRED` receipt MCP returns.

<Tabs groupId="surface">
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  --goal "create a contacts resource" tools list

cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.addResource \
  --args '{"resourceId":"crm.contacts","name":"CRM Contacts","sensitivity":"confidential"}'

cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.addResource \
  --args '{"resourceId":"crm.contacts","name":"CRM Contacts","sensitivity":"confidential"}' \
  --confirm --idempotency-key add-crm-contacts-v1
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {
    "subjectId": "user:admin",
    "goal": "create a contacts resource"
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
    "name": "workspace.addResource",
    "arguments": {
      "resourceId": "crm.contacts",
      "name": "CRM Contacts",
      "sensitivity": "confidential"
    },
    "confirmation": {
      "confirmedBy": "user:admin",
      "inputHash": "<canonical hash of arguments>"
    },
    "idempotencyKey": "add-crm-contacts-v1"
  }
}
```

</TabItem>
<TabItem value="cup" label="CUP">

```ts
await cup.project({ subject: admin, goal: 'create a contacts resource', context: {} });

await cup.execute({
  subject: admin,
  capability: 'workspace.addResource',
  input: { resourceId: 'crm.contacts', name: 'CRM Contacts', sensitivity: 'confidential' },
  confirmation: { inputHash, confirmedBy: admin.id },
  idempotencyKey: 'add-crm-contacts-v1',
  context: {},
});
```

</TabItem>
</Tabs>

## Denied calls

<Tabs groupId="surface">
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:bob \
  tools call workspace.addResource \
  --args '{"resourceId":"crm.leads","name":"Leads","sensitivity":"confidential"}'
# exit 1, reasonCode: NO_MATCHING_ALLOW
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "subjectId": "user:bob",
    "name": "workspace.addResource",
    "arguments": {
      "resourceId": "crm.leads",
      "name": "Leads",
      "sensitivity": "confidential"
    }
  }
}
```

</TabItem>
<TabItem value="cup" label="CUP">

```ts
const receipt = await cup.execute({
  subject: bob,
  capability: 'workspace.addResource',
  input: { resourceId: 'crm.leads', name: 'Leads', sensitivity: 'confidential' },
  context: {},
});
// receipt.status === 'denied'
```

</TabItem>
</Tabs>

## Programmatic use

Use `runCupCli` in tests instead of spawning a process:

```ts
import { createCupCli, runCupCli } from '@capability-ui/core';

const cli = createCupCli({ cup, name: 'acme-workspace' });

const listed = await runCupCli({
  cup,
  argv: ['--subject', 'user:admin', 'resources', 'list'],
});
```

## What the CLI is not

The CLI is not a policy editor that bypasses CUP. Creating a resource, principal, or allow rule is still `tools call` against a capability the current subject may execute. If Bob cannot see `workspace.addResource` in `tools list`, `cup --subject user:bob tools call workspace.addResource` is still denied.
