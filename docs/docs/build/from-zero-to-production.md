---
id: from-zero-to-production
title: From zero to production
sidebar_label: From zero to production
description: Build a real CUP-governed system step by step, starting from a single user and one resource, then growing it through MCP agents, new principals, and accumulated policy.
---

# From zero to production

This walkthrough builds a real CUP-governed system from scratch. You will start with a single user who owns a single resource with every capability allowed. Then an external agent connects over MCP and, because the owner grants it authority, extends the system: adding resources, creating new principals, and defining policies. Later principals arrive with narrower access and must operate within whatever the current schema allows.

Every code block below runs against the actual library. Nothing is pseudocode.

---

## Stage 1: One user, one resource, full authority

The very first state of a CUP system is the simplest possible: one person who owns one resource and holds every operation on it.

```ts
// setup.ts
import {
  denyByDefault,
  defineCapability,
  subject,
  type Resource,
} from '@capability-ui/core';

// denyByDefault() is identical to new CapabilityUI() but
// signals intent: the system starts closed.
const cup = denyByDefault();

// The owner is the first and only principal.
const alice: ReturnType<typeof subject> = subject('user:alice', {
  role: 'owner',
  workspaceId: 'acme',
});

// The first resource is a workspace registry that tracks
// all other resources in the system.
const workspaceResource: Resource = {
  id: 'workspace.registry',
  type: 'data',
  version: '1.0',
  sensitivity: 'confidential',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      owner: { type: 'string' },
      createdAt: { type: 'string' },
    },
  },
  owner: alice.id,
  read: async () => [
    { id: 'workspace.registry', name: 'Acme Workspace', owner: alice.id, createdAt: '2026-01-01T00:00:00Z' },
  ],
};
cup.register(workspaceResource);

// Alice gets every operation on the registry.
for (const op of ['discover', 'inspect', 'read', 'create', 'update', 'delete', 'execute', 'share', 'delegate'] as const) {
  cup.policy.allow({
    id: `alice-${op}-registry`,
    principal: { id: alice.id },
    operation: op,
    resource: { id: workspaceResource.id },
    priority: 100,
  });
}

export { cup, alice };
```

Alice can now discover, read, and act on the registry. Nothing else exists and no one else can see anything.

---

## Stage 2: An external agent connects via MCP and extends the system

The agent connects over MCP. Because Alice has `delegate` on the registry, she can grant the agent authority to add resources and create new principals.

```ts
// mcp-setup.ts
import { createMCPServer, defineCapability } from '@capability-ui/core';
import { cup, alice } from './setup.js';

// Register a capability that lets an agent add new resources.
const addResourceCap = defineCapability({
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
  outputSchema: {
    type: 'object',
    properties: { created: { type: 'boolean' }, resourceId: { type: 'string' } },
  },
  sideEffects: ['Creates a new resource entry in the registry'],
  risk: 'medium',
  confirmation: 'explicit',
  idempotency: 'supported',
  reversibility: 'reversible',
  reverseCapability: 'workspace.removeResource',
  handler: async (input) => {
    const { resourceId, name } = input as { resourceId: string; name: string; sensitivity: string };
    // In production: write to your database and call cup.register().
    console.log(`[handler] registering resource: ${resourceId} (${name})`);
    return { created: true, resourceId };
  },
});
cup.register(addResourceCap);

// Register a capability that lets an agent create new principals.
const addPrincipalCap = defineCapability({
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
      role: { type: 'string', enum: ['member', 'admin', 'readonly'] },
    },
  },
  outputSchema: { type: 'object' },
  sideEffects: ['Creates a new principal record'],
  risk: 'high',
  confirmation: 'explicit',
  idempotency: 'required',
  reversibility: 'reversible',
  reverseCapability: 'workspace.removePrincipal',
  handler: async (input) => {
    const { principalId, role } = input as { principalId: string; role: string };
    console.log(`[handler] creating principal: ${principalId} with role ${role}`);
    return { created: true, principalId, role };
  },
});
cup.register(addPrincipalCap);

// Alice allows the capabilities on her registry.
cup.policy.allow({
  id: 'alice-allow-addResource',
  principal: { id: alice.id },
  operation: 'execute',
  resource: { id: addResourceCap.id },
  priority: 100,
});
cup.policy.allow({
  id: 'alice-allow-addPrincipal',
  principal: { id: alice.id },
  operation: 'execute',
  resource: { id: addPrincipalCap.id },
  priority: 100,
});
cup.policy.allow({
  id: 'alice-delegate-addResource',
  principal: { id: alice.id },
  operation: 'delegate',
  resource: { id: addResourceCap.id },
  priority: 100,
});
cup.policy.allow({
  id: 'alice-delegate-addPrincipal',
  principal: { id: alice.id },
  operation: 'delegate',
  resource: { id: addPrincipalCap.id },
  priority: 100,
});

// Create the MCP server. In production, authenticate() resolves
// a real identity from a token, session, or mutual TLS certificate.
const server = createMCPServer({
  name: 'acme-workspace',
  cup,
  authenticate: (request) => {
    // The agent passes its identity in request.params.subjectId.
    const params = request.params ?? {};
    const subjectId = String(params.subjectId ?? 'agent:unknown');
    return { id: subjectId, type: 'agent', authenticated: true, attributes: {} };
  },
});

export { cup, alice, server };
```

