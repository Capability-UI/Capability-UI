---
id: agent-resources
title: Model external agents as resources
sidebar_label: Agent resources
description: Register an assistant from another runtime and govern access to it.
---

# Model external agents as resources

CUP treats an external assistant as a resource with an identity and a contract. This gives the application a way to decide who may discover or invoke that assistant without importing its framework.

## Resource definition

```ts
import { CapabilityUI, subject, type Resource } from '@capability-ui/core';

const cup = new CapabilityUI();
const user = subject('user:john', { role: 'owner', workspace: 'acme' });

const analystAgent: Resource = {
  id: 'agent.account-analyst',
  type: 'agent',
  version: '2026-01',
  sensitivity: 'confidential',
  owner: 'service:agent-platform',
  schema: {
    type: 'object',
    properties: {
      endpoint: { type: 'string' },
      tasks: { type: 'array', items: { type: 'string' } },
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
    },
    required: ['endpoint', 'tasks', 'inputSchema', 'outputSchema'],
  },
  metadata: {
    endpoint: 'https://agents.example.test/account-analyst',
    runtime: 'external',
    tasks: ['renewal-summary', 'ticket-clustering'],
  },
};

cup.register(analystAgent);
cup.policy.allow({
  id: 'owner-discover-analyst', principal: { id: user.id },
  operation: ['discover', 'inspect'], resource: { id: analystAgent.id }, priority: 10,
});
```

The agent resource says what the runtime offers. It does not grant the runtime access to customer data. Add separate policies for the agent subject and each data resource.

## Invocation contract

Represent starting a task as a capability with a handler owned by the integration layer:

```ts
import { CapabilityUI, defineCapability, subject } from '@capability-ui/core';

const cup = new CapabilityUI();
const user = subject('user:john', { role: 'owner' });

const runAccountAnalyst = defineCapability({
  id: 'agent.account-analyst.run', operation: 'execute', version: '1.0', sensitivity: 'confidential',
  schema: { type: 'object' },
  inputSchema: { type: 'object', required: ['task', 'accountIds'] },
  outputSchema: { type: 'object', required: ['taskId'] },
  sideEffects: ['Starts work in an external assistant runtime'], risk: 'medium',
  confirmation: 'explicit', idempotency: 'required', reversibility: 'partially_reversible',
  handler: async (input, context) => externalAgentRuntime.start(input, context),
});

cup.register(runAccountAnalyst);
cup.policy.allow({ id: 'owner-run-agent', principal: { id: user.id }, operation: 'execute', resource: { id: runAccountAnalyst.id }, priority: 10 });

const prepared = await cup.prepare({
  subject: user, capability: runAccountAnalyst.id,
  input: { task: 'renewal-summary', accountIds: ['acct-1'] },
  context: { purpose: 'renewal-review' }, purpose: 'renewal-review',
});
```

`externalAgentRuntime` is intentionally host code. It can call any vendor or custom system. CUP handles the boundary around the call.

## Agent identity on downstream calls

When the external runtime fetches records, it must call your adapter as the agent subject. A user-approved request can still be represented in context, but the acting identity remains the agent. This prevents a broad user permission from silently becoming a broad worker permission.
