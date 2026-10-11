import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANONYMOUS_ACTOR,
  CapabilityUI,
  type Capability,
  type Resource,
  type Subject,
  type Receipt,
  defineCapability,
  capabilityToTool,
  canonicalConfirmationHash,
  canonicalInputHash,
  createMCPServer,
  hashesMatch,
  MemoryActionTokenService,
  MemoryReceiptSink,
  pickIdsAndCounts,
  PostgresPersistence,
  CUP_POSTGRES_SCHEMA,
  OPERATIONS,
  scrubReceiptsForResource,
  stripReceiptContent,
  subject,
} from '../src/index.js';

const john: Subject = {
  id: 'user:john', type: 'user', authenticated: true,
  attributes: { role: 'owner', workspaceId: 'acme' }
};
const other: Subject = {
  id: 'user:other', type: 'user', authenticated: true,
  attributes: { role: 'member', workspaceId: 'other' }
};

function notes(): Resource {
  return {
    id: 'notes.john', type: 'data', version: '1.0',
    sensitivity: 'personal', owner: john.id,
    schema: { type: 'object', properties: { title: { type: 'string' } } }
  };
}

function sendMail(handler: (input: unknown) => Promise<unknown>): Capability {
  return {
    id: 'mail.send', type: 'capability', version: '1.0',
    operation: 'execute', sensitivity: 'confidential',
    schema: { type: 'object' }, inputSchema: { type: 'object' },
    outputSchema: { type: 'object' }, sideEffects: ['external_message'],
    risk: 'high', confirmation: 'explicit', idempotency: 'required',
    reversibility: 'irreversible', handler
  };
}

test('denies by default and returns a reason', async () => {
  const cup = new CapabilityUI();
  cup.register(notes());
  const decision = await cup.authorize({
    subject: other, operation: 'read', resource: { id: 'notes.john' }, context: {}
  });
  assert.equal(decision.effect, 'deny');
  assert.equal(decision.reasonCode, 'NO_MATCHING_ALLOW');
});

test('projects only discoverable resources and allowed capabilities', async () => {
  const cup = new CapabilityUI();
  cup.register(notes());
  cup.policy.allow({
    id: 'john-discover-notes', principal: { id: john.id },
    operation: 'discover', resource: { id: 'notes.john' }, priority: 10
  });
  cup.policy.allow({
    id: 'john-read-notes', principal: { id: john.id },
    operation: 'read', resource: { id: 'notes.john' }, priority: 10
  });
  const view = await cup.project({ subject: john, goal: 'read notes', context: {} });
  assert.equal(view.resources.length, 1);
  assert.equal(view.resources[0]?.ref.id, 'notes.john');
  assert.equal(view.resources[0]?.visibility, 'readable');
});

test('deny overrides allow at equal priority', async () => {
  const cup = new CapabilityUI(); cup.register(notes());
  cup.policy.allow({ id: 'allow', principal: { id: john.id }, operation: 'read', resource: { id: 'notes.john' }, priority: 10 });
  cup.policy.deny({ id: 'deny', principal: { id: john.id }, operation: 'read', resource: { id: 'notes.john' }, priority: 10 });
  const result = await cup.authorize({ subject: john, operation: 'read', resource: { id: 'notes.john' }, context: {} });
  assert.equal(result.effect, 'deny');
  assert.equal(result.reasonCode, 'EXPLICIT_DENY');
});

