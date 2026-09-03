---
id: subscriptions
title: Subscriptions and revocation
sidebar_label: Subscriptions
description: Subscribe to resource events and close subscriptions safely.
---

# Subscriptions and revocation

Subscriptions let a client receive changes for a resource after CUP authorizes a read subscription. The reference implementation provides an in-process event interface. A transport host can forward those events to WebSocket, SSE, native, or MCP subscribers.

## Subscribe

```ts
import { CapabilityUI, subject, type ResourceEvent } from '@capability-ui/core';

const cup = new CapabilityUI();
const user = subject('user:maya', { role: 'analyst', workspace: 'acme' });
const resource = { id: 'crm.accounts', type: 'data' as const, version: '1.0', sensitivity: 'confidential' as const, schema: { type: 'array' } };
cup.register(resource);
cup.policy.allow({ id: 'read-accounts', principal: { id: user.id }, operation: 'read', resource: { id: resource.id }, priority: 10 });

const subscription = await cup.subscribe({
  subject: user,
  resource: resource.id,
  events: ['updated', 'deleted', 'access_removed'],
  context: { workspace: 'acme', purpose: 'live-dashboard' },
});

subscription.on('event', (event: ResourceEvent) => {
  console.log(event.type, event.data);
});
subscription.on('access_removed', event => {
  console.log('Stop rendering this resource', event.resource.id);
  subscription.close();
});

cup.publish({ resource: { id: resource.id }, type: 'updated', data: { id: 'acct-1' } });
```

The subscription is authorized when it is created. The host must still publish `access_removed` when current authorization changes or a delegation expires. A long-lived transport should periodically re-check access if its threat model requires it.

## Always close subscriptions

`close()` removes the callbacks and deletes the resource listener set when it becomes empty. Call it when the view unmounts, the session ends, or access is removed.

## Do not treat events as authorization

An event payload can contain data. Apply the same minimization and redaction rules to event payloads that you apply to reads. If a source publishes a broad event, send only a resource ID and make the client perform an authorized read.
