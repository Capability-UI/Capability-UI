import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CapabilityUI,
  type Capability,
  type Resource,
  type Subject,
  type Receipt
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
    id: 'john-discover-notes', effect: 'allow', principal: { id: john.id },
    operation: 'discover', resource: { id: 'notes.john' }, priority: 10
  });
  cup.policy.allow({
    id: 'john-read-notes', effect: 'allow', principal: { id: john.id },
    operation: 'read', resource: { id: 'notes.john' }, priority: 10
  });
  const view = await cup.project({ subject: john, goal: 'read notes', context: {} });
  assert.equal(view.resources.length, 1);
  assert.equal(view.resources[0]?.ref.id, 'notes.john');
  assert.equal(view.resources[0]?.visibility, 'readable');
});

test('deny overrides allow at equal priority', async () => {
  const cup = new CapabilityUI(); cup.register(notes());
  cup.policy.allow({ id: 'allow', effect: 'allow', principal: { id: john.id }, operation: 'read', resource: { id: 'notes.john' }, priority: 10 });
  cup.policy.deny({ id: 'deny', effect: 'deny', principal: { id: john.id }, operation: 'read', resource: { id: 'notes.john' }, priority: 10 });
  const result = await cup.authorize({ subject: john, operation: 'read', resource: { id: 'notes.john' }, context: {} });
  assert.equal(result.effect, 'deny');
  assert.equal(result.reasonCode, 'EXPLICIT_DENY');
});

test('execute validates authorization and writes a receipt', async () => {
  let calls = 0;
  const cup = new CapabilityUI();
  cup.register(sendMail(async () => { calls++; return { providerId: 'm1' }; }));
  cup.policy.allow({ id: 'john-mail', effect: 'allow', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const receipt = await cup.execute({
    subject: john, capability: 'mail.send',
    input: { to: ['a@example.com'], body: 'Hello' },
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
  cup.policy.allow({ id: 'john-mail', effect: 'allow', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const input = { to: ['a@example.com'], body: 'Hello' };
  const prepared = await cup.prepare({ subject: john, capability: 'mail.send', input, context: {} });
  const receipt: Receipt = await cup.execute({
    subject: john, capability: 'mail.send', input,
    confirmation: { inputHash: prepared.inputHash, confirmedBy: john.id }, context: {}
  });
  assert.equal(receipt.status, 'succeeded');
  assert.deepEqual(seen, [input]);
});

test('policy scope must match the request scope', async () => {
  const cup = new CapabilityUI();
  cup.register(notes());
  cup.policy.allow({ id: 'acme-read', effect: 'allow', principal: { id: john.id }, operation: 'read', resource: { id: 'notes.john' }, scope: { workspaceId: 'acme' }, priority: 10 });
  const denied = await cup.authorize({ subject: john, operation: 'read', resource: { id: 'notes.john' }, scope: { workspaceId: 'other' }, context: {} });
  assert.equal(denied.effect, 'deny');
});

test('read applies redact obligations before returning records', async () => {
  const cup = new CapabilityUI();
  cup.register({ ...notes(), read: async () => [{ title: 'Brief', secret: 'hidden' }] });
  cup.policy.allow({ id: 'john-read', effect: 'allow', principal: { id: john.id }, operation: 'read', resource: { id: 'notes.john' }, obligations: [{ type: 'redact', fields: ['secret'] }], priority: 10 });
  const result = await cup.read({ subject: john, resource: 'notes.john', context: {} });
  assert.deepEqual(result.items, [{ title: 'Brief' }]);
});

test('delegation attenuates the recipient scope', async () => {
  const cup = new CapabilityUI(); cup.register(notes());
  cup.policy.allow({ id: 'john-delegate', effect: 'allow', principal: { id: john.id }, operation: 'delegate', resource: { id: 'notes.john' }, priority: 10 });
  const grant = await cup.delegate({
    from: john, to: other, capability: 'notes.john',
    operations: ['read'], scope: { fields: ['title'] }, purpose: 'briefing', expiresInMs: 60_000
  });
  assert.equal(grant.to.id, other.id);
  assert.deepEqual(grant.scope!.fields, ['title']);
});
