---
id: source-architecture
title: Source architecture
description: Understand how the CUP package is divided into modules and how a request moves through them.
---

# Source architecture

The package is intentionally split by responsibility. `src/index.ts` is a public barrel, not the implementation.

```text
src/
├── index.ts          Public exports
├── runtime.ts        Reference runtime and core semantics
├── components.ts     Registry, policy, projector, and executor facades
├── adapters.ts       Host integration contracts and resource registry
├── persistence.ts    SQL client contract, PostgreSQL repository, schema constant
├── protocol.ts       Action-token service, MCP transport types, renderer helpers
├── mcp-client.ts     MCP client and namespace mount helpers
├── cli.ts            MCP-shaped command line client
└── bin/cup.ts        `cup` executable entry
sql/
└── 001_cup_initial.sql  PostgreSQL reference migration
```

## Feature summary (v0.2.0)

| Feature | Location |
|---|---|
| `CapabilityUI` / `denyByDefault()` | `runtime.ts` |
| `revokeGrant(grantId)` | `runtime.ts` |
| `Projector.redact(data, decision)` | `components.ts` |
| `CapabilityRegistry.listDiscoverable(request?)` | `components.ts` |
| Field-level `writable` on `AuthorizedResource.fields` | `runtime.ts` `project()` |
| `resources/templates/list` MCP method | `runtime.ts` `createMCPServer()` |
| MCP-shaped CLI | `cli.ts`, `bin/cup.ts` |
| `validDuring` in PostgreSQL persistence | `persistence.ts` |
| `PostgresPersistence.revokeGrant(grantId)` | `persistence.ts` |
| `CupPersistence.revokeGrant` interface | `persistence.ts` |

## Request flow

1. A host identity adapter resolves a verified request into a `Subject`.
2. The registry supplies the current resource or capability definition.
3. The policy engine matches subject, operation, resource, scope, purpose, conditions, and expiry.
4. The projector creates a subject-specific `AuthorizedView` and short-lived action tokens.
5. A client or outside assistant proposes a read or action using that view.
6. The executor validates the input and re-authorizes the exact request.
7. Confirmation binds to the canonical input hash when the capability requires it.
8. A capability adapter invokes the host service.
9. The receipt sink records success, denial, or handler failure.

## Runtime versus production services

`runtime.ts` is usable without a database and is the reference semantic implementation. `persistence.ts` provides a parameterized PostgreSQL repository and the migration schema, but the host must connect those records to a runtime snapshot and decide how to decode custom policy conditions.

This separation avoids hiding database, authentication, and provider behavior inside the protocol core. A host can use PostgreSQL, another relational database, a policy engine such as OPA or Cedar, or a configuration-backed registry while keeping the same CUP request and decision shapes.

## Public barrel usage

```ts
import {
  CapabilityUI,
  CapabilityRegistry,
  Executor,
  PostgresPersistence,
  createMCPServer,
  defineCapability,
} from '@capability-ui/core';
```

The package emits declarations for every exported module. Internal helpers such as canonicalization and schema validation stay private to the runtime unless an explicit public helper is provided.

## SQL startup

Run the migration with your normal migration tool, then register the current definitions:

```ts
import { CapabilityUI } from '@capability-ui/core';
import { PostgresPersistence } from '@capability-ui/core';

const store = new PostgresPersistence(db);
const cup = new CapabilityUI();

for (const resource of await store.resources()) cup.register(resource);
for (const policy of await store.policies()) {
  const { effect, ...input } = policy;
  effect === 'allow' ? cup.policy.allow(input) : cup.policy.deny(input);
}
```

The host should cache this snapshot by the durable policy revision and rebuild it when a revision changes. Prepared actions must retain the revision used for preparation and reject execution against a newer revision.
