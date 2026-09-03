---
id: conditions-and-expiration
title: Conditions, expiration, and obligations
sidebar_label: Conditions and expiry
description: Add purpose checks, time limits, and runtime obligations to policies.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Conditions, expiration, and obligations

Policies can express more than a role. They can limit why a request is made, when a rule stops applying, and what the client or executor must do after a match.

## Purpose-bound access

Use `purpose` on the authorization request and a condition on the policy:

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
import { CapabilityUI, conditions, subject } from '@capability-ui/core';

const cup = new CapabilityUI();
const support = subject('user:lee', { role: 'support' });
cup.policy.allow({
  id: 'support-case-review', principal: { id: support.id }, operation: 'read',
  resource: { id: 'crm.customer' },
  conditions: [conditions.purposeIs('case-review')], priority: 10,
});

const decision = await cup.authorize({
  subject: support, operation: 'read', resource: { id: 'crm.customer' },
  purpose: 'case-review', context: { purpose: 'case-review' },
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
    "subjectId": "user:lee",
    "uri": "cup://crm.customer",
    "context": { "purpose": "case-review" }
  }
}
```

A different purpose is denied.

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:lee \
  --purpose case-review resources read cup://crm.customer
```

</TabItem>
</Tabs>

A request for a different purpose receives `NO_MATCHING_ALLOW`.

## Expire a policy

```ts
cup.policy.allow({
  id: 'incident-access', principal: { id: support.id }, operation: 'read',
  resource: { id: 'incident.logs' },
  expiresAt: '2026-12-31T23:59:59.000Z', priority: 50,
});
```

CUP compares `expiresAt` to `context.now` when provided, which makes time-dependent tests deterministic:

```ts
const decision = await cup.authorize({
  subject: support, operation: 'read', resource: { id: 'incident.logs' },
  context: { now: new Date('2027-01-01T00:00:00Z') },
});
```

## Obligations

A matched policy can return obligations:

```ts
obligations: [
  { type: 'redact', fields: ['internalNotes'] },
  { type: 'write_receipt' },
  { type: 'preview_changes' },
  { type: 'require_confirmation', mode: 'explicit' },
  { type: 'human_review' },
]
```

The reference runtime applies redaction and confirmation behavior. The other obligation types are returned for the host renderer or workflow system to enforce. Treat an obligation as a requirement, not as a hint.

## Custom conditions

```ts
const duringBusinessHours = request => {
  const hour = (request.context.now ?? new Date()).getUTCHours();
  return hour >= 8 && hour < 18;
};

cup.policy.allow({
  id: 'business-hours-export', principal: { role: 'analyst' }, operation: 'execute',
  resource: { id: 'reports.export' }, conditions: [duringBusinessHours], priority: 10,
});
```

Keep conditions pure and fast. If a rule needs a database lookup, fetch the relevant fact in the host and place it in `context` before calling CUP.
