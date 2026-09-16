import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  openNodeSqlite,
  SqliteCupPersistence,
  CUP_SQLITE_SCHEMA,
  type DelegationGrant,
  type Receipt,
} from '../src/index.js';

function setup() {
  const handle = openNodeSqlite(':memory:');
  handle.exec(CUP_SQLITE_SCHEMA);
  return { ...handle, p: new SqliteCupPersistence(handle.client) };
}

test('sqlite persistence: policyVersion defaults to policy-0', async () => {
  const { p, close } = setup();
  assert.equal(await p.policyVersion(), 'policy-0');
  close();
});

test('sqlite persistence: resources and policies round-trip', async () => {
  const { client, p, close } = setup();
  await client.query(
    'insert into cup_resources (id, resource_type, version, sensitivity, schema_json, owner_subject_id, metadata, active) values (?,?,?,?,?,?,?,1)',
    ['notes.summarize', 'capability', '1.0', 'personal', JSON.stringify({ type: 'object' }), 'user:john', JSON.stringify({ k: 1 })],
  );
  await client.query(
    'insert into cup_policies (id, policy_key, effect, principal, operation, resource_id, scope, conditions, obligations, priority, active) values (?,?,?,?,?,?,?,?,?,?,1)',
    ['p1', 'john-exec', 'allow', JSON.stringify({ id: 'user:john' }), JSON.stringify('execute'), 'notes.summarize', null, JSON.stringify([]), JSON.stringify([]), 10],
  );

  const resources = await p.resources();
  assert.equal(resources.length, 1);
  assert.equal(resources[0]?.id, 'notes.summarize');
  assert.equal(resources[0]?.owner, 'user:john');
  assert.deepEqual(resources[0]?.metadata, { k: 1 });

  const policies = await p.policies();
  assert.equal(policies.length, 1);
  assert.equal(policies[0]?.effect, 'allow');
  assert.equal(policies[0]?.priority, 10);
  assert.deepEqual(policies[0]?.principal, { id: 'user:john' });
  assert.equal(policies[0]?.operation, 'execute');
  close();
});

test('sqlite persistence: appendReceipt + filtered receipts', async () => {
  const { p, close } = setup();
  const decision = { requestId: 'r1', effect: 'allow' as const, reasonCode: 'ALLOWED', matchedPolicies: [], obligations: [], policyVersion: 'policy-0' };
  const at = new Date().toISOString();
  await p.appendReceipt({ id: 'rc1', status: 'succeeded', actor: { id: 'agent:coder', type: 'agent' }, capability: 'workspace.read', inputHash: 'h', decision, resultSummary: { ok: true }, createdAt: at } as Receipt);
  await p.appendReceipt({ id: 'rc2', status: 'denied', actor: { id: 'agent:coder', type: 'agent' }, capability: 'workspace.bash', inputHash: 'h', decision: { ...decision, requestId: 'r2' }, createdAt: at } as Receipt);

  assert.equal((await p.receipts()).length, 2);
  const denied = await p.receipts({ status: 'denied' });
  assert.equal(denied.length, 1);
  assert.equal(denied[0]?.capability, 'workspace.bash');
  const reads = await p.receipts({ capability: 'workspace.read' });
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0]?.resultSummary, { ok: true });
  close();
});

test('sqlite persistence: delegation grant, list, and revoke', async () => {
  const { p, close } = setup();
  const grant: DelegationGrant = {
    id: 'g1',
    from: { id: 'agent:coder', type: 'agent', authenticated: true, attributes: {} },
    to: { id: 'agent:sub:reviewer', type: 'agent', authenticated: true, attributes: {} },
    capability: 'workspace.read',
    operations: ['execute'],
    scope: { path: 'src' },
    purpose: 'review',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  await p.appendDelegation(grant);
  let grants = await p.delegations('agent:sub:reviewer');
  assert.equal(grants.length, 1);
  assert.equal(grants[0]?.capability, 'workspace.read');
  assert.deepEqual(grants[0]?.operations, ['execute']);
  assert.deepEqual(grants[0]?.scope, { path: 'src' });

  await p.revokeGrant('g1');
  grants = await p.delegations('agent:sub:reviewer');
  assert.equal(grants.length, 0);
  close();
});

test('sqlite persistence: prepared action upsert + lookup', async () => {
  const { p, close } = setup();
  await p.savePreparedAction({ requestId: 'req1', subjectId: 'agent:coder', capabilityId: 'mail.send', inputHash: 'h1', input: { to: 'x' }, decision: { effect: 'allow' }, policyVersion: 'policy-0' });
  let action = await p.preparedAction('req1');
  assert.ok(action);
  assert.equal(action?.inputHash, 'h1');
  assert.deepEqual(action?.input, { to: 'x' });

  await p.savePreparedAction({ requestId: 'req1', subjectId: 'agent:coder', capabilityId: 'mail.send', inputHash: 'h2', input: { to: 'y' }, decision: { effect: 'allow' }, policyVersion: 'policy-0' });
  action = await p.preparedAction('req1');
  assert.equal(action?.inputHash, 'h2');
  assert.deepEqual(action?.input, { to: 'y' });

  assert.equal(await p.preparedAction('missing'), undefined);
  close();
});
