---
id: authorization
title: Authorization and policy evaluation
sidebar_label: Authorization
description: Write explicit CUP policies and understand deterministic decisions.
---

# Authorization and policy evaluation

CUP uses explicit policies and fails closed. A policy matches a subject, operation, resource, optional scope, optional conditions, and an unexpired window. The resulting decision tells you whether the request is allowed and which obligations apply.

## Add an allow policy

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

The `effect` is supplied by `allow()` or `deny()`. Callers cannot accidentally turn an allow call into a deny policy by passing an `effect` field.

## Principal selectors

CUP supports four selectors:

```ts
cup.policy.allow({ id: 'by-id', principal: { id: 'user:maya' }, operation: 'read', resource: { id: 'r' }, priority: 10 });
cup.policy.allow({ id: 'by-role', principal: { role: 'analyst' }, operation: 'read', resource: { id: 'r' }, priority: 10 });
cup.policy.allow({ id: 'by-type', principal: { type: 'agent' }, operation: 'execute', resource: { id: 'tool' }, priority: 10 });
cup.policy.allow({ id: 'any-subject', principal: { any: true }, operation: 'discover', resource: { id: 'r' }, priority: 1 });
```

Use an ID for sensitive actions. A role or type selector is broader and should usually be paired with scope, purpose, conditions, and a high-priority deny rule.

## Operations and resources

A policy can target one operation or an array of operations. Keep policies narrow when the operations have different risks. A read policy should not also allow execute. A policy for an agent resource should not automatically allow the agent to read the records it may process.

## Decision precedence

CUP first finds matching, unexpired policies. It takes the highest priority among those matches. If any policy at that priority denies, the result is denied. Otherwise, an allow at that priority succeeds. Lower-priority rules do not override the highest-priority decision.

```ts
cup.policy.allow({ id: 'team-read', principal: { role: 'analyst' }, operation: 'read', resource: { id: 'reports.monthly' }, priority: 10 });
cup.policy.deny({ id: 'restricted-user', principal: { id: 'user:maya' }, operation: 'read', resource: { id: 'reports.monthly' }, priority: 20 });

// Maya is denied because the higher-priority deny wins.
```

## Conditions

Use the helpers for common checks. A condition receives the complete authorization request, including the proposed input for action calls.

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

Write custom conditions when the rule needs domain data. Keep them deterministic and side-effect free. A condition should not make a network call or change a database row.

## Inspect the reason

Use `reasonCode` to give a useful client response without exposing internal policy details. Common values include `ALLOWED`, `NO_MATCHING_ALLOW`, `EXPLICIT_DENY`, `SUBJECT_NOT_AUTHENTICATED`, `CONFIRMATION_REQUIRED`, `INVALID_INPUT`, and `PREPARED_DECISION_STALE`.
