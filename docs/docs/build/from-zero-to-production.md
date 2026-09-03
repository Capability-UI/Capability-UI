---
id: from-zero-to-production
title: From zero to production
sidebar_label: From zero to production
description: Build a CUP-governed system from one owner and one resource, either by calling the library directly or by growing the system through MCP conversations.
---

# From zero to production

A CUP system starts closed. The first useful state is one verified owner, one resource, and every operation allowed for that owner. From there the system grows because principals take actions, not because an engineer keeps editing policy files.

This page has two paths after the same Stage 1 bootstrap:

| Path | Who is writing code | What later stages look like |
|---|---|---|
| [Path A: Host library](#path-a-grow-the-system-with-the-host-library) | Your application | TypeScript calls to `cup.policy`, `cup.delegate`, `cup.execute` |
| [Path B: MCP conversations](#path-b-grow-the-system-through-mcp) | An external agent connected as a principal | User messages, MCP tool calls, and tool responses |

Path B is the production shape most teams should study first. After Stage 1, people and agents should not import `@capability-ui/core`. They should ask, discover, and act through MCP. CUP stays behind the server and decides allow or deny.

---

## Stage 1: One user, one resource, full authority

The host writes this once. It creates Alice, registers the workspace registry, gives Alice every operation on it, and exposes the meta-capabilities an owner needs so later growth can happen through MCP.

```ts
// setup.ts
import {
  createMCPServer,
  defineCapability,
  denyByDefault,
  subject,
  type Resource,
} from '@capability-ui/core';

const cup = denyByDefault();

const alice = subject('user:alice', {
  role: 'owner',
  workspaceId: 'acme',
});

const workspace: Resource = {
  id: 'workspace.registry',
  type: 'data',
  version: '1.0',
  sensitivity: 'confidential',
  owner: alice.id,
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      owner: { type: 'string' },
    },
  },
  read: async () => [
    { id: 'workspace.registry', name: 'Acme Workspace', owner: alice.id },
  ],
};
cup.register(workspace);

for (const operation of [
  'discover', 'inspect', 'read', 'create', 'update',
  'delete', 'execute', 'share', 'delegate',
] as const) {
  cup.policy.allow({
    id: `alice-${operation}-registry`,
    principal: { id: alice.id },
    operation,
    resource: { id: workspace.id },
    priority: 100,
  });
}

function registerOwnerCapability(
  config: Parameters<typeof defineCapability>[0],
) {
  const capability = defineCapability(config);
  cup.register(capability);
  cup.policy.allow({
    id: `alice-execute-${capability.id}`,
    principal: { id: alice.id },
    operation: 'execute',
    resource: { id: capability.id },
    priority: 100,
  });
  cup.policy.allow({
    id: `alice-delegate-${capability.id}`,
    principal: { id: alice.id },
    operation: 'delegate',
    resource: { id: capability.id },
    priority: 100,
  });
  return capability;
}

registerOwnerCapability({
  id: 'workspace.addResource',
  operation: 'create',
  version: '1.0',
  sensitivity: 'confidential',
  schema: { type: 'object' },
  inputSchema: {
    type: 'object',
    required: ['resourceId', 'name', 'sensitivity'],
    properties: {
      resourceId: { type: 'string' },
      name: { type: 'string' },
      sensitivity: { type: 'string' },
    },
  },
  outputSchema: { type: 'object' },
  sideEffects: ['Registers a new CUP resource'],
  risk: 'medium',
  confirmation: 'explicit',
  idempotency: 'supported',
  reversibility: 'reversible',
  handler: async (input) => {
    // Host writes the row and calls cup.register() with a real adapter.
    return { created: true, ...(input as object) };
  },
});

registerOwnerCapability({
  id: 'workspace.addPrincipal',
  operation: 'create',
  version: '1.0',
  sensitivity: 'confidential',
  schema: { type: 'object' },
  inputSchema: {
    type: 'object',
    required: ['principalId', 'role'],
    properties: {
      principalId: { type: 'string' },
      role: { type: 'string', enum: ['owner', 'member', 'readonly'] },
    },
  },
  outputSchema: { type: 'object' },
  sideEffects: ['Creates a principal record'],
  risk: 'high',
  confirmation: 'explicit',
  idempotency: 'required',
  reversibility: 'reversible',
  handler: async (input) => ({ created: true, ...(input as object) }),
});

registerOwnerCapability({
  id: 'workspace.allowPolicy',
  operation: 'create',
  version: '1.0',
  sensitivity: 'restricted',
  schema: { type: 'object' },
  inputSchema: {
    type: 'object',
    required: ['id', 'principalId', 'operation', 'resourceId', 'priority'],
    properties: {
      id: { type: 'string' },
      principalId: { type: 'string' },
      operation: { type: 'string' },
      resourceId: { type: 'string' },
      priority: { type: 'integer' },
      scope: { type: 'object' },
      expiresAt: { type: 'string' },
      redactFields: { type: 'array', items: { type: 'string' } },
    },
  },
  outputSchema: { type: 'object' },
  sideEffects: ['Adds an allow policy'],
  risk: 'critical',
  confirmation: 'explicit',
  idempotency: 'required',
  reversibility: 'reversible',
  handler: async (input) => {
    // Host maps this input onto cup.policy.allow(...) or a SQL insert.
    return { allowed: true, ...(input as object) };
  },
});

registerOwnerCapability({
  id: 'workspace.denyPolicy',
  operation: 'create',
  version: '1.0',
  sensitivity: 'restricted',
  schema: { type: 'object' },
  inputSchema: {
    type: 'object',
    required: ['id', 'principalId', 'operation', 'resourceId', 'priority'],
    properties: {
      id: { type: 'string' },
      principalId: { type: 'string' },
      operation: { type: 'string' },
      resourceId: { type: 'string' },
      priority: { type: 'integer' },
    },
  },
  outputSchema: { type: 'object' },
  sideEffects: ['Adds an explicit deny policy'],
  risk: 'critical',
  confirmation: 'explicit',
  idempotency: 'required',
  reversibility: 'reversible',
  handler: async (input) => ({ denied: true, ...(input as object) }),
});

registerOwnerCapability({
  id: 'workspace.delegate',
  operation: 'delegate',
  version: '1.0',
  sensitivity: 'restricted',
  schema: { type: 'object' },
  inputSchema: {
    type: 'object',
    required: ['to', 'capability', 'operations', 'expiresInMs'],
    properties: {
      to: { type: 'string' },
      capability: { type: 'string' },
      operations: { type: 'array', items: { type: 'string' } },
      purpose: { type: 'string' },
      expiresInMs: { type: 'integer' },
    },
  },
  outputSchema: { type: 'object' },
  sideEffects: ['Issues a time-limited delegation grant'],
  risk: 'high',
  confirmation: 'explicit',
  idempotency: 'supported',
  reversibility: 'reversible',
  handler: async (input) => ({ grantId: 'grant-setup-1', ...(input as object) }),
});

registerOwnerCapability({
  id: 'workspace.revokeGrant',
  operation: 'delete',
  version: '1.0',
  sensitivity: 'restricted',
  schema: { type: 'object' },
  inputSchema: {
    type: 'object',
    required: ['grantId'],
    properties: { grantId: { type: 'string' } },
  },
  outputSchema: { type: 'object' },
  sideEffects: ['Revokes a delegation grant'],
  risk: 'high',
  confirmation: 'none',
  idempotency: 'supported',
  reversibility: 'irreversible',
  handler: async (input) => ({ revoked: true, ...(input as object) }),
});

registerOwnerCapability({
  id: 'workspace.queryReceipts',
  operation: 'read',
  version: '1.0',
  sensitivity: 'confidential',
  schema: { type: 'object' },
  inputSchema: {
    type: 'object',
    properties: {
      actorId: { type: 'string' },
      capability: { type: 'string' },
    },
  },
  outputSchema: { type: 'object' },
  sideEffects: [],
  risk: 'low',
  confirmation: 'none',
  idempotency: 'none',
  reversibility: 'irreversible',
  handler: async (input) => ({ receipts: [], query: input }),
});

const server = createMCPServer({
  name: 'acme-workspace',
  cup,
  authenticate: (request) => {
    const subjectId = String(request.params?.subjectId ?? alice.id);
    const type = subjectId.startsWith('agent:') ? 'agent' : 'user';
    return { id: subjectId, type, authenticated: true, attributes: { workspaceId: 'acme' } };
  },
});

export { cup, alice, server };
```

Alice can discover, read, and change the registry. The MCP server is live. No other principal exists yet. From here, choose a path.

---

## Path B: Grow the system through MCP

After Stage 1, Path B never shows CUP library code. An agent connects as a principal. The user speaks in ordinary language. The agent only uses MCP methods: `initialize`, `tools/list`, `tools/call`, `resources/list`, and `resources/read`. CUP evaluates each call against the current subject and policy.

Transcripts below use three voices:

- **User** is a person talking to their agent.
- **Agent tool call** is the MCP JSON-RPC request.
- **Tool response** is what the CUP MCP server returns.

### Stage 2: Alice's agent extends the workspace

Alice's assistant connects as `user:alice`. It can see every owner tool because Stage 1 granted Alice execute on those capabilities.

**User (Alice):** Stand up the first CRM object and invite Bob as a member. I will approve the changes.

**Agent tool call** `initialize`

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": { "subjectId": "user:alice" }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "serverInfo": { "name": "acme-workspace", "version": "0.2.0" },
    "capabilities": { "resources": { "subscribe": true }, "tools": {}, "prompts": {} }
  }
}
```

**Agent tool call** `tools/list`

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {
    "subjectId": "user:alice",
    "goal": "create the first CRM resource and a member principal",
    "context": { "purpose": "initial-workspace-setup" }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      { "name": "workspace.addResource", "description": "workspace.addResource (medium risk)" },
      { "name": "workspace.addPrincipal", "description": "workspace.addPrincipal (high risk)" },
      { "name": "workspace.allowPolicy", "description": "workspace.allowPolicy (critical risk)" },
      { "name": "workspace.denyPolicy", "description": "workspace.denyPolicy (critical risk)" },
      { "name": "workspace.delegate", "description": "workspace.delegate (high risk)" },
      { "name": "workspace.revokeGrant", "description": "workspace.revokeGrant (high risk)" },
      { "name": "workspace.queryReceipts", "description": "workspace.queryReceipts (low risk)" }
    ]
  }
}
```

