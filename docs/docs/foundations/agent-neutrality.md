---
id: agent-neutrality
title: Agent neutrality
description: Register and govern agents from any external framework without putting an agent framework in CUP.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Agent neutrality

CUP describes how an existing assistant may be found, called, and granted access to other resources. It does not define how that assistant plans, remembers, retries, selects a model, schedules work, or manages a conversation.

## Register an external assistant as a resource

The following resource describes an assistant hosted by an external runtime. The `read` function is intentionally absent because reading the agent resource is separate from invoking it.

```ts
import { CapabilityUI, subject, type Resource } from '@capability-ui/core';

const cup = new CapabilityUI();
const owner = subject('user:john', { role: 'owner', workspace: 'acme' });

const contractReviewAssistant: Resource = {
  id: 'agent.contract-review',
  type: 'agent',
  version: '1.0.0',
  sensitivity: 'confidential',
  owner: 'service:agent-platform',
  schema: {
    type: 'object',
    properties: {
      endpoint: { type: 'string' },
      input: { type: 'object' },
      output: { type: 'object' },
    },
    required: ['endpoint', 'input', 'output'],
  },
  metadata: {
    endpoint: 'https://agents.example.test/contract-review',
    runtime: 'external-runtime',
    supportedTasks: ['contract-risk-summary'],
    modelProvider: 'host-selected',
  },
};

cup.register(contractReviewAssistant);
cup.policy.allow({
  id: 'owner-discover-contract-review',
  principal: { id: owner.id },
  operation: ['discover', 'inspect'],
  resource: { id: contractReviewAssistant.id },
  priority: 10,
});
```

The metadata helps a client decide whether to offer the assistant. It does not grant access to the contracts that the assistant might later request.

## Represent invocation as a capability

The host runtime owns the actual call. CUP owns the input contract and the permission check around it.

```ts
import {
  CapabilityUI,
  defineCapability,
  subject,
  type ExecutionContext,
} from '@capability-ui/core';

const cup = new CapabilityUI();
const owner = subject('user:john', { role: 'owner', workspace: 'acme' });

// This function belongs to the host's chosen assistant runtime.
async function invokeExternalRuntime(input: unknown, context: ExecutionContext) {
  // Send only the input and context that the host has decided to disclose.
  return { taskId: context.requestId, status: 'submitted', input };
}

const runContractReview = defineCapability({
  id: 'assistant.contract-review.run',
  operation: 'execute',
  version: '1.0.0',
  sensitivity: 'confidential',
  schema: { type: 'object' },
  inputSchema: {
    type: 'object',
    properties: { contractId: { type: 'string' }, question: { type: 'string' } },
    required: ['contractId', 'question'],
  },
  outputSchema: { type: 'object' },
  sideEffects: ['Starts a task in an external assistant runtime'],
  risk: 'medium',
  confirmation: 'explicit',
  idempotency: 'required',
  reversibility: 'partially_reversible',
  handler: invokeExternalRuntime,
});

cup.register(runContractReview);
cup.policy.allow({
  id: 'owner-run-contract-review',
  principal: { id: owner.id },
  operation: 'execute',
  resource: { id: runContractReview.id },
  purpose: 'contract-review',
  priority: 10,
});
```

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
await cup.execute({
  subject: owner,
  capability: 'assistant.contract-review.run',
  input: { contractId: 'c-1', question: 'renewal risk' },
  purpose: 'contract-review',
  confirmation: { inputHash, confirmedBy: owner.id },
  idempotencyKey: 'review-1',
  context: { purpose: 'contract-review' },
});
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
    "name": "assistant.contract-review.run",
    "arguments": { "contractId": "c-1", "question": "renewal risk" },
    "confirmation": { "confirmedBy": "user:john" },
    "idempotencyKey": "review-1",
    "context": { "purpose": "contract-review" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:john \
  --purpose contract-review \
  tools call assistant.contract-review.run \
  --args '{"contractId":"c-1","question":"renewal risk"}' \
  --confirm --idempotency-key review-1
```

</TabItem>
</Tabs>

CUP still does not run the assistant. It checks whether the caller may start this task and records the call. The external runtime remains responsible for planning and task lifecycle.

## Agent-to-resource access

When the external assistant requests contract data, use `subject('agent:...')` in the read request. A policy can allow that agent to read a small field set for one purpose and one workspace. See [Delegation](../policies/delegation) for a short-lived grant pattern.

## Framework adapters

An adapter for LangGraph, AutoGen, CrewAI, OpenAI Agents SDK, or a custom loop should translate runtime events into CUP calls. It should not copy policy logic into prompts. A useful adapter has three responsibilities:

1. Convert the runtime’s identity and task context into a `Subject` and `RequestContext`.
2. Convert a tool or data request into `read()`, `prepare()`, or `execute()`.
3. Return CUP results, denials, obligations, and receipts to the runtime.

Everything else belongs to the external runtime.
