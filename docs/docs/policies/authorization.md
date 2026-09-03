---
id: authorization
title: Authorization and policy evaluation
sidebar_label: Authorization
description: Write explicit CUP policies and understand deterministic decisions.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Authorization and policy evaluation

CUP uses explicit policies and fails closed. A policy matches a subject, operation, resource, optional scope, optional conditions, and an unexpired window. The resulting decision tells you whether the request is allowed and which obligations apply.

## Add an allow policy

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
import { CapabilityUI, subject } from '@capability-ui/core';

const cup = new CapabilityUI();
const user = subject('user:maya', { role: 'analyst', workspace: 'acme' });

cup.policy.allow({
  id: 'maya-read-reports',
  principal: { id: user.id },
  operation: 'read',
  resource: { id: 'reports.monthly' },
  scope: { workspace: 'acme' },
  priority: 20,
});

const decision = await cup.authorize({
  subject: user,
  operation: 'read',
  resource: { id: 'reports.monthly' },
  scope: { workspace: 'acme' },
  purpose: 'monthly-review',
  context: { workspace: 'acme', purpose: 'monthly-review' },
});

console.log(decision);
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
      "id": "maya-read-reports",
      "principalId": "user:maya",
      "operation": "read",
      "resourceId": "reports.monthly",
      "priority": 20,
      "scope": { "workspace": "acme" }
    },
    "confirmation": { "confirmedBy": "user:admin" }
  }
}
```

Checking the decision is the read itself:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": {
    "subjectId": "user:maya",
    "uri": "cup://reports.monthly",
    "context": { "workspace": "acme", "purpose": "monthly-review" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.allowPolicy \
  --args '{"id":"maya-read-reports","principalId":"user:maya","operation":"read","resourceId":"reports.monthly","priority":20,"scope":{"workspace":"acme"}}' \
  --confirm

cup --host ./dist/setup.js --subject user:maya \
  --purpose monthly-review --context '{"workspace":"acme"}' \
  resources read cup://reports.monthly
```

</TabItem>
</Tabs>

The `effect` is supplied by `allow()` or `deny()`. Callers cannot accidentally turn an allow call into a deny policy by passing an `effect` field.

## Principal selectors

CUP supports four selectors:

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
cup.policy.allow({ id: 'by-id', principal: { id: 'user:maya' }, operation: 'read', resource: { id: 'r' }, priority: 10 });
cup.policy.allow({ id: 'by-role', principal: { role: 'analyst' }, operation: 'read', resource: { id: 'r' }, priority: 10 });
cup.policy.allow({ id: 'by-type', principal: { type: 'agent' }, operation: 'execute', resource: { id: 'tool' }, priority: 10 });
cup.policy.allow({ id: 'any-subject', principal: { any: true }, operation: 'discover', resource: { id: 'r' }, priority: 1 });
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
      "id": "by-id",
      "principalId": "user:maya",
      "operation": "read",
      "resourceId": "r",
      "priority": 10
    },
    "confirmation": { "confirmedBy": "user:admin" }
  }
}
```

Role, type, and `any` selectors are host policy fields. Expose them on `workspace.allowPolicy` if operators should set them through MCP.

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.allowPolicy \
  --args '{"id":"by-id","principalId":"user:maya","operation":"read","resourceId":"r","priority":10}' \
  --confirm
```

</TabItem>
</Tabs>

Use an ID for sensitive actions. A role or type selector is broader and should usually be paired with scope, purpose, conditions, and a high-priority deny rule.

## Operations and resources

A policy can target one operation or an array of operations. Keep policies narrow when the operations have different risks. A read policy should not also allow execute. A policy for an agent resource should not automatically allow the agent to read the records it may process.

## Decision precedence

CUP first finds matching, unexpired policies. It takes the highest priority among those matches. If any policy at that priority denies, the result is denied. Otherwise, an allow at that priority succeeds. Lower-priority rules do not override the highest-priority decision.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
cup.policy.allow({ id: 'team-read', principal: { role: 'analyst' }, operation: 'read', resource: { id: 'reports.monthly' }, priority: 10 });
cup.policy.deny({ id: 'restricted-user', principal: { id: 'user:maya' }, operation: 'read', resource: { id: 'reports.monthly' }, priority: 20 });
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
    "name": "workspace.denyPolicy",
    "arguments": {
      "id": "restricted-user",
      "principalId": "user:maya",
      "operation": "read",
      "resourceId": "reports.monthly",
      "priority": 20
    },
    "confirmation": { "confirmedBy": "user:admin" }
  }
}
```

Maya's next `resources/read` returns `CUP_NOT_AUTHORIZED:EXPLICIT_DENY`.

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.denyPolicy \
  --args '{"id":"restricted-user","principalId":"user:maya","operation":"read","resourceId":"reports.monthly","priority":20}' \
  --confirm

cup --host ./dist/setup.js --subject user:maya \
  resources read cup://reports.monthly
```

</TabItem>
</Tabs>

## Conditions

Use the helpers for common checks. A condition receives the complete authorization request, including the proposed input for action calls.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
import { conditions } from '@capability-ui/core';

cup.policy.allow({
  id: 'small-campaign-only',
  principal: { role: 'marketing' },
  operation: 'execute',
  resource: { id: 'mail.send' },
  conditions: [
    conditions.purposeIs('customer-follow-up'),
    conditions.recipientCountAtMost(10),
  ],
  priority: 30,
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
    "subjectId": "user:marketing",
    "name": "mail.send",
    "arguments": { "recipients": ["a@example.com"], "body": "Hello" },
    "context": { "purpose": "customer-follow-up" }
  }
}
```

A different purpose or too many recipients is `NO_MATCHING_ALLOW` on the same tool name.

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:marketing \
  --purpose customer-follow-up \
  tools call mail.send \
  --args '{"recipients":["a@example.com"],"body":"Hello"}' \
  --confirm
```

</TabItem>
</Tabs>

Write custom conditions when the rule needs domain data. Keep them deterministic and side-effect free. A condition should not make a network call or change a database row.

## Inspect the reason

Use `reasonCode` to give a useful client response without exposing internal policy details. Common values include `ALLOWED`, `NO_MATCHING_ALLOW`, `EXPLICIT_DENY`, `SUBJECT_NOT_AUTHENTICATED`, `CONFIRMATION_REQUIRED`, `INVALID_INPUT`, and `PREPARED_DECISION_STALE`.
