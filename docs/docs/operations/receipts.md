---
id: receipts
title: Receipts and audit records
sidebar_label: Receipts
description: Store and inspect evidence for reads, denials, failures, and successful actions.
---

# Receipts and audit records

A receipt records what CUP decided and what happened afterward. It is useful to the client that needs to explain a failure, the operator investigating an incident, and the person reviewing an external action.

## Use the in-memory sink in tests

```ts
import { CapabilityUI, inMemoryReceipts } from '@capability-ui/core';

const receipts = inMemoryReceipts();
const cup = new CapabilityUI(receipts);

// After a read or execute call:
console.log(receipts.all());
```

The default sink is also in memory. It is not durable and should not be used as the only audit store in production.

## Receipt shape

A receipt contains:

```ts
{
  id: 'receipt-id',
  status: 'succeeded' | 'failed' | 'denied',
  actor: { id: 'user:maya', type: 'user' },
  capability: 'mail.send',
  inputHash: 'sha256...',
  decision: {
    requestId: 'request-id',
    effect: 'allow',
    reasonCode: 'ALLOWED',
    matchedPolicies: ['maya-send-mail'],
    obligations: [],
    policyVersion: 'policy-3'
  },
  resultSummary: { messageId: 'provider-id' },
  createdAt: '2026-09-02T12:00:00.000Z'
}
```

The `inputHash` lets you connect confirmation and execution without storing the entire request in the receipt. Decide carefully whether `resultSummary` can contain personal or secret data.

## Durable sink

Implement `ReceiptSink` with a database or append-only log:

```ts
import { type Receipt, type ReceiptSink } from '@capability-ui/core';

class DatabaseReceiptSink implements ReceiptSink {
  async append(receipt: Receipt): Promise<void> {
    await db.receipts.insert({
      id: receipt.id,
      status: receipt.status,
      actorId: receipt.actor.id,
      actorType: receipt.actor.type,
      capability: receipt.capability,
      inputHash: receipt.inputHash,
      decision: JSON.stringify(receipt.decision),
      resultSummary: JSON.stringify(receipt.resultSummary ?? null),
      createdAt: receipt.createdAt,
    });
  }

  all(): Receipt[] {
    throw new Error('Use a paginated database query in production');
  }
}
```

Use append-only permissions, server timestamps, retention rules, and access controls appropriate for audit data. Do not log bearer credentials or raw sensitive inputs.

## Denial receipts

CUP records denials for missing confirmation, invalid input, stale policy, invalid delegation, and explicit policy denial. A client can display the reason code. An operator can use the request ID and policy version to investigate the decision.
