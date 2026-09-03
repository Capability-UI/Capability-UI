---
id: mental-model
title: The CUP mental model
sidebar_label: Mental model
description: Understand the objects and decisions that make up CUP.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# The CUP mental model

CUP separates five concerns that applications often mix together.

| Concern | CUP object | Question it answers |
| --- | --- | --- |
| Identity | `Subject` | Who is making this request? |
| Thing being accessed | `Resource` | What data, service, agent, workflow, or view exists? |
| Action | `Capability` | What operation can change state or cause an outside effect? |
| Rule | `Policy` | May this subject perform this operation on this resource now? |
| Evidence | `Receipt` | What did the application decide and what happened? |

A resource can represent a database-backed collection, a single service, a workflow, a generated view, or an external assistant. A capability is a resource with a typed input and output contract plus side-effect metadata and a handler. CUP does not assume how the handler reaches a database or another service.

## Subjects

A subject is a user, agent, service, or group. The `authenticated` flag must come from your authentication layer. The helper is convenient for examples, but production code should construct the subject from a verified session or token.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
import { subject, type Subject } from '@capability-ui/core';

const signedInUser: Subject = subject(
  'user:john',
  { role: 'owner', workspace: 'acme' },
  true,
);

const researchAssistant: Subject = subject(
  'agent:research-assistant',
  { role: 'researcher', workspace: 'acme' },
  true,
);
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": { "subjectId": "user:john" }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": { "subjectId": "agent:research-assistant" }
}
```

The host maps the transport credential to `subjectId`. CUP never infers identity from the tool name.

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:john tools list
cup --host ./dist/setup.js --subject agent:research-assistant tools list
```

</TabItem>
</Tabs>

CUP evaluates the assistant as the actor when it makes a downstream call. Passing the human identity through every assistant action would erase the boundary that policies need to control.

## Operations are intentionally separate

`discover` means the subject may know that a resource exists. `inspect` means the subject may see its schema or metadata. `read` means the subject may receive data. `execute` means the subject may invoke a capability. `delegate` means the subject may issue a bounded grant. Keeping these operations separate lets an application expose a useful catalog without exposing records or actions.

## Views are projections, not enforcement

`project()` produces an `AuthorizedView` that a renderer or external assistant can use. It is a convenience and a least-privilege boundary, not the final security boundary. A caller can ignore the view and send a direct request to `execute()`. The execution path must still authorize the exact request.

## Policy decisions are data

A `Decision` includes the request ID, effect, reason code, matched policies, obligations, and policy version. Treat it as an audit-friendly value. A UI can use obligations to decide whether to show a preview or confirmation. A server must still enforce the decision itself.

## Receipts close the loop

A receipt connects the request to the outcome. For a successful action it contains the actor, capability, canonical input hash, policy decision, and result summary. For a denied request it explains the denial. For a handler error it records `failed` while preserving the authorization decision that allowed the call.

## What CUP does not infer

CUP does not infer identity from a string, trust a hidden UI control, grant access because an agent discovered a tool, or treat a role as a complete permission model. Your host supplies authentication, resource data, durable storage, and operational controls.
