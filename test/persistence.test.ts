import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  openNodeSqlite,
  SqliteCupPersistence,
  CUP_SQLITE_SCHEMA,
  CUP_SQLITE_V0_2_RECEIPTS_SCHEMA,
  migrateSqliteCupSchema,
  PostgresPersistence,
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
  await p.appendReceipt({ id: 'rc1', status: 'succeeded', actor: { id: 'agent:coder', type: 'agent' }, capability: 'workspace.read', operation: 'read', inputHash: 'h', decision, resultSummary: { id: 'w1' }, createdAt: at } as Receipt);
  await p.appendReceipt({ id: 'rc2', status: 'denied', actor: { id: 'agent:coder', type: 'agent' }, capability: 'workspace.bash', operation: 'execute', decision: { ...decision, requestId: 'r2' }, createdAt: at } as Receipt);

  assert.equal((await p.receipts()).length, 2);
  const denied = await p.receipts({ status: 'denied' });
  assert.equal(denied.length, 1);
  assert.equal(denied[0]?.capability, 'workspace.bash');
  const reads = await p.receipts({ capability: 'workspace.read' });
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0]?.resultSummary, { id: 'w1' });
  assert.equal(reads[0]?.operation, 'read');
  assert.equal(denied[0]?.operation, 'execute');
  assert.equal(denied[0]?.inputHash, undefined);
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

test('sqlite migrateSqliteCupSchema upgrades a 0.2.0 receipts table in place', async () => {
  const handle = openNodeSqlite(':memory:');
  handle.exec(CUP_SQLITE_V0_2_RECEIPTS_SCHEMA);
  const decision = JSON.stringify({ requestId: 'r1', effect: 'allow', reasonCode: 'ALLOWED', matchedPolicies: [], obligations: [], policyVersion: 'policy-0' });
  const at = '2030-01-01T00:00:00.000Z';
  await handle.client.query(
    'insert into cup_receipts (id, request_id, status, actor_id, actor_type, capability_id, input_hash, decision, result_summary, created_at) values (?,?,?,?,?,?,?,?,?,?)',
    ['old-exec', 'req-1', 'succeeded', 'user:john', 'user', 'mail.execute', 'hash-1', decision, JSON.stringify({ sent: true }), at],
  );
  await handle.client.query(
    'insert into cup_receipts (id, request_id, status, actor_id, actor_type, capability_id, input_hash, decision, result_summary, created_at) values (?,?,?,?,?,?,?,?,?,?)',
    ['old-read', 'req-2', 'succeeded', 'user:john', 'user', 'notes.john', 'hash-2', decision, JSON.stringify({ title: 'kept' }), at],
  );
  await migrateSqliteCupSchema(handle);
  await migrateSqliteCupSchema(handle);
  const p = new SqliteCupPersistence(handle.client);
  const rows = await p.receipts();
  assert.equal(rows.length, 2);
  const exec = rows.find(row => row.id === 'old-exec');
  const read = rows.find(row => row.id === 'old-read');
  assert.equal(exec?.operation, 'execute');
  assert.equal(exec?.inputHash, 'hash-1');
  assert.deepEqual(exec?.resultSummary, { sent: true });
  assert.equal(read?.operation, 'read');
  assert.equal(read?.resultSummary && (read.resultSummary as { title: string }).title, 'kept');
  const info = await handle.client.query<{ name: string; notnull: number }>('pragma table_info(cup_receipts)');
  assert.equal(info.rows.find(col => col.name === 'input_hash')?.notnull, 0);
  await p.appendReceipt({
    id: 'new-denied', status: 'denied', actor: { id: 'anonymous', type: 'anonymous' },
    capability: 'mail.execute', operation: 'execute',
    decision: { requestId: 'req-3', effect: 'deny', reasonCode: 'NO_ACCOUNT', matchedPolicies: [], obligations: [], policyVersion: 'policy-0' },
    createdAt: at,
  } as Receipt);
  assert.equal((await p.receipts()).length, 3);
  handle.close();
});

test('sqlite persistence: scrubReceiptsForResource drops summaries', async () => {
  const { p, close } = setup();
  const decision = { requestId: 'r1', effect: 'allow' as const, reasonCode: 'ALLOWED', matchedPolicies: [], obligations: [], policyVersion: 'policy-0' };
  const at = new Date().toISOString();
  await p.appendReceipt({ id: 'rc1', status: 'succeeded', actor: { id: 'user:john', type: 'user' }, capability: 'notes.john', operation: 'read', resourceRefs: [{ id: 'notes.john' }], inputHash: 'h', decision, resultSummary: { title: 'secret' }, createdAt: at } as Receipt);
  await p.appendReceipt({ id: 'rc2', status: 'succeeded', actor: { id: 'user:john', type: 'user' }, capability: 'mail.send', operation: 'execute', inputHash: 'h2', decision: { ...decision, requestId: 'r2' }, resultSummary: { sent: true }, createdAt: at } as Receipt);
  assert.equal(await p.scrubReceiptsForResource('notes.john'), 1);
  const notes = await p.receipts({ capability: 'notes.john' });
  assert.equal(notes[0]?.resultSummary, undefined);
  assert.equal(notes[0]?.inputHash, undefined);
  const mail = await p.receipts({ capability: 'mail.send' });
  assert.deepEqual(mail[0]?.resultSummary, { sent: true });
  close();
});

test('postgres persistence: scrubReceiptsForResource issues an update', async () => {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const db = {
    query: async <T>(sql: string, values?: readonly unknown[]) => {
      calls.push({ sql, values });
      if (/from cup_receipts/i.test(sql) && /select/i.test(sql)) {
        return {
          rows: [{
            id: 'r1', request_id: 'req', status: 'succeeded', actor_id: 'user:john', actor_type: 'user',
            capability_id: 'notes.john', operation: 'read', resource_refs: [{ id: 'notes.john' }],
            input_hash: 'h', decision: { requestId: 'req', effect: 'allow', reasonCode: 'ALLOWED', matchedPolicies: [], obligations: [], policyVersion: 'policy-0' },
            result_summary: { title: 'secret' }, created_at: new Date().toISOString(),
          }] as T[],
        };
      }
      return { rows: [] as T[] };
    },
  };
  const store = new PostgresPersistence(db);
  assert.equal(await store.scrubReceiptsForResource('notes.john'), 1);
  assert.ok(calls.some(call => /update cup_receipts set result_summary = null/i.test(call.sql)));
});

