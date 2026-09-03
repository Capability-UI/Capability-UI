# Capability UI Core

Agent-neutral authorization and execution primitives for capability-driven generative interfaces.

CUP does not create, host, schedule, or manage agents. It can register an existing agent runtime as a resource, assign that agent a principal identity, and govern which data and capabilities the agent may discover, read, invoke, or delegate.

## Implementation status

Version `0.2.0` is a dependency-free protocol runtime with an in-memory reference engine and PostgreSQL persistence primitives. It implements the CUP semantic core: resource and capability registration, deterministic policy evaluation, authorized views, field redaction, guarded execution, confirmation hashes, subject-bound action tokens, delegation, subscriptions, MCP JSON-RPC mapping, adapter contracts, and receipts.

CUP does not currently persist resources or policies to SQL by itself. The host application owns database schemas, migrations, policy loading, transaction boundaries, durable receipt storage, authentication, and provider handlers. The Docusaurus site includes a PostgreSQL schema and repository design in [CUP data model](docs/docs/architecture/data-model.md).

## Implemented features

- Typed resource and capability contracts
- Separate `discover`, `inspect`, `read`, `execute`, `share`, and `delegate` operations
- Deny-by-default policy evaluation (`denyByDefault()` alias makes intent explicit)
- Explicit deny precedence at equal priority
- Subject matching by ID, role, type, or wildcard
- Authorized projections for agents and renderers
- Schema and side-effect metadata on capabilities
- `prepare()` and `execute()` for guarded actions
- Confirmation binding to an input hash
- Field-level `writable` permissions on authorized views
- `Projector.redact()` to apply field obligations outside the read path
- Receipt generation through an in-memory or injected receipt sink
- Delegation grants with purpose, expiration, operation, and scope limits
- `revokeGrant()` to invalidate a grant before it expires (in-memory and PostgreSQL)
- `resources/templates/list` MCP method for inspectable resource schemas
- `validDuring` time-window support in PostgreSQL persistence
- No dependency on an agent framework, UI framework, database, or MCP implementation

## Learn by example

The [from zero to production](docs/docs/build/from-zero-to-production.md) walkthrough starts with one owner, one resource, and full authority. Path A grows that system with host library calls. Path B uses CUP code only in Stage 1, then shows the rest as user messages and MCP tool calls and responses.

## Install

```bash
npm install @capability-ui/core
```

## Read data

```ts
import { CapabilityUI, type Resource, type Subject } from '@capability-ui/core';

const cup = new CapabilityUI();
const john: Subject = {
  id: 'user:john', type: 'user', authenticated: true,
  attributes: { workspaceId: 'acme' }
};

const contacts: Resource = {
  id: 'crm.contacts', type: 'data', version: '1.0',
  sensitivity: 'confidential',
  schema: { type: 'object' },
  read: async ({ scope }) => db.contacts.findMany({
    where: { workspaceId: scope?.workspaceId }
  })
};
cup.register(contacts);

// Discovery and reading are separate policy decisions.
cup.policy.allow({
  id: 'john-discover-contacts', principal: { id: john.id },
  operation: 'discover', resource: { id: contacts.id }, priority: 10
});
cup.policy.allow({
  id: 'john-read-contacts', principal: { id: john.id },
  operation: 'read', resource: { id: contacts.id },
  scope: { workspaceId: 'acme' }, priority: 10
});

const result = await cup.read({
  subject: john, resource: contacts.id,
  scope: { workspaceId: 'acme' }, fields: ['id', 'name'],
  purpose: 'contact_lookup', context: { channel: 'web' }
});
```

## Execute a tool

```ts
import { CapabilityUI, defineCapability, subject } from '@capability-ui/core';

const cup = new CapabilityUI();
const john = subject('user:john');
let sent = false;

cup.register(defineCapability({
  id: 'mail.send', operation: 'execute',
  inputSchema: { type: 'object', required: ['to', 'body'] },
  outputSchema: { type: 'object' },
  sensitivity: 'confidential', sideEffects: ['external_message'],
  risk: 'high', confirmation: 'explicit', idempotency: 'required',
  reversibility: 'irreversible',
  handler: async input => { sent = true; return { sent, input }; }
}));
cup.policy.allow({
  id: 'john-send-mail', principal: { id: john.id },
  operation: 'execute', resource: { id: 'mail.send' }, priority: 10
});

const input = { to: ['person@example.com'], body: 'Hello' };
const prepared = await cup.prepare({
  subject: john, capability: 'mail.send', input,
  purpose: 'personal_message', context: { channel: 'web' }
});
const receipt = await cup.execute({
  ...prepared.request,
  confirmation: { inputHash: prepared.inputHash, confirmedBy: john.id }
});
```

## Use an external agent runtime

CUP supplies the policy boundary, not the agent loop:

```ts
import { CapabilityUI, subject, type Resource } from '@capability-ui/core';

const cup = new CapabilityUI();
const agentResource: Resource = {
  id: 'agent:research', type: 'agent', version: '1.0',
  sensitivity: 'confidential', schema: {
    type: 'object', properties: { task: { type: 'string' } }
  }, metadata: {
    runtime: 'external-framework', endpoint: 'https://agent.example/mcp',
    supportedTasks: ['research'], risk: 'medium'
  }
};
cup.register(agentResource);

// The host supplies LangGraph, AutoGen, CrewAI, an SDK, or a custom runtime.
// CUP authorizes the call around that runtime.
const result = await cup.execute({
  subject: subject('user:john'), capability: 'agent.research.invoke',
  input: { task: 'summarize public sources' }, context: {
    purpose: 'market_scan'
  }
});
```

## Specification

The complete specification is versioned with the repository in [`SPECIFICATION.md`](SPECIFICATION.md) and [`specification/index.html`](specification/index.html). The Docusaurus site serves it at `/specification/`.


The comprehensive developer documentation lives in `docs/` and builds with Docusaurus 3.

```bash
cd docs
npm install
npm run start       # local development server
npm run typecheck
npm run build       # production static site
npm run serve       # serve the production build locally
```

The docs cover the complete runtime flow, resource and capability modeling, authorization, scopes, redaction, confirmations, delegation, external agent runtimes, MCP, receipts, subscriptions, testing, and production hardening.

## Development

```bash
npm install
npm test       # build and run the Node test suite
npm run check  # TypeScript type check without emitting files
npm run build  # emit dist/ and declaration files
```

The package is an early reference implementation. Authentication and identity proofing remain host responsibilities. Persistent policy and receipt stores, production transport deployment, and framework-specific renderers or agent-runtime adapters can be supplied through the exported interfaces.