### Delegating to the agent

Alice connects and delegates authority to the agent for the setup session:

```ts
// alice-delegates.ts
import { cup, alice } from './mcp-setup.js';
import { subject } from '@capability-ui/core';

const setupAgent = subject('agent:setup-bot', { role: 'agent' });

// Delegate addResource for 1 hour.
const resourceGrant = await cup.delegate({
  from: alice,
  to: setupAgent,
  capability: 'workspace.addResource',
  operations: ['execute'],
  purpose: 'initial-workspace-setup',
  expiresInMs: 60 * 60 * 1_000,
});

// Delegate addPrincipal for 1 hour.
const principalGrant = await cup.delegate({
  from: alice,
  to: setupAgent,
  capability: 'workspace.addPrincipal',
  operations: ['execute'],
  purpose: 'initial-workspace-setup',
  expiresInMs: 60 * 60 * 1_000,
});

console.log('Grants issued:', resourceGrant.id, principalGrant.id);
export { cup, alice, setupAgent, resourceGrant, principalGrant };
```

### Agent adds resources and principals via MCP

The agent now calls `tools/call` over MCP. CUP re-authorizes each call against the current policy and the delegation grant.

```ts
// agent-setup.ts
import { server, cup, alice, setupAgent, resourceGrant, principalGrant } from './alice-delegates.js';
import { subject } from '@capability-ui/core';

// --- Step 1: Add a contacts resource ---
const addContactsResult = await server.handle({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    subjectId: setupAgent.id,
    name: 'workspace.addResource',
    arguments: {
      resourceId: 'crm.contacts',
      name: 'CRM Contacts',
      sensitivity: 'confidential',
    },
    context: { purpose: 'initial-workspace-setup' },
  },
});
console.log('Add contacts:', JSON.parse((addContactsResult.result as any).content[0].text).status);

// --- Step 2: Add a new principal (Bob, a member) ---
const addBobResult = await server.handle({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: {
    subjectId: setupAgent.id,
    name: 'workspace.addPrincipal',
    arguments: { principalId: 'user:bob', role: 'member' },
    context: { purpose: 'initial-workspace-setup' },
  },
});
console.log('Add Bob:', JSON.parse((addBobResult.result as any).content[0].text).status);

// --- Step 3: Agent revokes its own grants when done ---
cup.revokeGrant(resourceGrant.id);
cup.revokeGrant(principalGrant.id);
console.log('Grants revoked. Agent authority ended.');
```

---

## Stage 3: Alice defines policies for the new principals

Bob now exists as a principal but holds no policies. His first interaction is a denial:

```ts
// bob-before-policy.ts
import { cup } from './alice-delegates.js';
import { subject } from '@capability-ui/core';

const bob = subject('user:bob', { role: 'member', workspaceId: 'acme' });

// Bob tries to discover the registry. He gets denied.
const decision = await cup.authorize({
  subject: bob,
  operation: 'discover',
  resource: { id: 'workspace.registry' },
  context: {},
});
console.log(decision.effect, decision.reasonCode);
// deny NO_MATCHING_ALLOW
```

Alice grants Bob read-only access to the contacts resource with field redaction:

```ts
// alice-grants-bob.ts
import { cup } from './alice-delegates.js';
import { redact } from '@capability-ui/core';

// Bob can discover and read contacts but not phone numbers.
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
  obligations: [redact(['phone', 'personalEmail'])],
  priority: 50,
});

// Bob cannot execute any capability -- no policy exists for that yet.
console.log('Bob policy applied.');
```

