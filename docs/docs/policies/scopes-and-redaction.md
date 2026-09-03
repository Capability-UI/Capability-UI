---
id: scopes-and-redaction
title: Scopes and field redaction
sidebar_label: Scopes and redaction
description: Restrict reads to a workspace and remove fields from authorized responses.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Scopes and field redaction

Scopes answer “which part of the resource does this permission cover?” A scope is a record of exact values such as a workspace, project, account, or region. CUP requires the request scope to contain every value required by the policy.

## Scope a read to a workspace

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

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

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/read",
  "params": {
    "subjectId": "user:maya",
    "uri": "cup://workspace.notes",
    "context": { "workspace": "acme", "purpose": "roadmap-review" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:maya \
  --purpose roadmap-review --context '{"workspace":"acme"}' \
  resources read cup://workspace.notes
```

</TabItem>
</Tabs>

A request with `{ workspace: 'other' }` or no scope fails before the adapter result is returned.

## Redact fields with an obligation

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

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
      "id": "analyst-no-private-notes",
      "principalId": "user:maya",
      "operation": "read",
      "resourceId": "workspace.notes",
      "priority": 10,
      "scope": { "workspace": "acme" },
      "redactFields": ["private"]
    },
    "confirmation": { "confirmedBy": "user:admin" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.allowPolicy \
  --args '{"id":"analyst-no-private-notes","principalId":"user:maya","operation":"read","resourceId":"workspace.notes","priority":10,"scope":{"workspace":"acme"},"redactFields":["private"]}' \
  --confirm
```

</TabItem>
</Tabs>

CUP applies the obligation recursively, including nested paths such as `customer.billing.contact` and values inside arrays. The result does not contain the removed fields, while the adapter can still return its normal domain object.

## Select fields at the adapter boundary

Pass a field list to the adapter so the data service can avoid fetching unnecessary columns:

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
const result = await cup.read({
  subject: analyst,
  resource: 'workspace.notes',
  fields: ['title', 'workspace'],
  scope: { workspace: 'acme' },
  context: { workspace: 'acme', purpose: 'roadmap-review' },
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
    "uri": "cup://workspace.notes",
    "context": {
      "workspace": "acme",
      "purpose": "roadmap-review",
      "fields": ["title", "workspace"]
    }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:maya \
  --purpose roadmap-review \
  --context '{"workspace":"acme","fields":["title","workspace"]}' \
  resources read cup://workspace.notes
```

</TabItem>
</Tabs>

Field selection is a performance and minimization control. The policy obligation remains a second output control. Use both for sensitive data.

## Scope rules for delegation

A delegated grant can never widen the parent request. Give the worker the smallest workspace, record set, field set, and time window needed for the job. See [Delegation](./delegation) for the complete flow.