The first mutating call is denied until Alice confirms the exact input. CUP does not treat the MCP request itself as consent.

**Agent tool call** `tools/call` `workspace.addResource`

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "subjectId": "user:alice",
    "name": "workspace.addResource",
    "arguments": {
      "resourceId": "crm.contacts",
      "name": "CRM Contacts",
      "sensitivity": "confidential"
    },
    "context": { "purpose": "initial-workspace-setup" }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "isError": true,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"denied\",\"decision\":{\"reasonCode\":\"CONFIRMATION_REQUIRED\"},\"capability\":\"workspace.addResource\"}"
    }]
  }
}
```

**Agent:** Creating `crm.contacts` will register a new CUP resource. Approve that exact change?

**User (Alice):** Approved.

**Agent tool call** `tools/call` `workspace.addResource` (confirmed)

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "subjectId": "user:alice",
    "name": "workspace.addResource",
    "arguments": {
      "resourceId": "crm.contacts",
      "name": "CRM Contacts",
      "sensitivity": "confidential"
    },
    "context": {
      "purpose": "initial-workspace-setup",
      "confirmation": { "confirmedBy": "user:alice" },
      "idempotencyKey": "add-crm-contacts-v1"
    }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"succeeded\",\"capability\":\"workspace.addResource\",\"resultSummary\":{\"created\":true,\"resourceId\":\"crm.contacts\"}}"
    }]
  }
}
```

