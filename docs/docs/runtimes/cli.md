---
id: cli
title: CUP CLI
sidebar_label: CLI
description: Call the same CUP MCP methods from a command line client.
---

# CUP CLI

The reference CLI is an MCP-shaped client. It does not add a second permission model. Each command becomes one JSON-RPC method and goes through `createMCPServer().handle()`.

Install the package, then run `cup` from a host module that exports `{ cup }`:

```bash
npx cup --host ./dist/setup.js --subject user:alice tools list
```

`setup.js` is the Stage 1 runtime from [From zero to production](../build/from-zero-to-production.md). The CLI authenticates the `--subject` flag the same way the MCP profile reads `params.subjectId`.

## Command map

| CLI | MCP method |
|---|---|
| `cup init` | `initialize` |
| `cup resources list` | `resources/list` |
| `cup resources read <uri>` | `resources/read` |
| `cup resources templates` | `resources/templates/list` |
| `cup tools list` | `tools/list` |
| `cup tools call <name>` | `tools/call` |
| `cup prompts list` | `prompts/list` |
| `cup prompts get <name>` | `prompts/get` |

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

Output is JSON: the MCP response body. A CUP denial is a failed tool result (`isError: true`) or a JSON-RPC error. The process exit code is `1` for those failures and `2` for usage errors.

## Programmatic use

```ts
import { runCupCli } from '@capability-ui/core';

const result = await runCupCli({
  cup,
  argv: ['--subject', 'user:alice', 'resources', 'list'],
});
```

`createCupCli({ cup, name, authenticate })` wraps the same host. Tests and scripts should call `runCupCli` instead of spawning a process.

## What the CLI is not

The CLI is not a policy editor that bypasses CUP. Creating a resource, principal, or allow rule is still a `tools call` against a capability the current subject may execute. If Bob cannot see `workspace.addResource` in `tools list`, `cup --subject user:bob tools call workspace.addResource` is still denied.
