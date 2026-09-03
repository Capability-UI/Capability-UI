---
id: read-data
title: Read data safely
sidebar_label: Read data
description: Use discovery, scopes, fields, redaction, and receipts for data reads.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Read data safely

A data read has four distinct inputs: the resource, the subject, the requested scope, and the query or field selection. Keep them explicit so a policy can make a precise decision.

## Use a resource adapter

Adapters keep database and service code outside CUP. Register the resource first, then attach the adapter. The adapter is host-only. The read is the same over CUP, MCP, or the CLI.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
import { CapabilityUI, subject, type ResourceAdapter } from '@capability-ui/core';

const cup = new CapabilityUI();
const analyst = subject('user:maya', { role: 'analyst', workspace: 'acme' });

cup.register({
  id: 'crm.accounts', type: 'data', version: '1.0', sensitivity: 'confidential',
  schema: { type: 'array', items: { type: 'object' } },
});

const crmAdapter: ResourceAdapter = {
  resourceId: 'crm.accounts',
  async read({ query, fields, scope }) {
    const workspace = String(scope?.workspace ?? '');
    const accounts = await loadAccounts({ workspace, query, fields });
    return accounts;
  },
};

cup.registerAdapter(crmAdapter);
cup.policy.allow({
  id: 'analyst-read-accounts', principal: { id: analyst.id }, operation: 'read',
  resource: { id: 'crm.accounts' }, scope: { workspace: 'acme' }, priority: 10,
});

const result = await cup.read({
  subject: analyst,
  resource: 'crm.accounts',
  query: { status: 'renewal' },
  fields: ['id', 'name', 'renewalDate'],
  scope: { workspace: 'acme' },
  purpose: 'renewal-review',
  context: { workspace: 'acme', purpose: 'renewal-review' },
});

console.log(result.items, result.receiptId);

async function loadAccounts(input: unknown): Promise<unknown[]> {
  console.log('host data service received', input);
  return [{ id: 'acct-1', name: 'Acme', renewalDate: '2026-11-01' }];
}
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
    "context": {
      "workspace": "acme",
      "purpose": "renewal-review",
      "query": { "status": "renewal" },
      "fields": ["id", "name", "renewalDate"]
    }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:maya \
  --purpose renewal-review \
  --context '{"workspace":"acme","query":{"status":"renewal"},"fields":["id","name","renewalDate"]}' \
  resources read cup://crm.accounts
```

</TabItem>
</Tabs>

## Scope matching

A policy scope is a set of exact required values. If the policy requires `{ workspace: 'acme' }`, a read without that scope is denied. The application should pass the same tenant, project, and purpose context to every adapter.

## Field selection and redaction

Field selection reduces the data returned by the adapter. Redaction obligations remove fields after the adapter returns. Use both. Field selection limits what the data service fetches. Redaction protects against an adapter or client returning more than the policy allows.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
cup.policy.allow({
  id: 'analyst-read-public-account-fields',
  principal: { id: analyst.id },
  operation: 'read',
  resource: { id: 'crm.accounts' },
  scope: { workspace: 'acme' },
  obligations: [{ type: 'redact', fields: ['billing.contact', 'internalScore'] }],
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
      "id": "analyst-read-public-account-fields",
      "principalId": "user:maya",
      "operation": "read",
      "resourceId": "crm.accounts",
      "priority": 10,
      "scope": { "workspace": "acme" },
      "redactFields": ["billing.contact", "internalScore"]
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
  --args '{"id":"analyst-read-public-account-fields","principalId":"user:maya","operation":"read","resourceId":"crm.accounts","priority":10,"scope":{"workspace":"acme"},"redactFields":["billing.contact","internalScore"]}' \
  --confirm
```

</TabItem>
</Tabs>

Nested paths and arrays are handled recursively by the reference implementation. Your adapter should still avoid fetching restricted columns when possible.

## Receipts for reads

CUP records a succeeded receipt containing the read input hash and decision. Do not place raw secrets or unnecessarily sensitive result data in `resultSummary` when implementing a durable sink. The default in-memory sink is for development and tests.

## Pagination

CUP passes query values through to the adapter. Define a stable pagination contract in your resource schema, for example `limit`, `cursor`, and `nextCursor`. Put a maximum limit in the adapter. An authorized read must not become an unbounded database query.
