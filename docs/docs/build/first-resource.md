---
id: first-resource
title: Register your first resource
sidebar_label: First resource
description: Define a typed data resource and authorize discovery and reads.
---

# Register your first resource

A data resource describes what can be read. Its `read` function is the adapter boundary between CUP and your application service.

```ts
import { CapabilityUI, subject, type Resource } from '@capability-ui/core';

const cup = new CapabilityUI();
const analyst = subject('user:maya', { role: 'analyst', workspace: 'acme' });

const tickets: Resource = {
  id: 'support.tickets',
  type: 'data',
  version: '2025-01',
  sensitivity: 'confidential',
  owner: 'service:support',
  schema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        subject: { type: 'string' },
        status: { type: 'string' },
        internalNotes: { type: 'string' },
      },
    },
  },
  async read({ query, fields, scope }) {
    // Replace this array with a parameterized database query.
    const rows = [
      { id: 'ticket-1', subject: 'Renewal question', status: 'open', internalNotes: 'Escalated' },
      { id: 'ticket-2', subject: 'Invoice copy', status: 'closed', internalNotes: 'Private billing note' },
    ];
    return rows.filter(row => !query?.status || row.status === query.status).map(row => {
      if (!fields?.length) return row;
      return Object.fromEntries(fields.filter(field => field in row).map(field => [field, row[field as keyof typeof row]]));
    });
  },
};

cup.register(tickets);
```

## Allow discovery and reads separately

```ts
cup.policy.allow({
  id: 'analyst-discover-tickets',
  principal: { id: analyst.id },
  operation: 'discover',
  resource: { id: tickets.id },
  scope: { workspace: 'acme' },
  priority: 10,
});

cup.policy.allow({
  id: 'analyst-read-ticket-summary',
  principal: { id: analyst.id },
  operation: 'read',
  resource: { id: tickets.id },
  scope: { workspace: 'acme' },
  obligations: [{ type: 'redact', fields: ['internalNotes'] }],
  priority: 10,
});

const available = await cup.discover({
  subject: analyst,
  purpose: 'support-review',
  context: { workspace: 'acme', purpose: 'support-review' },
});

const result = await cup.read({
  subject: analyst,
  resource: tickets.id,
  query: { status: 'open' },
  fields: ['id', 'subject', 'status', 'internalNotes'],
  scope: { workspace: 'acme' },
  purpose: 'support-review',
  context: { workspace: 'acme', purpose: 'support-review' },
});

console.log(available.map(item => item.ref.id));
console.log(result.items); // internalNotes is removed by the obligation
console.log(result.receiptId);
```

The adapter receives the query and field request, but the policy decision controls whether CUP returns the result. A production adapter should enforce tenant filtering in the query itself as well.
