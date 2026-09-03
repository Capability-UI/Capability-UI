---
id: security-model
title: Security model
description: Understand CUP's enforcement boundaries and threat model.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Security model

CUP assumes that a client, renderer, prompt, generated interface, or external assistant can make a wrong request. The library therefore treats the execution boundary as authoritative and treats every earlier projection as advisory input for composition.

## Required boundaries

### Authentication comes before authorization

CUP can deny unauthenticated non-discovery operations, but it cannot verify a session or token. The host must authenticate the caller, construct a subject, and preserve the distinction between a human, an assistant, and a service.

### Discovery is not access

A subject may discover a resource without inspecting its schema or reading its records. Do not turn a discovery response into a data response. The client must ask for the stronger operation.

### Policy is checked again at execution

A prepared decision can become stale after a policy changes. The reference implementation stores the policy version with the preparation and rejects execution when the version changes. Production stores should use an equivalent compare-and-check mechanism.

### Confirmation binds to the exact input

A confirmation for one email must not authorize a changed email. CUP canonicalizes nested objects, sorts object keys recursively, preserves array order, and hashes the resulting JSON. The execution request must present the same hash and the confirming subject.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
import { CapabilityUI, defineCapability, subject } from '@capability-ui/core';

const cup = new CapabilityUI();
const user = subject('user:john', { role: 'owner' });
const sendEmail = defineCapability({
  id: 'mail.send', operation: 'execute', version: '1.0', sensitivity: 'personal', schema: { type: 'object' },
  inputSchema: { type: 'object', required: ['to', 'body'] }, outputSchema: { type: 'object' },
  sideEffects: ['Sends an email'], risk: 'high', confirmation: 'explicit',
  idempotency: 'required', reversibility: 'irreversible',
  handler: async input => ({ sent: true, input }),
});
cup.register(sendEmail);
cup.policy.allow({ id: 'send', principal: { id: user.id }, operation: 'execute', resource: { id: sendEmail.id }, priority: 10 });

const input = { to: ['customer@example.test'], body: 'Approved copy' };
const prepared = await cup.prepare({ subject: user, capability: sendEmail.id, input, context: { purpose: 'customer-follow-up' } });

const receipt = await cup.execute({
  subject: user,
  capability: sendEmail.id,
  input: { body: 'Approved copy', to: ['customer@example.test'] },
  requestId: prepared.request.requestId,
  confirmation: { inputHash: prepared.inputHash, confirmedBy: user.id },
  context: { purpose: 'customer-follow-up' },
});
console.log(receipt.status);
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "subjectId": "user:john",
    "name": "mail.send",
    "arguments": { "to": ["customer@example.test"], "body": "Approved copy" },
    "confirmation": { "confirmedBy": "user:john" },
    "idempotencyKey": "mail-1",
    "context": { "purpose": "customer-follow-up" }
  }
}
```

Changing `to` or `body` after confirmation produces `CONFIRMATION_REQUIRED` or a mismatched hash denial.

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:john \
  --purpose customer-follow-up \
  tools call mail.send \
  --args '{"to":["customer@example.test"],"body":"Approved copy"}' \
  --confirm --idempotency-key mail-1
```

</TabItem>
</Tabs>

Changing the recipient or body causes a different hash and produces a denied receipt.

## Least privilege at the field boundary

A policy obligation can redact nested fields. The resource adapter should also enforce its own data ownership rules. Redaction is a defense-in-depth output control, not a substitute for query authorization.

## Threats CUP addresses

- Generated UI exposing a forbidden button.
- A model calling a capability that was absent from its authorized view.
- A user changing a confirmed payload before execution.
- A policy changing between preparation and execution.
- An assistant receiving broader delegation than its parent had.
- A remote MCP server exposing a tool without local policy review.

## Threats the host must address

- Forged authentication tokens.
- Compromised adapter credentials.
- Malicious or incorrect resource adapters.
- Replay of requests outside the host's transport controls.
- Durable receipt tampering.
- Network-level authorization and rate limits.

## Fail closed

If there is no matching allow, if the subject is not authenticated for a protected operation, if a scope is missing, if confirmation does not match, or if a delegation is expired, the call must fail without invoking the handler.
