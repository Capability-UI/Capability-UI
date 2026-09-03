---
id: from-zero-to-production
title: From zero to production
sidebar_label: From zero to production
description: Build a CUP-governed system from one owner and one resource, then grow it through MCP, hardcoded host contracts, or the CLI.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# From zero to production

A CUP system starts closed. The first useful state is one verified owner, one resource, and every operation allowed for that owner. From there the system grows because principals take actions, not because an engineer keeps editing policy files.

This page has three paths after the same Stage 1 bootstrap:

| Path | Who is acting | What later stages look like |
|---|---|---|
| [Path A: MCP conversations](#path-a-grow-the-system-through-mcp) | An external agent connected as a principal | User messages, MCP tool calls, and tool responses |
| [Path B: Host contracts in code](#path-b-hardcode-contracts-in-application-code) | Your application | TypeScript calls to `cup.policy`, `cup.delegate`, `cup.execute` |
| [Path C: CLI](#path-c-grow-the-system-through-the-cli) | A person or script using `cup` | The same MCP methods as Path A, typed as shell commands |

Path A is the production shape most teams should study first. After Stage 1, people and agents should not import `@capability-ui/core` to grow the workspace. They should ask, discover, and act through MCP. Path C is the same contract for terminals and scripts. Path B shows how a host can hardcode the same contracts in application code when an agent or CLI is not in the loop. CUP stays behind the server and decides allow or deny.

---

## Stage 1: One user, one resource, full authority

The host writes this once. It creates the initial owner `admin`, registers the workspace registry, gives `admin` every operation on it, and exposes the meta-capabilities an owner needs so later growth can happen through MCP.

```ts
// setup.ts
import {
  createCupCli,
  createMCPServer,
  defineCapability,
  denyByDefault,
  subject,
  type Resource,
} from '@capability-ui/core';

const cup = denyByDefault();

const admin = subject('user:admin', {
  role: 'owner',
  workspaceId: 'acme',
});

const workspace: Resource = {
  id: 'workspace.registry',
  type: 'data',
  version: '1.0',
  sensitivity: 'confidential',
  owner: admin.id,
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      owner: { type: 'string' },
    },
  },
  read: async () => [
    { id: 'workspace.registry', name: 'Acme Workspace', owner: admin.id },
  ],
};
cup.register(workspace);

for (const operation of [
  'discover', 'inspect', 'read', 'create', 'update',
  'delete', 'execute', 'share', 'delegate',
] as const) {
  cup.policy.allow({
    id: `admin-${operation}-registry`,
    principal: { id: admin.id },
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
    id: `admin-execute-${capability.id}`,
    principal: { id: admin.id },
    operation: 'execute',
    resource: { id: capability.id },
    priority: 100,
  });
  cup.policy.allow({
    id: `admin-delegate-${capability.id}`,
    principal: { id: admin.id },
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
    const subjectId = String(request.params?.subjectId ?? admin.id);
    const type = subjectId.startsWith('agent:') ? 'agent' : 'user';
    return { id: subjectId, type, authenticated: true, attributes: { workspaceId: 'acme' } };
  },
});

const cli = createCupCli({ cup, name: 'acme-workspace' });

export { cup, admin, server, cli };
```

Admin can discover, read, and change the registry. The MCP server and CLI are live. No other principal exists yet. From here, choose a path.

---

## Path A: Grow the system through MCP

After Stage 1, Path A never shows CUP library code. An agent connects as a principal. The user speaks in ordinary language. The agent only uses MCP methods: `initialize`, `tools/list`, `tools/call`, `resources/list`, and `resources/read`. CUP evaluates each call against the current subject and policy.

Transcripts below use three voices:

- **User** is a person talking to their agent.
- **Agent tool call** is the MCP JSON-RPC request.
- **Tool response** is what the CUP MCP server returns.

### Stage 2: Admin's agent extends the workspace

Admin's assistant connects as `user:admin`. It can see every owner tool because Stage 1 granted Admin execute on those capabilities.

**User (Admin):** Stand up the first CRM object and invite Bob as a member. I will approve the changes.

**Agent tool call** `initialize`

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": { "subjectId": "user:admin" }
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
    "subjectId": "user:admin",
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

The first mutating call is denied until Admin confirms the exact input. CUP does not treat the MCP request itself as consent.

**Agent tool call** `tools/call` `workspace.addResource`

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
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

**User (Admin):** Approved.

**Agent tool call** `tools/call` `workspace.addResource` (confirmed)

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
    "name": "workspace.addResource",
    "arguments": {
      "resourceId": "crm.contacts",
      "name": "CRM Contacts",
      "sensitivity": "confidential"
    },
    "context": {
      "purpose": "initial-workspace-setup",
      "confirmation": { "confirmedBy": "user:admin" },
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

**Agent tool call** `tools/call` `workspace.addPrincipal` (after Admin approves)

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
    "name": "workspace.addPrincipal",
    "arguments": { "principalId": "user:bob", "role": "member" },
    "context": {
      "purpose": "initial-workspace-setup",
      "confirmation": { "confirmedBy": "user:admin" },
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

### Stage 3: Admin grants Bob a narrow view

**User (Admin):** Let Bob discover and read contacts in the Acme workspace. Hide phone and personal email. Do not let him add resources.

**Agent tool call** `tools/call` `workspace.allowPolicy`

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
    "name": "workspace.allowPolicy",
    "arguments": {
      "id": "bob-discover-contacts",
      "principalId": "user:bob",
      "operation": "discover",
      "resourceId": "crm.contacts",
      "priority": 50
    },
    "context": {
      "confirmation": { "confirmedBy": "user:admin" },
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
    "subjectId": "user:admin",
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
      "confirmation": { "confirmedBy": "user:admin" },
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

### Stage 5: Admin adds Carol with a time box

**User (Admin):** Add Carol as readonly for 30 days. She may read contacts in Acme, but hide phone, personal email, and internal notes.

**Agent tool call** `tools/call` `workspace.addPrincipal`

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
    "name": "workspace.addPrincipal",
    "arguments": { "principalId": "user:carol", "role": "readonly" },
    "context": {
      "confirmation": { "confirmedBy": "user:admin" },
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
    "subjectId": "user:admin",
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
      "confirmation": { "confirmedBy": "user:admin" },
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

### Stage 6: Admin delegates a short setup job, then revokes it

**User (Admin):** Let the setup bot add a projects board, then take the grant away.

**Agent tool call** `tools/call` `workspace.delegate`

```json
{
  "jsonrpc": "2.0",
  "id": 14,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
    "name": "workspace.delegate",
    "arguments": {
      "to": "agent:setup-bot",
      "capability": "workspace.addResource",
      "operations": ["execute"],
      "purpose": "add-projects-resource",
      "expiresInMs": 300000
    },
    "context": { "confirmation": { "confirmedBy": "user:admin" } }
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

The setup bot now connects as `agent:setup-bot`, not as Admin.

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

**User (Admin):** Revoke that grant.

**Agent tool call** `tools/call` `workspace.revokeGrant`

```json
{
  "jsonrpc": "2.0",
  "id": 16,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
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

### Stage 7: Admin reads the audit trail

**User (Admin):** Show receipts for adding resources.

**Agent tool call** `tools/call` `workspace.queryReceipts`

```json
{
  "jsonrpc": "2.0",
  "id": 17,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
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
      "text": "{\"status\":\"succeeded\",\"resultSummary\":{\"receipts\":[{\"actor\":\"user:admin\",\"capability\":\"workspace.addResource\",\"status\":\"succeeded\",\"resourceId\":\"crm.contacts\"},{\"actor\":\"agent:setup-bot\",\"capability\":\"workspace.addResource\",\"status\":\"succeeded\",\"resourceId\":\"projects.board\"}]}}"
    }]
  }
}
```

**Agent:** Two successful creates. Admin added contacts. The setup bot added the projects board under a grant that is now revoked.

### Stage 8: Admin revokes Carol, then Carol is denied

**User (Admin):** Carol's contract ended. Block her contact reads now.

**Agent tool call** `tools/call` `workspace.denyPolicy`

```json
{
  "jsonrpc": "2.0",
  "id": 18,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
    "name": "workspace.denyPolicy",
    "arguments": {
      "id": "carol-revoked",
      "principalId": "user:carol",
      "operation": "read",
      "resourceId": "crm.contacts",
      "priority": 200
    },
    "context": {
      "confirmation": { "confirmedBy": "user:admin" },
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

## Path B: Hardcode contracts in application code

Use this path when you are embedding CUP inside application code and want the same stages as typed TypeScript contracts. Path A is the same story over MCP. Path C is the same story over the CLI.

### Stage 2: Register MCP and owner tools in process

If you did not use the Stage 1 bootstrap above, you can register the same capabilities and call `createMCPServer` from host code. The [MCP server](../runtimes/mcp-server.md) page shows `handle()` for `initialize`, `resources/list`, `resources/read`, `tools/list`, and `tools/call`.

Delegation from Admin to a setup agent is a host call:

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
const grant = await cup.delegate({
  from: admin,
  to: subject('agent:setup-bot'),
  capability: 'workspace.addResource',
  operations: ['execute'],
  purpose: 'initial-workspace-setup',
  expiresInMs: 60 * 60 * 1_000,
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
    "name": "workspace.delegate",
    "arguments": {
      "to": "agent:setup-bot",
      "capability": "workspace.addResource",
      "operations": ["execute"],
      "purpose": "initial-workspace-setup",
      "expiresInMs": 3600000
    },
    "confirmation": { "confirmedBy": "user:admin" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.delegate \
  --args '{"to":"agent:setup-bot","capability":"workspace.addResource","operations":["execute"],"purpose":"initial-workspace-setup","expiresInMs":3600000}' \
  --confirm
```

</TabItem>
</Tabs>

### Stage 3: Admin writes Bob's policies in process

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

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
      "id": "bob-read-contacts",
      "principalId": "user:bob",
      "operation": "read",
      "resourceId": "crm.contacts",
      "priority": 50,
      "scope": { "workspaceId": "acme" },
      "redactFields": ["phone", "personalEmail"]
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
  --args '{"id":"bob-read-contacts","principalId":"user:bob","operation":"read","resourceId":"crm.contacts","priority":50,"scope":{"workspaceId":"acme"},"redactFields":["phone","personalEmail"]}' \
  --confirm
```

</TabItem>
</Tabs>

### Stage 4: Bob is denied until those policies exist

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
const bob = subject('user:bob', { role: 'member', workspaceId: 'acme' });
const before = await cup.authorize({
  subject: bob,
  operation: 'discover',
  resource: { id: 'workspace.registry' },
  context: {},
});
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list",
  "params": { "subjectId": "user:bob" }
}
```

Bob's list does not include `workspace.registry`.

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:bob resources list
```

</TabItem>
</Tabs>

### Stage 5: Time-limited contractor access

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

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
      "id": "carol-read-contacts-limited",
      "principalId": "user:carol",
      "operation": "read",
      "resourceId": "crm.contacts",
      "priority": 30,
      "scope": { "workspaceId": "acme" },
      "expiresAt": "2026-10-03T16:00:00Z",
      "redactFields": ["phone", "personalEmail", "internalNotes"]
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
  --args '{"id":"carol-read-contacts-limited","principalId":"user:carol","operation":"read","resourceId":"crm.contacts","priority":30,"scope":{"workspaceId":"acme"},"expiresAt":"2026-10-03T16:00:00Z","redactFields":["phone","personalEmail","internalNotes"]}' \
  --confirm
```

</TabItem>
</Tabs>

### Stage 6: Prepare, confirm, execute

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
const prepared = await cup.prepare({
  subject: admin,
  capability: 'workspace.addResource',
  input: { resourceId: 'projects.board', name: 'Projects Board', sensitivity: 'internal' },
  context: {},
});
const receipt = await cup.execute({
  ...prepared.request,
  confirmation: { inputHash: prepared.inputHash, confirmedBy: admin.id },
  idempotencyKey: 'add-projects-board-v1',
  context: {},
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
    "name": "workspace.addResource",
    "arguments": {
      "resourceId": "projects.board",
      "name": "Projects Board",
      "sensitivity": "internal"
    },
    "confirmation": { "confirmedBy": "user:admin" },
    "idempotencyKey": "add-projects-board-v1"
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.addResource \
  --args '{"resourceId":"projects.board","name":"Projects Board","sensitivity":"internal"}' \
  --confirm --idempotency-key add-projects-board-v1
```

</TabItem>
</Tabs>

### Stage 7: Query receipts

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
const receipts = cup.receipts.find?.({ capability: 'workspace.addResource' }) ?? [];
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
    "name": "workspace.queryReceipts",
    "arguments": { "capability": "workspace.addResource" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.queryReceipts \
  --args '{"capability":"workspace.addResource"}'
```

</TabItem>
</Tabs>

### Stage 8: Explicit deny

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
cup.policy.deny({
  id: 'carol-revoked',
  principal: { id: 'user:carol' },
  operation: 'read',
  resource: { id: 'crm.contacts' },
  priority: 200,
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
    "name": "workspace.denyPolicy",
    "arguments": {
      "id": "carol-revoked",
      "principalId": "user:carol",
      "operation": "read",
      "resourceId": "crm.contacts",
      "priority": 200
    },
    "confirmation": { "confirmedBy": "user:admin" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.denyPolicy \
  --args '{"id":"carol-revoked","principalId":"user:carol","operation":"read","resourceId":"crm.contacts","priority":200}' \
  --confirm
```

</TabItem>
</Tabs>

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

## Path C: Grow the system through the CLI

Path C is Path A with a keyboard. After Stage 1, there is still no CUP TypeScript in the operator's hands. `cup` loads `setup.js`, sets `--subject`, and issues the same MCP methods. See [CUP CLI](../runtimes/cli.md) for flags.

Run every command from the directory that compiled Stage 1:

```bash
export CUP_HOST=./dist/setup.js
```

The examples pass `--host` explicitly.

### Stage 2: Admin extends the workspace

```bash
cup --host ./dist/setup.js --subject user:admin init
cup --host ./dist/setup.js --subject user:admin \
  --purpose initial-workspace-setup --goal "create crm and invite bob" \
  tools list
```

`tools list` returns Admin's owner tools. The first mutating call is denied until `--confirm` binds the argument hash.

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.addResource \
  --args '{"resourceId":"crm.contacts","name":"CRM Contacts","sensitivity":"confidential"}' \
  --purpose initial-workspace-setup
# status: denied, reasonCode: CONFIRMATION_REQUIRED

cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.addResource \
  --args '{"resourceId":"crm.contacts","name":"CRM Contacts","sensitivity":"confidential"}' \
  --purpose initial-workspace-setup \
  --confirm --idempotency-key add-crm-contacts-v1
# status: succeeded

cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.addPrincipal \
  --args '{"principalId":"user:bob","role":"member"}' \
  --confirm --idempotency-key add-user-bob-v1
# status: succeeded
```

### Stage 3: Admin grants Bob a narrow view

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.allowPolicy \
  --args '{"id":"bob-discover-contacts","principalId":"user:bob","operation":"discover","resourceId":"crm.contacts","priority":50}' \
  --confirm --idempotency-key policy-bob-discover-v1

cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.allowPolicy \
  --args '{"id":"bob-read-contacts","principalId":"user:bob","operation":"read","resourceId":"crm.contacts","priority":50,"scope":{"workspaceId":"acme"},"redactFields":["phone","personalEmail"]}' \
  --confirm --idempotency-key policy-bob-read-v1
```

### Stage 4: Bob is allowed to read and denied to create

```bash
cup --host ./dist/setup.js --subject user:bob \
  --context '{"workspaceId":"acme"}' --purpose contact_lookup \
  resources list
# resources: [crm.contacts]

cup --host ./dist/setup.js --subject user:bob \
  --context '{"workspaceId":"acme"}' --purpose contact_lookup \
  resources read cup://crm.contacts
# items omit phone and personalEmail

cup --host ./dist/setup.js --subject user:bob tools list
# tools: []

cup --host ./dist/setup.js --subject user:bob \
  tools call workspace.addResource \
  --args '{"resourceId":"crm.leads","name":"Leads","sensitivity":"confidential"}'
# status: denied, reasonCode: NO_MATCHING_ALLOW
```

### Stage 5: Admin adds Carol with a time box

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.addPrincipal \
  --args '{"principalId":"user:carol","role":"readonly"}' \
  --confirm --idempotency-key add-user-carol-v1

cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.allowPolicy \
  --args '{"id":"carol-read-contacts-limited","principalId":"user:carol","operation":"read","resourceId":"crm.contacts","priority":30,"scope":{"workspaceId":"acme"},"expiresAt":"2026-10-03T16:00:00Z","redactFields":["phone","personalEmail","internalNotes"]}' \
  --confirm --idempotency-key policy-carol-read-v1
```

### Stage 6: Delegate, act as the bot, revoke

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.delegate \
  --args '{"to":"agent:setup-bot","capability":"workspace.addResource","operations":["execute"],"purpose":"add-projects-resource","expiresInMs":300000}' \
  --confirm

cup --host ./dist/setup.js --subject agent:setup-bot \
  tools call workspace.addResource \
  --args '{"resourceId":"projects.board","name":"Projects Board","sensitivity":"internal"}' \
  --purpose add-projects-resource \
  --confirm --idempotency-key add-projects-board-v1 \
  --delegation '{"id":"grant-setup-1","from":{"id":"user:admin"},"to":{"id":"agent:setup-bot"},"capability":"workspace.addResource","operations":["execute"],"purpose":"add-projects-resource","expiresAt":"2030-01-01T00:00:00Z"}'

cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.revokeGrant \
  --args '{"grantId":"grant-setup-1"}'
```

### Stage 7: Query receipts

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.queryReceipts \
  --args '{"capability":"workspace.addResource"}'
```

### Stage 8: Revoke Carol, then she is denied

```bash
cup --host ./dist/setup.js --subject user:admin \
  tools call workspace.denyPolicy \
  --args '{"id":"carol-revoked","principalId":"user:carol","operation":"read","resourceId":"crm.contacts","priority":200}' \
  --confirm --idempotency-key deny-carol-read-v1

cup --host ./dist/setup.js --subject user:carol \
  --context '{"workspaceId":"acme"}' \
  resources read cup://crm.contacts
# error: CUP_NOT_AUTHORIZED:EXPLICIT_DENY
```

### Stage 9: Same CLI against production SQL

Point `--host` at a module that loads `PostgresPersistence` and still exports `{ cup }`. The commands in Stages 2 through 8 do not change.

---

## What all three paths prove

| CUP concept | Path A (MCP) | Path B (code) | Path C (CLI) |
|---|---|---|---|
| Deny by default | Bob's empty `tools/list` | Stage 4 `NO_MATCHING_ALLOW` | `cup --subject user:bob tools list` |
| Discover is not read | Bob lists, then reads | Separate `discover` and `read` policies | `resources list` then `resources read` |
| Execute is a third decision | Forged `tools/call` | Missing execute policy | `tools call workspace.addResource` |
| Confirmation | First add-resource denial | `prepare` then `execute` | call without `--confirm`, then with it |
| Delegation | Setup bot, then revoke | `cup.delegate` / `revokeGrant` | `workspace.delegate` then `revokeGrant` |
| Redaction | Bob's read omits phone | `redact` obligations | `resources read` as Bob |
| Revocation | Carol's `EXPLICIT_DENY` | Higher-priority deny | Carol's `resources read` |
| Receipts | `workspace.queryReceipts` | `cup.receipts.find` | same tool via CLI |
| SQL | Same MCP calls, durable store | `PostgresPersistence` | Same `cup` commands, new `--host` |

The host writes Stage 1. After that, production growth is a series of authorized actions. MCP and the CLI are wires. CUP is the decision.
