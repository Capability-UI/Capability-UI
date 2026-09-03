---
id: testing
title: Test CUP integrations
sidebar_label: Testing
description: Build conformance tests around authorization, execution, delegation, and adapters.
---

# Test CUP integrations

A CUP test suite should test what a caller can learn, what it can propose, what it can execute, and what happens when policy changes. Success-only tests miss the security boundary.

## Test a denied request first

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CapabilityUI, subject } from '@capability-ui/core';

test('denies an unconfigured read', async () => {
  const cup = new CapabilityUI();
  const user = subject('user:test');
  cup.register({ id: 'private.data', type: 'data', version: '1', sensitivity: 'restricted', schema: { type: 'array' }, async read() { return [{ secret: true }]; } });

  await assert.rejects(
    cup.read({ subject: user, resource: 'private.data', context: { purpose: 'test' } }),
    /CUP_NOT_AUTHORIZED:NO_MATCHING_ALLOW/,
  );
});
```

## Test the handler boundary

```ts
test('does not invoke a handler when confirmation is missing', async () => {
  const cup = new CapabilityUI();
  const user = subject('user:test');
  let calls = 0;
  cup.register({
    id: 'dangerous.action', type: 'capability', version: '1', sensitivity: 'restricted', schema: { type: 'object' },
    inputSchema: { type: 'object', required: ['value'] }, outputSchema: { type: 'object' },
    sideEffects: ['Changes production'], risk: 'critical', confirmation: 'explicit', idempotency: 'required', reversibility: 'irreversible',
    handler: async () => { calls += 1; return {}; },
  });
  cup.policy.allow({ id: 'allow', principal: { id: user.id }, operation: 'execute', resource: { id: 'dangerous.action' }, priority: 10 });

  const receipt = await cup.execute({ subject: user, capability: 'dangerous.action', input: { value: 1 }, context: { purpose: 'test' } });
  assert.equal(receipt.status, 'denied');
  assert.equal(receipt.decision.reasonCode, 'CONFIRMATION_REQUIRED');
  assert.equal(calls, 0);
});
```

## Required conformance cases

Test at least these cases:

- no matching allow denies
- unauthenticated protected subject denies
- discovery does not imply read
- lower-priority allow cannot override a higher-priority deny
- missing or mismatched scope denies
- redaction removes nested fields
- invalid input never reaches the handler
- changed input fails confirmation binding
- changed policy rejects a prepared request
- expired delegation denies
- delegation cannot invoke a different capability
- handler errors produce failed receipts
- subscriptions close and stop receiving callbacks
- MCP `tools/list` and `tools/call` use CUP decisions

## Property-style checks

For canonical hashes, generate equivalent objects with different nested key insertion order and assert the hash matches through `prepare()`. Generate changed leaves and assert the hash differs. For policy precedence, generate a high-priority deny alongside lower-priority allows and assert deny wins.
