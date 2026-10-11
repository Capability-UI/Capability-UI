---
id: receipts
title: Receipts and audit records
sidebar_label: Receipts
description: Store and inspect evidence for reads, denials, failures, and successful actions.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Receipts and audit records

A receipt records what CUP decided and what happened afterward. It is useful to the client that needs to explain a failure, the operator investigating an incident, and the person reviewing an external action.

## Use the in-memory sink in tests

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
import { CapabilityUI, inMemoryReceipts } from '@capability-ui/core';

const receipts = inMemoryReceipts();
const cup = new CapabilityUI(receipts);

console.log(receipts.all());
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
    "name": "workspace.queryReceipts",
    "arguments": {}
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.queryReceipts --args '{}'
```

</TabItem>
</Tabs>

The default sink is also in memory. It is not durable and should not be used as the only audit store in production.

## Receipt shape

A receipt contains:

```ts
{
  id: 'receipt-id',
  status: 'succeeded' | 'failed' | 'denied',
  actor: { id: 'user:maya', type: 'user' },
  capability: 'mail.send',
  operation: 'execute',
  inputHash: 'hmac-sha256...',
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

New receipts always set `operation`. Older stored rows may omit it; read `receipt.operation` first and fall back to inferring from the capability suffix.

Receipts never store the raw input payload. `resultSummary` is produced by `summarizeResult` (default: no summary for `delete`, otherwise ids and counts only). Pass `confirmationKey` so `inputHash` is HMAC-SHA256. Plain SHA-256 is only used when no key is configured and is weak for short inputs.

On a hard delete, call `cup.scrubForResource(resourceId)` or `scrubReceiptsForResource(receipts, resourceId)` to keep id, operation, actor, timestamps, and status while dropping summaries and confirmation material. That path also scrubs cached idempotent receipts.

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

CUP records denials for missing confirmation, invalid input, stale policy, invalid delegation, explicit policy denial, and unauthenticated `read`/`execute` with no matching allow (`NO_ACCOUNT`). Authenticated subjects with no matching allow still see `NO_MATCHING_ALLOW`. Public guest allows are unchanged. Denied receipts omit the payload and result, and record unauthenticated actors as `anonymous`. SQL stores upsert that actor into `cup_subjects` in the same transaction as the receipt so a signed-in caller with no prior subject row still persists. Set `writeDeniedReceipts: false` (or a sampling function) if the host must rate-limit guest denials. A failure to persist a denied receipt is logged and never replaces `CUP_NOT_AUTHORIZED`.