**Agent tool call** `tools/call` `workspace.addPrincipal` (after Alice approves)

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "subjectId": "user:alice",
    "name": "workspace.addPrincipal",
    "arguments": { "principalId": "user:bob", "role": "member" },
    "context": {
      "purpose": "initial-workspace-setup",
      "confirmation": { "confirmedBy": "user:alice" },
      "idempotencyKey": "add-user-bob-v1"
    }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"succeeded\",\"capability\":\"workspace.addPrincipal\",\"resultSummary\":{\"created\":true,\"principalId\":\"user:bob\",\"role\":\"member\"}}"
    }]
  }
}
```

**Agent:** Contacts exist. Bob exists as a member. He still has no policies, so he cannot see anything yet.

### Stage 3: Alice grants Bob a narrow view

**User (Alice):** Let Bob discover and read contacts in the Acme workspace. Hide phone and personal email. Do not let him add resources.

**Agent tool call** `tools/call` `workspace.allowPolicy`

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "subjectId": "user:alice",
    "name": "workspace.allowPolicy",
    "arguments": {
      "id": "bob-discover-contacts",
      "principalId": "user:bob",
      "operation": "discover",
      "resourceId": "crm.contacts",
      "priority": 50
    },
    "context": {
      "confirmation": { "confirmedBy": "user:alice" },
      "idempotencyKey": "policy-bob-discover-v1"
    }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"succeeded\",\"capability\":\"workspace.allowPolicy\",\"resultSummary\":{\"allowed\":true,\"id\":\"bob-discover-contacts\"}}"
    }]
  }
}
```

