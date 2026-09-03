---
id: runtime-adapters
title: Build runtime adapters
sidebar_label: Runtime adapters
description: Connect databases, services, and agent frameworks to CUP without duplicating policy.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Build runtime adapters

Adapters translate CUP contracts into calls to systems that already exist. Keep the adapter thin. It should pass verified identity, scope, purpose, and request IDs to the host service, then return a typed result.

## Resource adapter

```ts
import { CapabilityUI, subject, type ResourceAdapter } from '@capability-ui/core';

const cup = new CapabilityUI();
const user = subject('user:maya', { role: 'analyst', workspace: 'acme' });

cup.register({
  id: 'crm.accounts', type: 'data', version: '1.0', sensitivity: 'confidential',
  schema: { type: 'array', items: { type: 'object' } },
});

const accounts: ResourceAdapter = {
  resourceId: 'crm.accounts',
  async read(request) {
    // Enforce tenant filtering in the host query as well as in CUP.
    return crm.listAccounts({
      workspace: request.scope?.workspace,
      query: request.query,
      fields: request.fields,
      actorId: request.subject.id,
    });
  },
};
cup.registerAdapter(accounts);
```

After the adapter is registered, clients read through CUP, MCP, or the CLI:

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
await cup.read({
  subject: user,
  resource: 'crm.accounts',
  scope: { workspace: 'acme' },
  context: { workspace: 'acme', purpose: 'renewal-review' },
});
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/read",
  "params": {
    "subjectId": "user:maya",
    "uri": "cup://crm.accounts",
    "context": { "workspace": "acme", "purpose": "renewal-review" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:maya \
  --purpose renewal-review --context '{"workspace":"acme"}' \
  resources read cup://crm.accounts
```

</TabItem>
</Tabs>

## Execution adapter

```ts
import { type ExecutionAdapter } from '@capability-ui/core';

const sendEmailAdapter: ExecutionAdapter = {
  capabilityId: 'mail.send',
  async invoke(input, context) {
    // Pass the CUP request ID and idempotency key to the provider.
    return mailProvider.send({
      message: input,
      auditRequestId: context.requestId,
      idempotencyKey: context.idempotencyKey,
    });
  },
};

cup.registerAdapter(sendEmailAdapter);
```

The adapter does not decide whether the call is allowed. CUP has already checked policy. The provider should still enforce its own ownership and input constraints.

## Agent-framework adapter

An adapter around an external runtime usually maps three events:

```ts
async function runWithCUP(runtimeTask: RuntimeTask, human: Subject) {
  const agent = subject(`agent:${runtimeTask.agentId}`, { role: runtimeTask.role }, true);
  const view = await cup.project({ subject: agent, goal: runtimeTask.goal, context: runtimeTask.context });
  const runtimeRequest = await runtime.plan({ goal: runtimeTask.goal, tools: view.capabilities });

  for (const step of runtimeRequest.steps) {
    if (step.kind === 'read') {
      yield await cup.read({ ...step, subject: agent, context: runtimeTask.context });
    } else {
      const prepared = await cup.prepare({ ...step, subject: agent, context: runtimeTask.context });
      // A host approval service decides whether an explicit confirmation exists.
      yield await cup.execute({ ...prepared.request, subject: agent, context: runtimeTask.context });
    }
  }
}
```

The runtime plans. CUP supplies the authorized tool view and enforces every read or action. Do not make the runtime’s prompt the source of truth for access.

## Adapter failure behavior

Let adapter errors propagate to `execute()`. CUP records a `failed` receipt with `HANDLER_FAILED`; it does not convert a provider failure into a successful result. Add timeouts, retries, circuit breakers, and provider-specific error mapping in the host adapter.
