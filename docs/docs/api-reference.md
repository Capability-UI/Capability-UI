---
id: api-reference
title: API reference
description: Public exports in @capability-ui/core.
---

# API reference

The TypeScript declarations in `src/index.ts` are the source of truth. This page groups the public exports by responsibility.

## Main runtime

### `CapabilityUI`

- `new CapabilityUI(receipts?: ReceiptSink)` creates a runtime.
- `register(resource)` registers a `Resource` or `Capability`.
- `registerAdapter(adapter)` attaches a `ResourceAdapter` or `ExecutionAdapter` to a registered resource.
- `authorize(request)` returns a `Decision`.
- `discover(request)` returns resources allowed for `discover`.
- `project(request)` returns an `AuthorizedView` with resources and executable capabilities.
- `read(request)` reads through a resource adapter and records a receipt.
- `prepare(request)` validates, authorizes, and previews an action without invoking it.
- `execute(request)` validates, re-authorizes, checks confirmation or delegation, invokes the handler, and records a receipt.
- `delegate(request)` creates and stores a bounded `DelegationGrant`.
- `subscribe(request)` creates an authorized in-process subscription.
- `publish(event)` sends a `ResourceEvent` to current listeners.

## Constructors and helpers

```ts
import {
  capability,
  conditions,
  defineCapability,
  inMemoryReceipts,
  resource,
  subject,
} from '@capability-ui/core';
```

- `subject(id, attributes?, authenticated?)` creates the example subject shape. Use verified identity data in production.
- `resource(id, version?)` creates a `ResourceRef`.
- `capability(id)` creates a capability `ResourceRef`.
- `defineCapability(config)` adds `type: 'capability'` to a capability definition.
- `inMemoryReceipts()` creates a development/test `MemoryReceiptSink`.
- `createCapabilityUI(options)` creates a runtime, optionally registering resources and injecting a receipt sink.
- `canonicalInputHash(input)` exposes the same canonical SHA-256 input hash used for confirmation binding.
- `verifyActionToken(view, token)` finds a token in an authorized view for client-side routing.
- `conditions.purposeIs(value)` matches the request purpose.
- `conditions.recipientCountAtMost(max)` checks an array named `recipients` in proposed input.
- `conditions.inputFieldEquals(field, expected)` checks one top-level proposed input field.

## Core types

- `Subject`: `id`, `type`, `authenticated`, and arbitrary `attributes`.
- `Resource`: identity, type, version, sensitivity, schema, owner, metadata, and optional `read` function.
- `Capability`: a resource with operation, input and output schemas, side effects, risk, confirmation, idempotency, reversibility, and handler.
- `Policy`: principal, operation, resource, optional scope, conditions, obligations, priority, and expiry.
- `Decision`: effect, reason code, matched policies, obligations, policy version, and request ID.
- `AuthorizedView`: subject-specific resources, capabilities, and policy version.
- `Receipt`: status, actor, capability, input hash, decision, result summary, and timestamp.
- `ReceiptQuery`: optional request, actor, capability, and status filters for receipt lookup.
- `DelegationGrant`: source, recipient, capability, allowed operations, scope, purpose, and expiration.

## MCP profile

- `createMCPServer({ cup, name, authenticate? })` returns an object with `handle(request)`.
- Supported methods in the reference profile: `initialize`, `resources/list`, `resources/read`, `tools/list`, and `tools/call`.
- The MCP profile is transport-neutral. Host it behind HTTP, WebSocket, stdio, or another framing layer.

## Adapter contracts

- `IdentityAdapter` resolves an authenticated transport request to a `Subject`.
- `ResourceAdapter` loads current data for a registered resource.
- `ExecutionAdapter` invokes a capability handler through a host service.
- `PolicyAdapter` describes an external policy engine integration.
- `RendererAdapter<T>` converts an `AuthorizedView` into a client-specific presentation.

These interfaces describe integration boundaries. The current `CapabilityUI` instance remains the in-memory reference evaluator; SQL-backed policy and resource stores must be implemented by the host as described in [CUP data model](architecture/data-model).

## TypeScript imports

The package is ESM. Use `.js` extensions for relative imports in compiled TypeScript and import public types with `type` when your compiler settings require it.