**Agent tool call** `tools/call` `workspace.allowPolicy`

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "subjectId": "user:alice",
    "name": "workspace.allowPolicy",
    "arguments": {
      "id": "bob-read-contacts",
      "principalId": "user:bob",
      "operation": "read",
      "resourceId": "crm.contacts",
      "priority": 50,
      "scope": { "workspaceId": "acme" },
      "redactFields": ["phone", "personalEmail"]
    },
    "context": {
      "confirmation": { "confirmedBy": "user:alice" },
      "idempotencyKey": "policy-bob-read-v1"
    }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"succeeded\",\"capability\":\"workspace.allowPolicy\",\"resultSummary\":{\"allowed\":true,\"id\":\"bob-read-contacts\"}}"
    }]
  }
}
```

**Agent:** Bob can discover and read `crm.contacts` in Acme. Phone and personal email are redacted. He has no execute policy, so add-resource stays closed.

### Stage 4: Bob tries allowed and forbidden work

Bob's assistant connects as `user:bob`. The same MCP server, a different subject, a different projection.

**User (Bob):** What can I see, and show me the contacts.

**Agent tool call** `resources/list`

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "resources/list",
  "params": {
    "subjectId": "user:bob",
    "context": { "workspaceId": "acme", "purpose": "contact_lookup" }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "result": {
    "resources": [
      { "ref": { "id": "crm.contacts", "version": "1.0" }, "visibility": "listed", "capabilities": [] }
    ]
  }
}
```

Bob does not see `workspace.registry`. Discovery never leaked it.

**Agent tool call** `resources/read`

```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "method": "resources/read",
  "params": {
    "subjectId": "user:bob",
    "uri": "cup://crm.contacts",
    "context": { "workspaceId": "acme", "purpose": "contact_lookup" }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "result": {
    "items": [
      { "id": "c1", "name": "Ada Lovelace", "company": "Analytical Engines" }
    ],
    "receiptId": "receipt-bob-read-1"
  }
}
```

`phone` and `personalEmail` are absent. Redaction happened before the MCP response.

**User (Bob):** Also create a leads resource for me.

**Agent tool call** `tools/list`

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "tools/list",
  "params": {
    "subjectId": "user:bob",
    "goal": "create a leads resource",
    "context": { "purpose": "expand-crm" }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "result": { "tools": [] }
}
```

**Agent:** I do not have a create-resource tool in this session. I can try the owner tool by name, but CUP should still deny it.

**Agent tool call** `tools/call` `workspace.addResource`

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "tools/call",
  "params": {
    "subjectId": "user:bob",
    "name": "workspace.addResource",
    "arguments": {
      "resourceId": "crm.leads",
      "name": "Leads",
      "sensitivity": "confidential"
    },
    "context": { "purpose": "expand-crm" }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "result": {
    "isError": true,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"denied\",\"decision\":{\"effect\":\"deny\",\"reasonCode\":\"NO_MATCHING_ALLOW\"},\"capability\":\"workspace.addResource\"}"
    }]
  }
}
```

