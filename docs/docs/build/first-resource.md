---
id: first-resource
title: Register your first resource
sidebar_label: First resource
description: Define a typed data resource and authorize discovery and reads.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Register your first resource

A data resource describes what can be read. Its `read` function is the adapter boundary between CUP and your application service. Registering the handler is host code. Discovering and reading it is the same operation over CUP, MCP, or the CLI.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

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

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
    "name": "workspace.addResource",
    "arguments": {
      "resourceId": "support.tickets",
      "name": "Support tickets",
      "sensitivity": "confidential"
    },
    "confirmation": { "confirmedBy": "user:admin" },
    "idempotencyKey": "add-support-tickets-v1"
  }
}
```

After the resource exists, clients never call `register()`. They list and read:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/list",
  "params": {
    "subjectId": "user:maya",
    "context": { "workspace": "acme", "purpose": "support-review" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.addResource \
  --args '{"resourceId":"support.tickets","name":"Support tickets","sensitivity":"confidential"}' \
  --confirm --idempotency-key add-support-tickets-v1

cup --host ./dist/setup.js --subject user:maya \
  --context '{"workspace":"acme"}' --purpose support-review \
  resources list
```

</TabItem>
</Tabs>

The MCP and CLI tabs assume Stage 1 exposed `workspace.addResource`. The handler still lives in host code.

## Allow discovery and reads separately

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

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

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
    "name": "workspace.allowPolicy",
    "arguments": {
      "id": "analyst-read-ticket-summary",
      "principalId": "user:maya",
      "operation": "read",
      "resourceId": "support.tickets",
      "priority": 10,
      "scope": { "workspace": "acme" },
      "redactFields": ["internalNotes"]
    },
    "confirmation": { "confirmedBy": "user:admin" }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": {
    "subjectId": "user:maya",
    "uri": "cup://support.tickets",
    "context": { "workspace": "acme", "purpose": "support-review", "query": { "status": "open" } }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.allowPolicy \
  --args '{"id":"analyst-read-ticket-summary","principalId":"user:maya","operation":"read","resourceId":"support.tickets","priority":10,"scope":{"workspace":"acme"},"redactFields":["internalNotes"]}' \
  --confirm

cup --host ./dist/setup.js --subject user:maya \
  --context '{"workspace":"acme","query":{"status":"open"}}' \
  --purpose support-review \
  resources read cup://support.tickets
```

</TabItem>
</Tabs>

The adapter receives the query and field request, but the policy decision controls whether CUP returns the result. A production adapter should enforce tenant filtering in the query itself as well.