---

## Stage 4: Bob reads data through MCP (allowed and denied paths)

Bob connects to the MCP server and lists resources:

```ts
// bob-mcp-session.ts
import { server } from './mcp-setup.js';

// Bob lists resources -- only contacts appears because that is
// the only resource he may discover.
const listResult = await server.handle({
  jsonrpc: '2.0',
  id: 1,
  method: 'resources/list',
  params: { subjectId: 'user:bob', context: { workspaceId: 'acme' } },
});
const resources = (listResult.result as { resources: unknown[] }).resources;
console.log('Bob sees:', resources.length, 'resource(s)');
// Bob sees: 1 resource(s)

// Bob reads contacts. Phone numbers are redacted.
const readResult = await server.handle({
  jsonrpc: '2.0',
  id: 2,
  method: 'resources/read',
  params: {
    subjectId: 'user:bob',
    uri: 'cup://crm.contacts',
    context: { workspaceId: 'acme' },
  },
});
console.log('Bob read result:', readResult.result);
// phone and personalEmail fields will be absent from each record.

// Bob tries to call a tool he has no policy for.
const toolDenied = await server.handle({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: {
    subjectId: 'user:bob',
    name: 'workspace.addResource',
    arguments: { resourceId: 'crm.leads', name: 'Leads', sensitivity: 'confidential' },
    context: {},
  },
});
console.log('Tool denied:', JSON.parse((toolDenied.result as any).content[0].text).status);
// Tool denied: denied
```

---

## Stage 5: Adding new principals and narrowing scope over time

As the workspace grows, Alice adds a read-only external contractor (Carol) with a time-limited, scope-bound policy:

```ts
// carol-limited-access.ts
import { cup } from './alice-delegates.js';
import { redact } from '@capability-ui/core';

const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();

cup.policy.allow({
  id: 'carol-discover-contacts',
  principal: { id: 'user:carol' },
  operation: 'discover',
  resource: { id: 'crm.contacts' },
  priority: 30,
  expiresAt: thirtyDaysFromNow,
});
cup.policy.allow({
  id: 'carol-read-contacts-limited',
  principal: { id: 'user:carol' },
  operation: 'read',
  resource: { id: 'crm.contacts' },
  scope: { workspaceId: 'acme' },
  obligations: [redact(['phone', 'personalEmail', 'internalNotes'])],
  priority: 30,
  expiresAt: thirtyDaysFromNow,
  // validDuring lets you restrict access to business hours (UTC).
  validDuring: { startsAt: '2026-01-01T08:00:00Z', endsAt: '2026-12-31T18:00:00Z' },
});

console.log('Carol granted limited 30-day access.');
```

---

## Stage 6: An agent executes a capability with confirmation

Alice wants the setup agent to create a new project using the prepare/confirm/execute sequence. This is the safe path for side-effecting operations:

```ts
// safe-execute.ts
import { cup, alice, setupAgent, resourceGrant } from './alice-delegates.js';

// Re-issue a fresh short-lived grant for this specific task.
const taskGrant = await cup.delegate({
  from: alice,
  to: setupAgent,
  capability: 'workspace.addResource',
  operations: ['execute'],
  purpose: 'add-projects-resource',
  expiresInMs: 5 * 60_000, // 5 minutes
});

// Step 1: Prepare -- validates schema and returns an input hash.
const prepared = await cup.prepare({
  subject: setupAgent,
  capability: 'workspace.addResource',
  input: { resourceId: 'projects.board', name: 'Projects Board', sensitivity: 'internal' },
  purpose: 'add-projects-resource',
  context: {},
});
console.log('Preview sideEffects:', prepared.preview.sideEffects);

// Step 2: The agent presents the preview to the user.
// Alice's UI displays: "Creates a new resource entry in the registry"
// Alice clicks Approve.

// Step 3: Execute with the confirmation bound to the exact input hash.
const receipt = await cup.execute({
  ...prepared.request,
  delegation: taskGrant,
  confirmation: { inputHash: prepared.inputHash, confirmedBy: alice.id },
  idempotencyKey: 'add-projects-board-v1',
  context: {},
});
console.log('Receipt status:', receipt.status);
// Receipt status: succeeded

// The grant expires after 5 minutes; revoke it immediately.
cup.revokeGrant(taskGrant.id);
```