**Agent:** Denied. I can read contacts. I cannot add resources.

### Stage 5: Alice adds Carol with a time box

**User (Alice):** Add Carol as readonly for 30 days. She may read contacts in Acme, but hide phone, personal email, and internal notes.

**Agent tool call** `tools/call` `workspace.addPrincipal`

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "tools/call",
  "params": {
    "subjectId": "user:alice",
    "name": "workspace.addPrincipal",
    "arguments": { "principalId": "user:carol", "role": "readonly" },
    "context": {
      "confirmation": { "confirmedBy": "user:alice" },
      "idempotencyKey": "add-user-carol-v1"
    }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"succeeded\",\"resultSummary\":{\"created\":true,\"principalId\":\"user:carol\",\"role\":\"readonly\"}}"
    }]
  }
}
```

**Agent tool call** `tools/call` `workspace.allowPolicy`

```json
{
  "jsonrpc": "2.0",
  "id": 13,
  "method": "tools/call",
  "params": {
    "subjectId": "user:alice",
    "name": "workspace.allowPolicy",
    "arguments": {
      "id": "carol-read-contacts-limited",
      "principalId": "user:carol",
      "operation": "read",
      "resourceId": "crm.contacts",
      "priority": 30,
      "scope": { "workspaceId": "acme" },
      "expiresAt": "2026-10-03T16:00:00Z",
      "redactFields": ["phone", "personalEmail", "internalNotes"]
    },
    "context": {
      "confirmation": { "confirmedBy": "user:alice" },
      "idempotencyKey": "policy-carol-read-v1"
    }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 13,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"succeeded\",\"resultSummary\":{\"allowed\":true,\"id\":\"carol-read-contacts-limited\"}}"
    }]
  }
}
```

**Agent:** Carol can read contacts until that expiry. After it, CUP denies the same read without another code change.

### Stage 6: Alice delegates a short setup job, then revokes it

**User (Alice):** Let the setup bot add a projects board, then take the grant away.

**Agent tool call** `tools/call` `workspace.delegate`

```json
{
  "jsonrpc": "2.0",
  "id": 14,
  "method": "tools/call",
  "params": {
    "subjectId": "user:alice",
    "name": "workspace.delegate",
    "arguments": {
      "to": "agent:setup-bot",
      "capability": "workspace.addResource",
      "operations": ["execute"],
      "purpose": "add-projects-resource",
      "expiresInMs": 300000
    },
    "context": { "confirmation": { "confirmedBy": "user:alice" } }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 14,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"succeeded\",\"resultSummary\":{\"grantId\":\"grant-setup-1\",\"to\":\"agent:setup-bot\",\"capability\":\"workspace.addResource\"}}"
    }]
  }
}
```

The setup bot now connects as `agent:setup-bot`, not as Alice.

**User (setup operator):** Add the projects board.

**Agent tool call** `tools/call` `workspace.addResource` as `agent:setup-bot`

```json
{
  "jsonrpc": "2.0",
  "id": 15,
  "method": "tools/call",
  "params": {
    "subjectId": "agent:setup-bot",
    "name": "workspace.addResource",
    "arguments": {
      "resourceId": "projects.board",
      "name": "Projects Board",
      "sensitivity": "internal"
    },
    "context": {
      "purpose": "add-projects-resource",
      "delegationId": "grant-setup-1",
      "idempotencyKey": "add-projects-board-v1"
    }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 15,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"succeeded\",\"decision\":{\"reasonCode\":\"DELEGATED_ALLOW\"},\"resultSummary\":{\"created\":true,\"resourceId\":\"projects.board\"}}"
    }]
  }
}
```

**User (Alice):** Revoke that grant.

**Agent tool call** `tools/call` `workspace.revokeGrant`

```json
{
  "jsonrpc": "2.0",
  "id": 16,
  "method": "tools/call",
  "params": {
    "subjectId": "user:alice",
    "name": "workspace.revokeGrant",
    "arguments": { "grantId": "grant-setup-1" }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 16,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"succeeded\",\"resultSummary\":{\"revoked\":true,\"grantId\":\"grant-setup-1\"}}"
    }]
  }
}
```

A second add-resource call from `agent:setup-bot` now returns `INVALID_DELEGATION` or `NO_MATCHING_ALLOW`.

### Stage 7: Alice reads the audit trail

**User (Alice):** Show receipts for adding resources.

**Agent tool call** `tools/call` `workspace.queryReceipts`

```json
{
  "jsonrpc": "2.0",
  "id": 17,
  "method": "tools/call",
  "params": {
    "subjectId": "user:alice",
    "name": "workspace.queryReceipts",
    "arguments": { "capability": "workspace.addResource" }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 17,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"succeeded\",\"resultSummary\":{\"receipts\":[{\"actor\":\"user:alice\",\"capability\":\"workspace.addResource\",\"status\":\"succeeded\",\"resourceId\":\"crm.contacts\"},{\"actor\":\"agent:setup-bot\",\"capability\":\"workspace.addResource\",\"status\":\"succeeded\",\"resourceId\":\"projects.board\"}]}}"
    }]
  }
}
```

**Agent:** Two successful creates. Alice added contacts. The setup bot added the projects board under a grant that is now revoked.

### Stage 8: Alice revokes Carol, then Carol is denied

**User (Alice):** Carol's contract ended. Block her contact reads now.

**Agent tool call** `tools/call` `workspace.denyPolicy`

```json
{
  "jsonrpc": "2.0",
  "id": 18,
  "method": "tools/call",
  "params": {
    "subjectId": "user:alice",
    "name": "workspace.denyPolicy",
    "arguments": {
      "id": "carol-revoked",
      "principalId": "user:carol",
      "operation": "read",
      "resourceId": "crm.contacts",
      "priority": 200
    },
    "context": {
      "confirmation": { "confirmedBy": "user:alice" },
      "idempotencyKey": "deny-carol-read-v1"
    }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 18,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\"status\":\"succeeded\",\"resultSummary\":{\"denied\":true,\"id\":\"carol-revoked\"}}"
    }]
  }
}
```

Carol's assistant tries the same read Bob used.

**User (Carol):** Show me the contacts.

**Agent tool call** `resources/read`

```json
{
  "jsonrpc": "2.0",
  "id": 19,
  "method": "resources/read",
  "params": {
    "subjectId": "user:carol",
    "uri": "cup://crm.contacts",
    "context": { "workspaceId": "acme" }
  }
}
```

**Tool response**

```json
{
  "jsonrpc": "2.0",
  "id": 19,
  "error": {
    "code": -32000,
    "message": "CUP_NOT_AUTHORIZED:EXPLICIT_DENY"
  }
}
```

**Agent:** Access was removed. I cannot read contacts for this account.

### Stage 9: Same MCP path against production SQL

Operators still do not write CUP TypeScript to grow the workspace. They connect the Stage 1 server to PostgreSQL, load the snapshot, and keep using the same MCP methods. The conversation in Stages 2 through 8 does not change.

What changes is the host behind `createMCPServer`:

- `CUP_POSTGRES_SCHEMA` creates subjects, resources, capabilities, policies, grants, prepared actions, and receipts.
- Resource and policy rows become the Stage 1 snapshot on process start.
- `workspace.allowPolicy` and `workspace.addResource` write SQL, then the runtime reloads or applies the change.
- Receipts land in `cup_receipts` instead of memory.

Bob, Carol, and the setup bot still only speak MCP. Fail-closed behavior is the same: no matching allow is a deny, an explicit deny wins, and a revoked grant cannot be reused.

---

## Path A: Grow the system with the host library

Use this path when you are embedding CUP inside application code and want the same stages as direct TypeScript. Path B is the same story over MCP.

### Stage 2: Register MCP and owner tools in process

If you did not use the Stage 1 bootstrap above, you can register the same capabilities and call `createMCPServer` from host code. The [MCP server](../runtimes/mcp-server.md) page shows `handle()` for `initialize`, `resources/list`, `resources/read`, `tools/list`, and `tools/call`.

Delegation from Alice to a setup agent is a host call:

```ts
const grant = await cup.delegate({
  from: alice,
  to: subject('agent:setup-bot'),
  capability: 'workspace.addResource',
  operations: ['execute'],
  purpose: 'initial-workspace-setup',
  expiresInMs: 60 * 60 * 1_000,
});
```

### Stage 3: Alice writes Bob's policies in process

```ts
cup.policy.allow({
  id: 'bob-discover-contacts',
  principal: { id: 'user:bob' },
  operation: 'discover',
  resource: { id: 'crm.contacts' },
  priority: 50,
});
cup.policy.allow({
  id: 'bob-read-contacts',
  principal: { id: 'user:bob' },
  operation: 'read',
  resource: { id: 'crm.contacts' },
  scope: { workspaceId: 'acme' },
  obligations: [{ type: 'redact', fields: ['phone', 'personalEmail'] }],
  priority: 50,
});
```

### Stage 4: Bob is denied until those policies exist

```ts
const bob = subject('user:bob', { role: 'member', workspaceId: 'acme' });
const before = await cup.authorize({
  subject: bob,
  operation: 'discover',
  resource: { id: 'workspace.registry' },
  context: {},
});
// deny NO_MATCHING_ALLOW
```

### Stage 5: Time-limited contractor access

```ts
cup.policy.allow({
  id: 'carol-read-contacts-limited',
  principal: { id: 'user:carol' },
  operation: 'read',
  resource: { id: 'crm.contacts' },
  scope: { workspaceId: 'acme' },
  obligations: [{ type: 'redact', fields: ['phone', 'personalEmail', 'internalNotes'] }],
  priority: 30,
  expiresAt: '2026-10-03T16:00:00Z',
  validDuring: { startsAt: '2026-01-01T08:00:00Z', endsAt: '2026-12-31T18:00:00Z' },
});
```

### Stage 6: Prepare, confirm, execute

```ts
const prepared = await cup.prepare({
  subject: alice,
  capability: 'workspace.addResource',
  input: { resourceId: 'projects.board', name: 'Projects Board', sensitivity: 'internal' },
  context: {},
});
const receipt = await cup.execute({
  ...prepared.request,
  confirmation: { inputHash: prepared.inputHash, confirmedBy: alice.id },
  idempotencyKey: 'add-projects-board-v1',
  context: {},
});
```

### Stage 7: Query receipts

```ts
const receipts = cup.receipts.find?.({ capability: 'workspace.addResource' }) ?? [];
```

### Stage 8: Explicit deny

```ts
cup.policy.deny({
  id: 'carol-revoked',
  principal: { id: 'user:carol' },
  operation: 'read',
  resource: { id: 'crm.contacts' },
  priority: 200,
});
```

### Stage 9: PostgreSQL snapshot

```ts
import { CapabilityUI, CUP_POSTGRES_SCHEMA, PostgresPersistence } from '@capability-ui/core';

