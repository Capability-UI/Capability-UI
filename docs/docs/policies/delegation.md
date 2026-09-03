---
id: delegation
title: Delegation to an external assistant
sidebar_label: Delegation
description: Issue and enforce short-lived, purpose-bound grants to external agents.
---

# Delegation to an external assistant

Delegation lets one subject give another subject a bounded ability to execute a capability. The recipient still has its own identity. The grant contains the recipient, capability, allowed operations, scope, purpose, and expiration.

## Issue a grant

```ts
import { CapabilityUI, defineCapability, subject } from '@capability-ui/core';

const cup = new CapabilityUI();
const owner = subject('user:john', { role: 'owner', workspace: 'acme' });
const worker = subject('agent:research-worker', { role: 'worker', workspace: 'acme' });

const searchPublicSources = defineCapability({
  id: 'research.search-public', operation: 'execute', version: '1.0', sensitivity: 'public', schema: { type: 'object' },
  inputSchema: { type: 'object', required: ['query'] }, outputSchema: { type: 'array' },
  sideEffects: [], risk: 'low', confirmation: 'none', idempotency: 'supported',
  reversibility: 'reversible', handler: async input => ({ input, sources: [] }),
});
cup.register(searchPublicSources);

cup.policy.allow({
  id: 'owner-may-delegate-search', principal: { id: owner.id }, operation: 'delegate',
  resource: { id: searchPublicSources.id }, priority: 20,
});

const grant = await cup.delegate({
  from: owner,
  to: worker,
  capability: searchPublicSources.id,
  operations: ['execute'],
  purpose: 'research',
  expiresInMs: 15 * 60 * 1000,
});
console.log(grant.id, grant.expiresAt);
```

The grant is stored by CUP. A host can persist it separately if it needs grants to survive process restarts, then restore equivalent state through its own policy or delegation store.

## Execute with the grant

```ts
const receipt = await cup.execute({
  subject: worker,
  capability: searchPublicSources.id,
  input: { query: 'contract renewal practices' },
  delegation: grant,
  purpose: 'research',
  context: { purpose: 'research' },
});

console.log(receipt.status, receipt.decision.reasonCode);
// succeeded, DELEGATED_ALLOW
```

The recipient and capability must match the grant. The grant must be stored in the current CUP instance, unexpired, purpose-matching, and limited to `execute`. CUP also checks that an explicit current deny still wins.

## Attenuate grants for a team

A coordinator can issue separate grants to separate workers:

```ts
const publicSearchGrant = await cup.delegate({
  from: owner, to: worker, capability: searchPublicSources.id,
  operations: ['execute'], scope: { domain: 'public' },
  purpose: 'research', expiresInMs: 10 * 60 * 1000,
});
```

Do not pass the owner’s subject to the worker’s downstream calls. The worker calls CUP as `agent:research-worker`, which makes the boundary visible in policies and receipts.

## Revocation

The reference implementation checks the grant object stored in memory and its expiration. A production host should maintain a revocation record keyed by grant ID and check it before forwarding a call. Send an `access_removed` event to subscribers when a grant or source permission is revoked.