---

## Stage 7: Checking the audit trail

Every operation produces a receipt. You can query by actor or capability:

```ts
// audit.ts
import { cup, alice } from './alice-delegates.js';

// All receipts for Alice.
const aliceReceipts = cup.receipts.find?.({ actorId: alice.id }) ?? [];
console.log('Alice receipts:', aliceReceipts.length);

// All receipts for the addResource capability.
const resourceReceipts = cup.receipts.find?.({ capability: 'workspace.addResource' }) ?? [];
console.log('addResource receipts:', resourceReceipts.length);

// In production, use PostgresPersistence.receipts() instead.
// PostgresPersistence writes to cup_receipts with an index on actor_id and created_at.
```

---

## Stage 8: Revoking access

When Carol's contract ends early, Alice removes her access. CUP's fail-closed design means the next execution is denied immediately -- there is no cache to flush:

```ts
// revoke-carol.ts
import { cup } from './alice-delegates.js';

// Adding an explicit deny at higher priority overrides the allow.
cup.policy.deny({
  id: 'carol-revoked',
  principal: { id: 'user:carol' },
  operation: 'read',
  resource: { id: 'crm.contacts' },
  priority: 200,
});

// Verify: Carol's next read is denied.
import { subject } from '@capability-ui/core';
const carol = subject('user:carol', { workspaceId: 'acme' });
const decision = await cup.authorize({
  subject: carol,
  operation: 'read',
  resource: { id: 'crm.contacts' },
  context: {},
});
console.log(decision.effect, decision.reasonCode);
// deny EXPLICIT_DENY
```

For delegation grants, use `cup.revokeGrant(grantId)` (in-memory) or `persistence.revokeGrant(grantId)` (PostgreSQL) to remove a grant before it expires.

---

## Stage 9: Connecting a SQL-backed production system

In production, swap the in-memory stores for the PostgreSQL persistence layer:

```ts
// production.ts
import {
  CapabilityUI,
  PostgresPersistence,
  CUP_POSTGRES_SCHEMA,
  MemoryReceiptSink,
} from '@capability-ui/core';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

// Run the schema migration once on startup (idempotent).
// In production: use a migration tool (Flyway, Liquibase, node-pg-migrate).
await sql.unsafe(CUP_POSTGRES_SCHEMA);

const db = {
  query: async <T>(query: string, values?: readonly unknown[]) => {
    const rows = await sql.unsafe(query, values as unknown[]) as T[];
    return { rows };
  },
};
const persistence = new PostgresPersistence(db);

// Load resources and policies from the database at startup.
// Your application writes them via SQL migrations or admin API.
const cup = new CapabilityUI({
  receipts: {
    append: (receipt) => persistence.appendReceipt(receipt),
    all: () => [], // not used in production; use persistence.receipts()
    find: () => [],
  },
});

// Register resources loaded from the DB.
const resources = await persistence.resources();
for (const resource of resources) cup.register(resource);

// Load policies from the DB and apply them.
const policies = await persistence.policies();
for (const policy of policies) {
  if (policy.effect === 'allow') cup.policy.allow(policy);
  else cup.policy.deny(policy);
}

export { cup, persistence };
```

---

## Key principles this walkthrough demonstrates

| CUP concept | Where it appeared |
|---|---|
| Deny by default | Stage 1: Bob sees nothing until Alice grants access |
| Separation of discover / read / execute | Stages 2-4: each operation is a distinct policy decision |
| Delegation and attenuation | Stage 2: agent receives only what Alice explicitly grants |
| Revocation | Stage 2: grants removed when setup completes; Stage 8: Carol denied |
| Confirmation and input hashing | Stage 6: execute only proceeds when the preview is approved |
| Field-level redaction | Stage 3-4: phone and email stripped before Bob or Carol receives data |
| Idempotency | Stage 6: safe to retry without creating a duplicate effect |
| Receipts | Stage 7: full audit trail for every decision |
| Time-limited and scoped policies | Stage 5: Carol's access has an expiry and a validity window |
| MCP as a wire format, not the authority | Stages 2-4: MCP routes the request; CUP makes the decision |
| SQL persistence | Stage 9: production stores with a durable schema |

The same `cup` instance powers the web renderer, the MCP server, the agent executor, and the SQL persistence layer. Nothing in the wire format changes the authorization sequence.
