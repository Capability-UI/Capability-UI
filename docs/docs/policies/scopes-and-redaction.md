---
id: scopes-and-redaction
title: Scopes and field redaction
sidebar_label: Scopes and redaction
description: Restrict reads to a workspace and remove fields from authorized responses.
---

# Scopes and field redaction

Scopes answer “which part of the resource does this permission cover?” A scope is a record of exact values such as a workspace, project, account, or region. CUP requires the request scope to contain every value required by the policy.

## Scope a read to a workspace

```ts
import { CapabilityUI, subject, type Resource } from '@capability-ui/core';

const cup = new CapabilityUI();
const analyst = subject('user:maya', { role: 'analyst' });
const notes: Resource = {
  id: 'workspace.notes', type: 'data', version: '1.0', sensitivity: 'confidential',
  schema: { type: 'array', items: { type: 'object' } },
  async read() { return [{ title: 'Roadmap', workspace: 'acme', private: 'salary plan' }]; },
};
cup.register(notes);
cup.policy.allow({
  id: 'acme-notes', principal: { id: analyst.id }, operation: 'read',
  resource: { id: notes.id }, scope: { workspace: 'acme' }, priority: 10,
});

const result = await cup.read({
  subject: analyst, resource: notes.id, scope: { workspace: 'acme' },
  context: { workspace: 'acme', purpose: 'roadmap-review' },
});
console.log(result.items);
```

A request with `{ workspace: 'other' }` or no scope fails before the adapter result is returned.

## Redact fields with an obligation

```ts
cup.policy.allow({
  id: 'analyst-no-private-notes',
  principal: { id: analyst.id },
  operation: 'read',
  resource: { id: notes.id },
  scope: { workspace: 'acme' },
  obligations: [{ type: 'redact', fields: ['private'] }],
  priority: 10,
});
```

CUP applies the obligation recursively, including nested paths such as `customer.billing.contact` and values inside arrays. The result does not contain the removed fields, while the adapter can still return its normal domain object.

## Select fields at the adapter boundary

Pass a field list to the adapter so the data service can avoid fetching unnecessary columns:

```ts
const result = await cup.read({
  subject: analyst,
  resource: 'workspace.notes',
  fields: ['title', 'workspace'],
  scope: { workspace: 'acme' },
  context: { workspace: 'acme', purpose: 'roadmap-review' },
});
```

Field selection is a performance and minimization control. The policy obligation remains a second output control. Use both for sensitive data.

## Scope rules for delegation

A delegated grant can never widen the parent request. Give the worker the smallest workspace, record set, field set, and time window needed for the job. See [Delegation](./delegation) for the complete flow.
