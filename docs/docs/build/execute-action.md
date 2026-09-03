---
id: execute-action
title: Execute a capability
sidebar_label: Execute an action
description: Prepare, confirm, re-authorize, execute, and receipt a side-effecting action.
---

# Execute a capability

A capability is a typed action with metadata that tells clients what it accepts and what it may do. The handler is the host application service. CUP wraps the handler with validation and authorization.

## Define the action

```ts
import { CapabilityUI, defineCapability, subject } from '@capability-ui/core';

const cup = new CapabilityUI();
const owner = subject('user:john', { role: 'owner', workspace: 'acme' });

const createTask = defineCapability({
  id: 'tasks.create',
  operation: 'create',
  version: '1.0.0',
  sensitivity: 'personal',
  schema: { type: 'object', description: 'Create one task in a workspace' },
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      workspace: { type: 'string' },
      dueDate: { type: 'string' },
    },
    required: ['title', 'workspace'],
  },
  outputSchema: { type: 'object', required: ['id'] },
  sideEffects: ['Creates a task visible to the workspace'],
  risk: 'medium',
  confirmation: 'explicit',
  idempotency: 'required',
  reversibility: 'reversible',
  handler: async (input, context) => {
    // Call the host service here. The context contains the CUP request ID.
    return { id: 'task-123', createdFrom: context.requestId, input };
  },
});

cup.register(createTask);
cup.policy.allow({
  id: 'owner-create-task',
  principal: { id: owner.id },
  operation: 'execute',
  resource: { id: createTask.id },
  scope: { workspace: 'acme' },
  obligations: [{ type: 'write_receipt' }],
  priority: 10,
});
```

## Prepare and show a preview

```ts
const input = { title: 'Review renewal terms', workspace: 'acme' };
const prepared = await cup.prepare({
  subject: owner,
  capability: createTask.id,
  input,
  scope: { workspace: 'acme' },
  purpose: 'task-capture',
  context: { workspace: 'acme', purpose: 'task-capture' },
});

// The client shows prepared.preview to the user. It does not invent a second input.
console.log(prepared.preview.capability);
console.log(prepared.preview.input);
console.log(prepared.preview.sideEffects);
console.log(prepared.inputHash);
```

`prepare()` validates the input, evaluates the current policy, creates a request ID, records the policy version, and returns a preview. It does not invoke the handler.

## Confirm and execute

```ts
const receipt = await cup.execute({
  subject: owner,
  capability: createTask.id,
  input,
  requestId: prepared.request.requestId,
  confirmation: {
    inputHash: prepared.inputHash,
    confirmedBy: owner.id,
  },
  idempotencyKey: 'client-generated-task-2026-09-02-001',
  scope: { workspace: 'acme' },
  purpose: 'task-capture',
  context: { workspace: 'acme', purpose: 'task-capture' },
});

if (receipt.status === 'succeeded') console.log(receipt.resultSummary);
else console.error(receipt.decision.reasonCode);
```

`execute()` validates again, checks the prepared policy version, re-authorizes the proposed input, verifies confirmation, invokes the handler, and writes a receipt. A changed input, changed policy, missing confirmation, or denied operation never reaches the handler.

## Risk and confirmation modes

Use `none` for reads or harmless local operations. Use `preview` when the client should show changes but the product does not require a human confirmation. Use `explicit` for sending, publishing, deleting, or other consequential actions. Use `human_review` when a second person or approval workflow must participate.

## Idempotency and reversibility

`idempotency: 'required'` tells clients that retries must carry a stable idempotency key. The handler or host service must enforce uniqueness. `reversibility` describes what the product can undo. It is metadata for policy and UI decisions, not an automatic rollback mechanism.