const store = new PostgresPersistence(db);
await db.query(CUP_POSTGRES_SCHEMA);
const cup = new CapabilityUI();
for (const resource of await store.resources()) cup.register(resource);
for (const policy of await store.policies()) {
  const { effect, ...input } = policy;
  effect === 'allow' ? cup.policy.allow(input) : cup.policy.deny(input);
}
```

---

## What both paths prove

| CUP concept | Path B moment | Path A moment |
|---|---|---|
| Deny by default | Bob's empty `tools/list` | Stage 4 `NO_MATCHING_ALLOW` |
| Discover is not read | Bob lists contacts, then reads them | Separate `discover` and `read` policies |
| Execute is a third decision | Bob's forged `workspace.addResource` | Missing execute policy |
| Confirmation | Alice's first add-resource denial | `prepare` then `execute` |
| Delegation | Setup bot succeeds, then fails after revoke | `cup.delegate` and `revokeGrant` |
| Redaction | Bob's read omits phone | `redact` obligations |
| Revocation | Carol's `EXPLICIT_DENY` | Higher-priority deny |
| Receipts | `workspace.queryReceipts` | `cup.receipts.find` |
| SQL | Same MCP calls, durable store | `PostgresPersistence` |

The host writes Stage 1. After that, production growth is a series of authorized actions. MCP is the wire. CUP is the decision.