test('execute validates authorization and writes a receipt', async () => {
  let calls = 0;
  const cup = new CapabilityUI();
  cup.register(sendMail(async () => { calls++; return { providerId: 'm1' }; }));
  cup.policy.allow({ id: 'john-mail', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const receipt = await cup.execute({
    subject: john, capability: 'mail.send',
    input: { to: ['a@example.com'], body: 'Hello' },
    idempotencyKey: 'mail-test-1',
    confirmation: { inputHash: 'wrong', confirmedBy: john.id }, context: {}
  });
  assert.equal(receipt.status, 'denied');
  assert.equal(calls, 0);
  assert.equal(cup.receipts.all().length, 1);
});

test('execute invokes an allowed capability with a matching confirmation', async () => {
  const seen: unknown[] = [];
  const cup = new CapabilityUI();
  cup.register(sendMail(async input => { seen.push(input); return { sent: true }; }));
  cup.policy.allow({ id: 'john-mail', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const input = { to: ['a@example.com'], body: 'Hello' };
  const prepared = await cup.prepare({ subject: john, capability: 'mail.send', input, context: {} });
  const receipt: Receipt = await cup.execute({
    subject: john, capability: 'mail.send', input,
    idempotencyKey: 'mail-test-2',
    confirmation: { inputHash: prepared.inputHash, confirmedBy: john.id }, context: {}
  });
  assert.equal(receipt.status, 'succeeded');
  assert.equal(receipt.operation, 'execute');
  assert.deepEqual(seen, [input]);
  assert.equal('input' in receipt, false);
});

test('policy scope must match the request scope', async () => {
  const cup = new CapabilityUI();
  cup.register(notes());
  cup.policy.allow({ id: 'acme-read', principal: { id: john.id }, operation: 'read', resource: { id: 'notes.john' }, scope: { workspaceId: 'acme' }, priority: 10 });
  const denied = await cup.authorize({ subject: john, operation: 'read', resource: { id: 'notes.john' }, scope: { workspaceId: 'other' }, context: {} });
  assert.equal(denied.effect, 'deny');
});

test('read applies redact obligations before returning records', async () => {
  const cup = new CapabilityUI();
  cup.register({ ...notes(), read: async () => [{ title: 'Brief', secret: 'hidden' }] });
  cup.policy.allow({ id: 'john-read', principal: { id: john.id }, operation: 'read', resource: { id: 'notes.john' }, obligations: [{ type: 'redact', fields: ['secret'] }], priority: 10 });
  const result = await cup.read({ subject: john, resource: 'notes.john', context: {} });
  assert.deepEqual(result.items, [{ title: 'Brief' }]);
});

test('delegation attenuates the recipient scope', async () => {
  const cup = new CapabilityUI(); cup.register(notes());
  cup.policy.allow({ id: 'john-delegate', principal: { id: john.id }, operation: 'delegate', resource: { id: 'notes.john' }, priority: 10 });
  const grant = await cup.delegate({
    from: john, to: other, capability: 'notes.john',
    operations: ['read'], scope: { fields: ['title'] }, purpose: 'briefing', expiresInMs: 60_000
  });
  assert.equal(grant.to.id, other.id);
  assert.deepEqual(grant.scope!.fields, ['title']);
});

test('rejects unauthenticated protected requests', async () => {
  const cup = new CapabilityUI(); cup.register(notes());
  const anonymous = { ...john, authenticated: false };
  const decision = await cup.authorize({ subject: anonymous, operation: 'read', resource: { id: 'notes.john' }, context: {} });
  assert.equal(decision.reasonCode, 'NO_ACCOUNT');
});

test('canonicalizes nested input keys for confirmation', async () => {
  const cup = new CapabilityUI(); let calls = 0;
  cup.register({ ...sendMail(async () => { calls++; return { ok: true }; }), inputSchema: { type: 'object' } });
  cup.policy.allow({ id: 'mail', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const first = { message: { subject: 'Hi', body: 'Hello' } };
  const prepared = await cup.prepare({ subject: john, capability: 'mail.send', input: first, context: {} });
  const reordered = { message: { body: 'Hello', subject: 'Hi' } };
  const result = await cup.execute({ ...prepared.request, input: reordered, idempotencyKey: 'mail-test-3', confirmation: { inputHash: prepared.inputHash, confirmedBy: john.id } });
  assert.equal(result.status, 'succeeded'); assert.equal(calls, 1);
});

test('rejects an execution after its prepared policy version becomes stale', async () => {
  const cup = new CapabilityUI(); cup.register(sendMail(async () => ({ ok: true })));
  cup.policy.allow({ id: 'mail', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const prepared = await cup.prepare({ subject: john, capability: 'mail.send', input: { to: ['a@example.com'], body: 'Hi' }, context: {} });
  cup.policy.deny({ id: 'revoked', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 20 });
  const result = await cup.execute({ ...prepared.request, idempotencyKey: 'mail-test-4', confirmation: { inputHash: prepared.inputHash, confirmedBy: john.id } });
  assert.equal(result.decision.reasonCode, 'PREPARED_DECISION_STALE');
});

test('enforces stored delegation grants during execution', async () => {
  const cup = new CapabilityUI(); let calls = 0;
  cup.register(defineCapability({ id: 'notes.read', version: '1.0', sensitivity: 'personal', schema: { type: 'object' }, operation: 'execute', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, sideEffects: [], risk: 'low', confirmation: 'none', idempotency: 'none', reversibility: 'reversible', handler: async () => { calls++; return { ok: true }; } }));
  cup.policy.allow({ id: 'delegate', principal: { id: john.id }, operation: 'delegate', resource: { id: 'notes.read' }, priority: 10 });
  const grant = await cup.delegate({ from: john, to: other, capability: 'notes.read', operations: ['execute'], purpose: 'briefing', expiresInMs: 60_000 });
  const result = await cup.execute({ subject: other, capability: 'notes.read', input: {}, purpose: 'briefing', delegation: grant, context: {} });
  assert.equal(result.status, 'succeeded'); assert.equal(calls, 1);
});

test('serves authorized tools through MCP JSON-RPC', async () => {
  const cup = new CapabilityUI();
  cup.register(defineCapability({ id: 'notes.summarize', version: '1.0', sensitivity: 'personal', schema: { type: 'object' }, operation: 'execute', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, sideEffects: [], risk: 'low', confirmation: 'none', idempotency: 'none', reversibility: 'reversible', handler: async () => ({ summary: 'done' }) }));
  cup.policy.allow({ id: 'mcp-tool', principal: { id: 'service:mcp' }, operation: 'execute', resource: { id: 'notes.summarize' }, priority: 10 });
  const server = createMCPServer({ name: 'test', cup });
  const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal((response.result as { tools: unknown[] }).tools.length, 1);
});

test('issues and enforces a subject-bound action token', async () => {
  const cup = new CapabilityUI();
  cup.register({ ...sendMail(async () => ({ sent: true })), confirmation: 'none' });
  cup.policy.allow({ id: 'john-mail', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const view = await cup.project({ subject: john, context: {} });
  const token = view.capabilities[0]?.actionToken;
  assert.ok(token);
  const denied = await cup.execute({ subject: other, capability: 'mail.send', input: {}, actionToken: token, idempotencyKey: 'token-test', context: {} });
  assert.equal(denied.status, 'denied');
  assert.equal(denied.decision.reasonCode, 'INVALID_ACTION_TOKEN');
});

test('queries in-memory receipts by actor and capability', async () => {
  const cup = new CapabilityUI();
  cup.register({ ...notes(), read: async () => [{ title: 'Brief' }] });
  cup.policy.allow({ id: 'john-read', principal: { id: john.id }, operation: 'read', resource: { id: 'notes.john' }, priority: 10 });
  await cup.read({ subject: john, resource: 'notes.john', context: {} });
  const receipts = cup.receipts.find?.({ actorId: john.id, capability: 'notes.john' });
  assert.equal(receipts?.length, 1);
});

test('action token service binds audience and policy version', () => {
  const service = new MemoryActionTokenService();
  const now = new Date();
  const token = service.issue({ capabilityId: 'mail.send', subjectId: john.id, policyVersion: 'policy-1', audience: 'web', issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() });
  assert.doesNotThrow(() => service.verify(token, { capabilityId: 'mail.send', subjectId: john.id, policyVersion: 'policy-1', audience: 'web' }));
  assert.throws(() => service.verify(token, { capabilityId: 'mail.send', subjectId: john.id, policyVersion: 'policy-2', audience: 'web' }), /INVALID_ACTION_TOKEN/);
});

test('postgres persistence uses parameterized receipt writes', async () => {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const db = { query: async <T>(sql: string, values?: readonly unknown[]) => { calls.push({ sql, values }); return { rows: [] as T[] }; } };
  const store = new PostgresPersistence(db);
  await store.appendReceipt({ id: 'r1', status: 'denied', actor: john, capability: 'mail.send', inputHash: 'hash', decision: { requestId: 'req', effect: 'deny', reasonCode: 'NO_MATCHING_ALLOW', matchedPolicies: [], obligations: [], policyVersion: 'policy-1' }, createdAt: new Date().toISOString() });
  const receiptInsert = calls.find(call => /insert into cup_receipts/i.test(call.sql));
  assert.ok(receiptInsert);
  assert.match(receiptInsert.sql, /values \(\$1,\$2/);
  assert.equal(receiptInsert.values?.[0], 'r1');
  assert.match(CUP_POSTGRES_SCHEMA, /create table if not exists cup_prepared_actions/);
});

test('postgres schema includes durable delegation grants', () => {
  assert.match(CUP_POSTGRES_SCHEMA, /create table if not exists cup_delegation_grants/);
});

test('rejects required-idempotency actions without a key', async () => {
  const cup = new CapabilityUI();
  cup.register(sendMail(async () => ({ sent: true })));
  cup.policy.allow({ id: 'john-mail', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const receipt = await cup.execute({ subject: john, capability: 'mail.send', input: { to: ['a@example.com'], body: 'Hi' }, context: {} });
  assert.equal(receipt.status, 'denied');
  assert.equal(receipt.decision.reasonCode, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('returns the same receipt for a duplicate idempotency key', async () => {
  const cup = new CapabilityUI(); let calls = 0;
  cup.register({ ...sendMail(async () => { calls++; return { sent: true }; }), confirmation: 'none' });
  cup.policy.allow({ id: 'john-mail', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const request = { subject: john, capability: 'mail.send', input: { to: ['a@example.com'], body: 'Hi' }, idempotencyKey: 'same-key', context: {} } as const;
  const first = await cup.execute(request); const second = await cup.execute(request);
  assert.equal(first.id, second.id); assert.equal(calls, 1);
});

test('MCP exposes prompts and session metadata', async () => {
  const cup = new CapabilityUI();
  const server = createMCPServer({ name: 'test', cup, prompts: [{ name: 'brief', description: 'Make a brief', get: args => ({ args }) }] });
  const initialized = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal((initialized.result as { _cup: { session: { transport: string } } })._cup.session.transport, 'streamable_http');
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'prompts/list' });
  assert.equal((listed.result as { prompts: unknown[] }).prompts.length, 1);
  const prompt = await server.handle({ jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: 'brief', arguments: { topic: 'CUP' } } });
  assert.deepEqual(prompt.result, { args: { topic: 'CUP' } });
});

test('uses injected clock and nonce providers', async () => {
  const cup = new CapabilityUI({ clock: () => new Date('2030-01-01T00:00:00Z'), nonce: () => 'fixed-id' });
  const decision = await cup.authorize({ subject: john, operation: 'read', resource: { id: 'missing' }, context: {} });
  assert.equal(decision.requestId, 'fixed-id');
});

test('capability description propagates to the authorized view and tool mapping', async () => {
  const cup = new CapabilityUI();
  cup.register(defineCapability({
    id: 'notes.summarize', version: '1.0', sensitivity: 'personal',
    description: 'Summarize a note into a short abstract.',
    schema: { type: 'object' },
    operation: 'execute', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: [], risk: 'low', confirmation: 'none', idempotency: 'none', reversibility: 'reversible',
    handler: async () => ({ summary: 'done' }),
  }));
  cup.policy.allow({ id: 'john-summarize', principal: { id: john.id }, operation: 'execute', resource: { id: 'notes.summarize' }, priority: 10 });
  const view = await cup.project({ subject: john, context: {} });
  const authorized = view.capabilities.find(capability => capability.id === 'notes.summarize');
  assert.ok(authorized, 'capability should be authorized');
  assert.equal(authorized?.description, 'Summarize a note into a short abstract.');
  const tool = capabilityToTool(authorized!);
  assert.equal(tool.description, 'Summarize a note into a short abstract.');
});

test('tool mapping falls back to a synthesized description when none is set', async () => {
  const cup = new CapabilityUI();
  cup.register(defineCapability({
    id: 'notes.archive', version: '1.0', sensitivity: 'personal',
    schema: { type: 'object' },
    operation: 'execute', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: [], risk: 'medium', confirmation: 'none', idempotency: 'none', reversibility: 'reversible',
    handler: async () => ({ archived: true }),
  }));
  cup.policy.allow({ id: 'john-archive', principal: { id: john.id }, operation: 'execute', resource: { id: 'notes.archive' }, priority: 10 });
  const view = await cup.project({ subject: john, context: {} });
  const authorized = view.capabilities.find(capability => capability.id === 'notes.archive');
  assert.equal(authorized?.description, undefined);
  assert.equal(capabilityToTool(authorized!).description, 'notes.archive (medium risk)');
});

test('executes a separately authorized reversal capability', async () => {
  const cup = new CapabilityUI();
  let reversed = false;
  cup.register({ id: 'task.create', type: 'capability', version: '1', sensitivity: 'personal', schema: { type: 'object' }, operation: 'create', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, sideEffects: ['Creates a task'], risk: 'medium', confirmation: 'none', idempotency: 'required', reversibility: 'reversible', reverseCapability: 'task.delete', handler: async () => ({ taskId: 't1' }) });
  cup.register({ id: 'task.delete', type: 'capability', version: '1', sensitivity: 'personal', schema: { type: 'object' }, operation: 'delete', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, sideEffects: ['Deletes a task'], risk: 'high', confirmation: 'none', idempotency: 'required', reversibility: 'irreversible', handler: async () => { reversed = true; return { deleted: true }; } });
  cup.policy.allow({ id: 'create', principal: { id: john.id }, operation: 'create', resource: { id: 'task.create' }, priority: 10 });
  cup.policy.allow({ id: 'delete', principal: { id: john.id }, operation: 'delete', resource: { id: 'task.delete' }, priority: 10 });
  const original = await cup.execute({ subject: john, capability: 'task.create', input: {}, idempotencyKey: 'create-1', context: {} });
  const undone = await cup.reverse(original.id, { subject: john, idempotencyKey: 'delete-1', context: {} });
  assert.equal(undone.status, 'succeeded');
  assert.equal(reversed, true);
});

test('read receipts set operation and omit the query payload', async () => {
  const cup = new CapabilityUI();
  cup.register({ ...notes(), read: async () => [{ title: 'Brief' }] });
  cup.policy.allow({ id: 'john-read', principal: { id: john.id }, operation: 'read', resource: { id: 'notes.john' }, priority: 10 });
  await cup.read({ subject: john, resource: 'notes.john', query: { q: 'secret-search' }, context: {} });
  const receipt = cup.receipts.all()[0];
  assert.equal(receipt?.operation, 'read');
  assert.equal(receipt?.status, 'succeeded');
  assert.equal(JSON.stringify(receipt).includes('secret-search'), false);
});

test('denied read writes a receipt then throws', async () => {
  const cup = new CapabilityUI();
  cup.register({ ...notes(), read: async () => [{ title: 'Brief' }] });
  await assert.rejects(() => cup.read({ subject: other, resource: 'notes.john', query: { q: 'hidden' }, context: {} }), /CUP_NOT_AUTHORIZED:NO_MATCHING_ALLOW/);
  const receipt = cup.receipts.all()[0];
  assert.equal(receipt?.status, 'denied');
  assert.equal(receipt?.operation, 'read');
  assert.equal(receipt?.capability, 'notes.john');
  assert.equal(receipt?.actor.id, other.id);
  assert.equal(receipt?.decision.reasonCode, 'NO_MATCHING_ALLOW');
  assert.equal(receipt?.resultSummary, undefined);
  assert.equal(receipt?.inputHash, undefined);
  assert.equal(JSON.stringify(receipt).includes('hidden'), false);
});

test('unauthenticated execute records a denied NO_ACCOUNT receipt', async () => {
  const cup = new CapabilityUI();
  cup.register({ ...sendMail(async () => ({ sent: true })), confirmation: 'none', idempotency: 'none' });
  const guest = { ...john, authenticated: false };
  const receipt = await cup.execute({ subject: guest, capability: 'mail.send', input: { body: 'secret-body' }, context: {} });
  assert.equal(receipt.status, 'denied');
  assert.equal(receipt.operation, 'execute');
  assert.equal(receipt.decision.reasonCode, 'NO_ACCOUNT');
  assert.deepEqual(receipt.actor, ANONYMOUS_ACTOR);
  assert.equal(receipt.resultSummary, undefined);
  assert.equal(JSON.stringify(receipt).includes('secret-body'), false);
});

test('denied receipts can be disabled on the server', async () => {
  const cup = new CapabilityUI({ writeDeniedReceipts: false });
  cup.register({ ...notes(), read: async () => [] });
  await assert.rejects(() => cup.read({ subject: other, resource: 'notes.john', context: {} }), /CUP_NOT_AUTHORIZED/);
  assert.equal(cup.receipts.all().length, 0);
});

test('denied-receipt writer can sample guest denials', async () => {
  let seen = 0;
  const cup = new CapabilityUI({
    writeDeniedReceipts: context => {
      seen += 1;
      return context.actor.id === john.id;
    },
  });
  cup.register(sendMail(async () => ({ sent: true })));
  await cup.execute({ subject: other, capability: 'mail.send', input: {}, context: {} });
  await cup.execute({ subject: john, capability: 'mail.send', input: {}, context: {} });
  assert.equal(seen, 2);
  assert.equal(cup.receipts.all().length, 1);
  assert.equal(cup.receipts.all()[0]?.actor.id, john.id);
});

test('update, delete, and move are first-class operations', async () => {
  const cup = new CapabilityUI();
  const deleted: string[] = [];
  cup.register(defineCapability({
    id: 'notes.update', version: '1.0', sensitivity: 'personal', schema: { type: 'object' },
    operation: 'update', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: ['Updates a note'], idempotency: 'none', reversibility: 'reversible',
    handler: async input => ({ id: (input as { id: string }).id, updated: true, body: 'secret' }),
  }));
  cup.register(defineCapability({
    id: 'notes.delete', version: '1.0', sensitivity: 'personal', schema: { type: 'object' },
    operation: 'delete', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: ['Deletes a note'], idempotency: 'none', reversibility: 'irreversible',
    handler: async input => { deleted.push((input as { id: string }).id); return { id: (input as { id: string }).id, body: 'gone' }; },
  }));
  cup.register(defineCapability({
    id: 'notes.move', version: '1.0', sensitivity: 'personal', schema: { type: 'object' },
    operation: 'move',
    inputSchema: { type: 'object', required: ['id', 'toType'], properties: { id: { type: 'string' }, toType: { type: 'string' } } },
    outputSchema: { type: 'object' },
    sideEffects: ['Moves a note'], risk: 'medium', confirmation: 'none', idempotency: 'none', reversibility: 'irreversible',
    handler: async input => ({ id: (input as { id: string }).id, toType: (input as { toType: string }).toType }),
  }));
  cup.policy.allow({ id: 'u', principal: { id: john.id }, operation: 'update', resource: { id: 'notes.update' }, priority: 10 });
  cup.policy.allow({ id: 'd', principal: { id: john.id }, operation: 'delete', resource: { id: 'notes.delete' }, priority: 10 });
  cup.policy.allow({ id: 'm', principal: { id: john.id }, operation: 'move', resource: { id: 'notes.move' }, priority: 10 });
  cup.policy.allow({ id: 'du', principal: { id: john.id }, operation: 'discover', resource: { id: 'notes.update' }, priority: 10 });
  cup.policy.allow({ id: 'dd', principal: { id: john.id }, operation: 'discover', resource: { id: 'notes.delete' }, priority: 10 });
  cup.policy.allow({ id: 'dm', principal: { id: john.id }, operation: 'discover', resource: { id: 'notes.move' }, priority: 10 });

  const listed = await cup.discover({ subject: john, context: {} });
  assert.deepEqual(listed.map(item => item.ref.id).sort(), ['notes.delete', 'notes.move', 'notes.update']);

  const view = await cup.project({ subject: john, context: {} });
  assert.deepEqual(view.capabilities.map(item => item.operation).sort(), ['delete', 'move', 'update']);
  const deleteCap = view.capabilities.find(item => item.id === 'notes.delete');
  assert.equal(deleteCap?.risk, 'high');
  assert.equal(deleteCap?.confirmation, 'explicit');

  const updated = await cup.execute({ subject: john, capability: 'notes.update', input: { id: 'n1', body: 'secret' }, context: {} });
  assert.equal(updated.status, 'succeeded');
  assert.equal(updated.operation, 'update');
  assert.deepEqual(updated.resourceRefs, [{ id: 'n1' }]);
  assert.deepEqual(updated.resultSummary, { id: 'n1' });
  assert.equal(JSON.stringify(updated).includes('secret'), false);

  const preparedDelete = await cup.prepare({ subject: john, capability: 'notes.delete', input: { id: 'n1' }, context: {} });
  const deniedDelete = await cup.execute({ subject: john, capability: 'notes.delete', input: { id: 'n1' }, context: {} });
  assert.equal(deniedDelete.status, 'denied');
  assert.equal(deniedDelete.decision.reasonCode, 'CONFIRMATION_REQUIRED');
  const deletedReceipt = await cup.execute({
    subject: john, capability: 'notes.delete', input: { id: 'n1' },
    confirmation: { inputHash: preparedDelete.inputHash, confirmedBy: john.id }, context: {},
  });
  assert.equal(deletedReceipt.status, 'succeeded');
  assert.equal(deletedReceipt.operation, 'delete');
  assert.equal(deletedReceipt.resultSummary, undefined);
  assert.deepEqual(deleted, ['n1']);

  const moved = await cup.execute({ subject: john, capability: 'notes.move', input: { id: 'n1', toType: 'archive.notes' }, context: {} });
  assert.equal(moved.status, 'succeeded');
  assert.equal(moved.operation, 'move');
  assert.deepEqual(moved.resourceRefs, [{ id: 'n1' }, { id: 'archive.notes' }]);

  const server = createMCPServer({ name: 'test', cup, authenticate: () => john });
  const initialized = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.deepEqual((initialized.result as { _cup: { operations: string[] } })._cup.operations, [...OPERATIONS]);
  const tools = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = (tools.result as { tools: Array<{ name: string; _cup: { operation: string } }> }).tools;
  assert.equal(names.find(item => item.name === 'notes.move')?._cup.operation, 'move');
});

test('move without id and toType is denied', async () => {
  const cup = new CapabilityUI();
  cup.register(defineCapability({
    id: 'notes.move', version: '1.0', sensitivity: 'personal', schema: { type: 'object' },
    operation: 'move', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: [], risk: 'low', confirmation: 'none', idempotency: 'none', reversibility: 'irreversible',
    handler: async () => ({ ok: true }),
  }));
  cup.policy.allow({ id: 'm', principal: { id: john.id }, operation: 'move', resource: { id: 'notes.move' }, priority: 10 });
  const receipt = await cup.execute({ subject: john, capability: 'notes.move', input: { id: 'n1' }, context: {} });
  assert.equal(receipt.status, 'denied');
  assert.equal(receipt.decision.reasonCode, 'INVALID_INPUT');
});

test('confirmation hashes are HMAC when a host key is configured', async () => {
  const cup = new CapabilityUI({ confirmationKey: 'host-secret' });
  cup.register({ ...sendMail(async () => ({ sent: true })), confirmation: 'explicit' });
  cup.policy.allow({ id: 'mail', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const input = { to: ['a@example.com'], body: 'Hi' };
  const prepared = await cup.prepare({ subject: john, capability: 'mail.send', input, context: {} });
  const bound = canonicalConfirmationHash({ capability: 'mail.send', operation: 'execute', input, policyVersion: cup.policy.version() }, 'host-secret');
  assert.equal(prepared.inputHash, bound);
  assert.notEqual(prepared.inputHash, canonicalInputHash(input, 'host-secret'));
  const denied = await cup.execute({
    subject: john, capability: 'mail.send', input, idempotencyKey: 'hmac-1',
    confirmation: { inputHash: canonicalInputHash(input), confirmedBy: john.id }, context: {},
  });
  assert.equal(denied.status, 'denied');
  const allowed = await cup.execute({
    subject: john, capability: 'mail.send', input, idempotencyKey: 'hmac-2',
    confirmation: { inputHash: prepared.inputHash, confirmedBy: john.id }, context: {},
  });
  assert.equal(allowed.status, 'succeeded');
});

test('stripReceiptContent and scrubReceiptsForResource drop summaries for a hard delete', () => {
  const receipt: Receipt = {
    id: 'r1', status: 'succeeded', actor: { id: john.id, type: 'user' },
    capability: 'notes.delete', operation: 'delete', resourceRefs: [{ id: 'n1' }],
    inputHash: 'abc', decision: { requestId: 'req', effect: 'allow', reasonCode: 'ALLOWED', matchedPolicies: [], obligations: [], policyVersion: 'policy-1' },
    confirmation: { inputHash: 'abc', confirmedBy: john.id },
    resultSummary: { body: 'private note' }, createdAt: '2030-01-01T00:00:00.000Z',
  };
  const otherReceipt: Receipt = { ...receipt, id: 'r2', capability: 'mail.send', operation: 'execute', resourceRefs: [{ id: 'mail.send' }], resultSummary: { sent: true } };
  const stripped = stripReceiptContent(receipt);
  assert.equal(stripped.resultSummary, undefined);
  assert.equal(stripped.confirmation, undefined);
  assert.equal(stripped.inputHash, undefined);
  assert.equal(stripped.id, 'r1');
  assert.equal(stripped.operation, 'delete');
  const scrubbed = scrubReceiptsForResource([receipt, otherReceipt], 'n1');
  assert.equal(scrubbed[0]?.resultSummary, undefined);
  assert.equal(scrubbed[1]?.resultSummary, otherReceipt.resultSummary);
});

test('MemoryReceiptSink.scrubForResource mutates matching receipts', async () => {
  const sink = new MemoryReceiptSink();
  await sink.append({
    id: 'r1', status: 'succeeded', actor: { id: john.id, type: 'user' },
    capability: 'health.record', operation: 'read', resourceRefs: [{ id: 'health.record' }],
    inputHash: 'h', decision: { requestId: 'req', effect: 'allow', reasonCode: 'ALLOWED', matchedPolicies: [], obligations: [], policyVersion: 'policy-1' },
    resultSummary: { notes: 'sensitive' }, createdAt: '2030-01-01T00:00:00.000Z',
  });
  sink.scrubForResource('health.record');
  assert.equal(sink.all()[0]?.resultSummary, undefined);
  assert.equal(sink.all()[0]?.status, 'succeeded');
});

test('unauthenticated execute records an anonymous actor even when a victim id is supplied', async () => {
  const cup = new CapabilityUI();
  cup.register({ ...sendMail(async () => ({ sent: true })), confirmation: 'none', idempotency: 'none' });
  const victim = subject('user:victim', {}, false);
  const receipt = await cup.execute({ subject: victim, capability: 'mail.send', input: { id: 'row-1' }, context: {} });
  assert.equal(receipt.status, 'denied');
  assert.equal(receipt.decision.reasonCode, 'NO_ACCOUNT');
  assert.deepEqual(receipt.actor, ANONYMOUS_ACTOR);
  assert.equal(JSON.stringify(receipt).includes('user:victim'), false);
});

test('confirmation hashes bind capability and operation so archive cannot confirm delete', async () => {
  const cup = new CapabilityUI();
  const input = { id: 'row-1' };
  cup.register(defineCapability({
    id: 'log.archive', version: '1.0', sensitivity: 'personal', schema: { type: 'object' },
    operation: 'execute', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: [], risk: 'high', confirmation: 'explicit', idempotency: 'none', reversibility: 'irreversible',
    handler: async () => ({ archived: true }),
  }));
  cup.register(defineCapability({
    id: 'log.delete', version: '1.0', sensitivity: 'personal', schema: { type: 'object' },
    operation: 'delete', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: [], idempotency: 'none', reversibility: 'irreversible',
    handler: async () => ({ deleted: true }),
  }));
  cup.policy.allow({ id: 'a', principal: { id: john.id }, operation: 'execute', resource: { id: 'log.archive' }, priority: 10 });
  cup.policy.allow({ id: 'd', principal: { id: john.id }, operation: 'delete', resource: { id: 'log.delete' }, priority: 10 });
  const archived = await cup.prepare({ subject: john, capability: 'log.archive', input, context: {} });
  const reused = await cup.execute({
    subject: john, capability: 'log.delete', input,
    confirmation: { inputHash: archived.inputHash, confirmedBy: john.id }, context: {},
  });
  assert.equal(reused.status, 'denied');
  assert.equal(reused.decision.reasonCode, 'CONFIRMATION_REQUIRED');
  const allowed = await cup.execute({
    subject: john, capability: 'log.archive', input,
    confirmation: { inputHash: archived.inputHash, confirmedBy: john.id }, context: {},
  });
  assert.equal(allowed.status, 'succeeded');
});

test('hashesMatch uses equal-length timing-safe compare', () => {
  assert.equal(hashesMatch('abc', 'abc'), true);
  assert.equal(hashesMatch('abc', 'abd'), false);
  assert.equal(hashesMatch('abc', 'ab'), false);
});

test('denied receipt write failures do not replace CUP_NOT_AUTHORIZED', async () => {
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const cup = new CapabilityUI({
      receipts: {
        async append() { throw new Error('fk_violation'); },
        all() { return []; },
      },
    });
    cup.register({ ...notes(), read: async () => [{ title: 'Brief' }] });
    await assert.rejects(() => cup.read({ subject: subject('user:victim', {}, false), resource: 'notes.john', context: {} }), /CUP_NOT_AUTHORIZED:NO_ACCOUNT/);
    assert.equal(logged.length, 1);
    assert.match(String(logged[0]), /CUP denied-receipt write failed/);
    assert.match(String(logged[0]), /fk_violation/);
  } finally {
    console.error = original;
  }
});

test('scrubForResource also scrubs cached idempotent receipts', async () => {
  const cup = new CapabilityUI();
  cup.register({
    ...sendMail(async () => ({ sent: true, body: 'secret-mail' })),
    confirmation: 'none',
    idempotency: 'supported',
  });
  cup.policy.allow({ id: 'mail', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const first = await cup.execute({
    subject: john, capability: 'mail.send', input: { to: ['a@example.com'], body: 'secret-mail' },
    idempotencyKey: 'same-key', context: {},
  });
  assert.ok(first.inputHash);
  cup.scrubForResource('mail.send');
  const replay = await cup.execute({
    subject: john, capability: 'mail.send', input: { to: ['a@example.com'], body: 'secret-mail' },
    idempotencyKey: 'same-key', context: {},
  });
  assert.equal(replay.id, first.id);
  assert.equal(replay.inputHash, undefined);
  assert.equal(replay.resultSummary, undefined);
  assert.equal(JSON.stringify(replay).includes('secret-mail'), false);
});

test('pickIdsAndCounts keeps only string or number ids array elements', () => {
  const summary = pickIdsAndCounts({ ids: [{ id: 'x', note: 'private' }], count: 1 });
  assert.deepEqual(summary, { count: 1 });
  assert.equal(JSON.stringify(summary).includes('private'), false);
  assert.equal(JSON.stringify(summary).includes('"x"'), false);
});

test('delete high-risk explicit confirmation defaults apply on direct register', async () => {
  const cup = new CapabilityUI();
  cup.register({
    id: 'notes.purge', type: 'capability', version: '1.0', sensitivity: 'personal',
    schema: { type: 'object' }, operation: 'delete', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: [], idempotency: 'none', reversibility: 'irreversible',
    handler: async () => ({ ok: true }),
  } as unknown as Capability);
  cup.policy.allow({ id: 'p', principal: { id: john.id }, operation: 'delete', resource: { id: 'notes.purge' }, priority: 10 });
  cup.policy.allow({ id: 'd', principal: { id: john.id }, operation: 'discover', resource: { id: 'notes.purge' }, priority: 10 });
  const view = await cup.project({ subject: john, context: {} });
  const cap = view.capabilities.find(item => item.id === 'notes.purge');
  assert.equal(cap?.risk, 'high');
  assert.equal(cap?.confirmation, 'explicit');
});

test('guest denials use NO_ACCOUNT; authenticated denials use NO_MATCHING_ALLOW; public guest allow still works', async () => {
  const cup = new CapabilityUI();
  cup.register({ ...notes(), id: 'notes.private', read: async () => [{ title: 'private' }] });
  cup.register({ ...notes(), id: 'notes.public', read: async () => [{ title: 'public' }] });
  cup.register({ ...sendMail(async () => ({ sent: true })), confirmation: 'none', idempotency: 'none' });
  cup.register(defineCapability({
    id: 'ping.public', version: '1.0', sensitivity: 'public', schema: { type: 'object' },
    operation: 'execute', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: [], risk: 'low', confirmation: 'none', idempotency: 'none', reversibility: 'irreversible',
    handler: async () => ({ ok: true }),
  }));
  cup.policy.allow({ id: 'public-read', principal: { any: true }, operation: 'read', resource: { id: 'notes.public' }, priority: 10 });
  cup.policy.allow({ id: 'public-discover', principal: { any: true }, operation: 'discover', resource: { id: 'notes.public' }, priority: 10 });
  cup.policy.allow({ id: 'public-exec', principal: { any: true }, operation: 'execute', resource: { id: 'ping.public' }, priority: 10 });
  const guest = subject('user:guest', {}, false);

  const guestDiscover = await cup.authorize({ subject: guest, operation: 'discover', resource: { id: 'notes.private' }, context: {} });
  assert.equal(guestDiscover.reasonCode, 'NO_ACCOUNT');
  const signedInDiscover = await cup.authorize({ subject: other, operation: 'discover', resource: { id: 'notes.private' }, context: {} });
  assert.equal(signedInDiscover.reasonCode, 'NO_MATCHING_ALLOW');
  await assert.rejects(() => cup.subscribe({ subject: guest, resource: 'notes.private', events: ['changed'], context: {} }), /CUP_NOT_AUTHORIZED:NO_ACCOUNT/);
  await assert.rejects(() => cup.subscribe({ subject: other, resource: 'notes.private', events: ['changed'], context: {} }), /CUP_NOT_AUTHORIZED:NO_MATCHING_ALLOW/);
  await assert.rejects(() => cup.read({ subject: guest, resource: 'notes.private', context: {} }), /CUP_NOT_AUTHORIZED:NO_ACCOUNT/);
  await assert.rejects(() => cup.read({ subject: other, resource: 'notes.private', context: {} }), /CUP_NOT_AUTHORIZED:NO_MATCHING_ALLOW/);
  const publicRead = await cup.read({ subject: guest, resource: 'notes.public', context: {} });
  assert.deepEqual(publicRead.items, [{ title: 'public' }]);
  const listed = await cup.discover({ subject: guest, context: {} });
  assert.deepEqual(listed.map(item => item.ref.id), ['notes.public']);

  const guestExec = await cup.execute({ subject: guest, capability: 'mail.send', input: {}, context: {} });
  assert.equal(guestExec.status, 'denied');
  assert.equal(guestExec.decision.reasonCode, 'NO_ACCOUNT');
  const signedInExec = await cup.execute({ subject: other, capability: 'mail.send', input: {}, context: {} });
  assert.equal(signedInExec.status, 'denied');
  assert.equal(signedInExec.decision.reasonCode, 'NO_MATCHING_ALLOW');
  const publicExec = await cup.execute({ subject: guest, capability: 'ping.public', input: {}, context: {} });
  assert.equal(publicExec.status, 'succeeded');
});


