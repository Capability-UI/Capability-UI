import { DatabaseSync } from 'node:sqlite';
import type { DelegationGrant, Policy, Receipt, Resource, Subject } from './runtime.js';

export interface SqlClient {
  query<T = unknown>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface CupPersistence {
  policyVersion(): Promise<string>;
  resources(): Promise<Resource[]>;
  policies(): Promise<Policy[]>;
  appendReceipt(receipt: Receipt): Promise<void>;
  receipts(query?: { actorId?: string; capability?: string; status?: Receipt['status'] }): Promise<Receipt[]>;
  appendDelegation(grant: DelegationGrant): Promise<void>;
  delegations(subjectId?: string): Promise<DelegationGrant[]>;
  revokeGrant(grantId: string): Promise<void>;
  savePreparedAction(action: { requestId: string; subjectId: string; capabilityId: string; inputHash: string; input: unknown; decision: unknown; policyVersion: string; expiresAt?: string }): Promise<void>;
  preparedAction(requestId: string): Promise<{ requestId: string; subjectId: string; capabilityId: string; inputHash: string; input: unknown; decision: unknown; policyVersion: string; expiresAt?: string; consumedAt?: string } | undefined>;
}

export const CUP_POSTGRES_SCHEMA = /* sql */ `
create extension if not exists pgcrypto;
create table if not exists cup_subjects (
  id text primary key,
  subject_type text not null,
  authenticated boolean not null default true,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists cup_resources (
  id text primary key,
  resource_type text not null,
  version text not null,
  sensitivity text not null,
  schema_json jsonb not null,
  owner_subject_id text references cup_subjects(id),
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists cup_capabilities (
  resource_id text primary key references cup_resources(id) on delete cascade,
  operation text not null,
  input_schema jsonb not null,
  output_schema jsonb not null,
  side_effects jsonb not null default '[]'::jsonb,
  risk text not null,
  confirmation text not null,
  idempotency text not null,
  reversibility text not null,
  handler_key text not null
);
create table if not exists cup_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique,
  effect text not null,
  principal jsonb not null,
  operation jsonb not null,
  resource_id text not null references cup_resources(id),
  scope jsonb,
  conditions jsonb not null default '[]'::jsonb,
  obligations jsonb not null default '[]'::jsonb,
  priority integer not null,
  expires_at timestamptz,
  valid_during_starts_at timestamptz,
  valid_during_ends_at timestamptz,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists cup_prepared_actions (
  request_id uuid primary key,
  subject_id text not null references cup_subjects(id),
  capability_id text not null references cup_capabilities(resource_id),
  input_hash text not null,
  input_json jsonb not null,
  decision jsonb not null,
  policy_version text not null,
  prepared_at timestamptz not null default now(),
  expires_at timestamptz,
  consumed_at timestamptz
);
create table if not exists cup_delegation_grants (
  id text primary key,
  from_subject_id text not null references cup_subjects(id),
  to_subject_id text not null references cup_subjects(id),
  capability_id text not null references cup_capabilities(resource_id),
  operations jsonb not null,
  scope jsonb,
  purpose text,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create table if not exists cup_receipts (
  id uuid primary key,
  request_id uuid not null,
  status text not null,
  actor_id text not null references cup_subjects(id),
  actor_type text not null,
  capability_id text not null,
  input_hash text not null,
  decision jsonb not null,
  result_summary jsonb,
  created_at timestamptz not null
);
create index if not exists cup_receipts_actor_time on cup_receipts(actor_id, created_at desc);
create index if not exists cup_policies_resource_priority on cup_policies(resource_id, priority desc) where active = true;
create table if not exists cup_policy_revisions (
  singleton boolean primary key default true check (singleton),
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into cup_policy_revisions(singleton, version) values(true, 0) on conflict(singleton) do nothing;
`;

/** PostgreSQL read/write repository. Handler functions remain in application code. */
export class PostgresPersistence implements CupPersistence {
  constructor(private readonly db: SqlClient) {}

  async policyVersion(): Promise<string> {
    const result = await this.db.query<{ version: string }>('select version::text from cup_policy_revisions where singleton = true');
    return `policy-${result.rows[0]?.version ?? '0'}`;
  }

  async resources(): Promise<Resource[]> {
    const result = await this.db.query<any>('select id, resource_type, version, sensitivity, schema_json, owner_subject_id, metadata from cup_resources where active = true order by id');
    return result.rows.map(row => ({ id: row.id, type: row.resource_type, version: row.version, sensitivity: row.sensitivity, schema: row.schema_json, owner: row.owner_subject_id ?? undefined, metadata: row.metadata }));
  }

  async policies(): Promise<Policy[]> {
    const result = await this.db.query<any>('select policy_key, effect, principal, operation, resource_id, scope, conditions, obligations, priority, expires_at, valid_during_starts_at, valid_during_ends_at from cup_policies where active = true and (expires_at is null or expires_at > now()) order by priority desc');
    return result.rows.map(row => ({ id: row.policy_key, effect: row.effect, principal: row.principal, operation: row.operation, resource: { id: row.resource_id }, scope: row.scope ?? undefined, conditions: [], obligations: row.obligations ?? [], priority: row.priority, expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at ?? undefined, validDuring: (row.valid_during_starts_at || row.valid_during_ends_at) ? { startsAt: row.valid_during_starts_at ? new Date(row.valid_during_starts_at).toISOString() : undefined, endsAt: row.valid_during_ends_at ? new Date(row.valid_during_ends_at).toISOString() : undefined } : undefined }));
  }

  async appendReceipt(receipt: Receipt): Promise<void> {
    await this.db.query(
      'insert into cup_receipts (id, request_id, status, actor_id, actor_type, capability_id, input_hash, decision, result_summary, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)',
      [receipt.id, receipt.decision.requestId, receipt.status, receipt.actor.id, receipt.actor.type, receipt.capability, receipt.inputHash, JSON.stringify(receipt.decision), JSON.stringify(receipt.resultSummary ?? null), receipt.createdAt],
    );
  }

  async receipts(query: { actorId?: string; capability?: string; status?: Receipt['status'] } = {}): Promise<Receipt[]> {
    const result = await this.db.query<any>('select id, request_id, status, actor_id, actor_type, capability_id, input_hash, decision, result_summary, created_at from cup_receipts where ($1::text is null or actor_id = $1) and ($2::text is null or capability_id = $2) and ($3::text is null or status = $3) order by created_at desc', [query.actorId ?? null, query.capability ?? null, query.status ?? null]);
    return result.rows.map(row => ({ id: row.id, status: row.status, actor: { id: row.actor_id, type: row.actor_type }, capability: row.capability_id, inputHash: row.input_hash, decision: row.decision, resultSummary: row.result_summary ?? undefined, createdAt: new Date(row.created_at).toISOString() }));
  }

  async appendDelegation(grant: DelegationGrant): Promise<void> { await this.db.query('insert into cup_delegation_grants (id, from_subject_id, to_subject_id, capability_id, operations, scope, purpose, expires_at) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)', [grant.id, grant.from.id, grant.to.id, grant.capability, JSON.stringify(grant.operations), JSON.stringify(grant.scope ?? null), grant.purpose ?? null, grant.expiresAt]); }
  async delegations(subjectId?: string): Promise<DelegationGrant[]> { const result = await this.db.query<any>('select id, from_subject_id, to_subject_id, capability_id, operations, scope, purpose, expires_at from cup_delegation_grants where revoked_at is null and expires_at > now() and ($1::text is null or to_subject_id = $1)', [subjectId ?? null]); return result.rows.map(row => ({ id: row.id, from: { id: row.from_subject_id, type: 'user', authenticated: true, attributes: {} }, to: { id: row.to_subject_id, type: 'agent', authenticated: true, attributes: {} }, capability: row.capability_id, operations: row.operations, scope: row.scope ?? undefined, purpose: row.purpose ?? undefined, expiresAt: new Date(row.expires_at).toISOString() })); }
  async revokeGrant(grantId: string): Promise<void> { await this.db.query('update cup_delegation_grants set revoked_at = now() where id = $1 and revoked_at is null', [grantId]); }
  async savePreparedAction(action: { requestId: string; subjectId: string; capabilityId: string; inputHash: string; input: unknown; decision: unknown; policyVersion: string; expiresAt?: string }): Promise<void> { await this.db.query('insert into cup_prepared_actions (request_id, subject_id, capability_id, input_hash, input_json, decision, policy_version, expires_at) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) on conflict (request_id) do update set input_hash=$4,input_json=$5::jsonb,decision=$6::jsonb,policy_version=$7,expires_at=$8', [action.requestId, action.subjectId, action.capabilityId, action.inputHash, JSON.stringify(action.input), JSON.stringify(action.decision), action.policyVersion, action.expiresAt ?? null]); }
  async preparedAction(requestId: string) { const result = await this.db.query<any>('select request_id, subject_id, capability_id, input_hash, input_json, decision, policy_version, expires_at, consumed_at from cup_prepared_actions where request_id = $1', [requestId]); const row = result.rows[0]; return row ? { requestId: row.request_id, subjectId: row.subject_id, capabilityId: row.capability_id, inputHash: row.input_hash, input: row.input_json, decision: row.decision, policyVersion: row.policy_version, expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined, consumedAt: row.consumed_at ? new Date(row.consumed_at).toISOString() : undefined } : undefined; }
}

export function subjectFromRow(row: { id: string; subject_type: Subject['type']; authenticated: boolean; attributes: Record<string, unknown> }): Subject {
  return { id: row.id, type: row.subject_type, authenticated: row.authenticated, attributes: row.attributes };
}

/**
 * SQLite schema for CUP persistence. Mirrors CUP_POSTGRES_SCHEMA but uses SQLite
 * types: TEXT/INTEGER, JSON stored as TEXT, ISO-8601 timestamps as TEXT. Apply it
 * once at open (statements are `create ... if not exists`, so it is idempotent).
 */
export const CUP_SQLITE_SCHEMA = /* sql */ `
create table if not exists cup_subjects (
  id text primary key,
  subject_type text not null,
  authenticated integer not null default 1,
  attributes text not null default '{}',
  created_at text not null default (datetime('now'))
);
create table if not exists cup_resources (
  id text primary key,
  resource_type text not null,
  version text not null,
  sensitivity text not null,
  schema_json text not null,
  owner_subject_id text,
  metadata text not null default '{}',
  active integer not null default 1,
  updated_at text not null default (datetime('now'))
);
create table if not exists cup_capabilities (
  resource_id text primary key,
  operation text not null,
  input_schema text not null,
  output_schema text not null,
  side_effects text not null default '[]',
  risk text not null,
  confirmation text not null,
  idempotency text not null,
  reversibility text not null,
  handler_key text not null
);
create table if not exists cup_policies (
  id text primary key,
  policy_key text not null unique,
  effect text not null,
  principal text not null,
  operation text not null,
  resource_id text not null,
  scope text,
  conditions text not null default '[]',
  obligations text not null default '[]',
  priority integer not null,
  expires_at text,
  valid_during_starts_at text,
  valid_during_ends_at text,
  active integer not null default 1,
  updated_at text not null default (datetime('now'))
);
create table if not exists cup_prepared_actions (
  request_id text primary key,
  subject_id text not null,
  capability_id text not null,
  input_hash text not null,
  input_json text not null,
  decision text not null,
  policy_version text not null,
  prepared_at text not null default (datetime('now')),
  expires_at text,
  consumed_at text
);
create table if not exists cup_delegation_grants (
  id text primary key,
  from_subject_id text not null,
  to_subject_id text not null,
  capability_id text not null,
  operations text not null,
  scope text,
  purpose text,
  expires_at text not null,
  revoked_at text
);
create table if not exists cup_receipts (
  id text primary key,
  request_id text not null,
  status text not null,
  actor_id text not null,
  actor_type text not null,
  capability_id text not null,
  input_hash text not null,
  decision text not null,
  result_summary text,
  created_at text not null
);
create index if not exists cup_receipts_actor_time on cup_receipts(actor_id, created_at desc);
create index if not exists cup_policies_resource_priority on cup_policies(resource_id, priority desc);
create table if not exists cup_policy_revisions (
  singleton integer primary key default 1 check (singleton = 1),
  version integer not null default 0,
  updated_at text not null default (datetime('now'))
);
insert or ignore into cup_policy_revisions(singleton, version) values(1, 0);
`;

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string') return text ?? undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

function parseNullableJson(text: unknown): unknown {
  const value = parseJson(text);
  return value === null ? undefined : value;
}

/** A `SqlClient` plus schema/lifecycle helpers, backed by Node's built-in `node:sqlite`. */
export interface NodeSqliteHandle {
  client: SqlClient;
  exec(sql: string): void;
  close(): void;
}

/**
 * Open a SQLite database via Node's built-in `node:sqlite` and adapt it to the
 * `SqlClient` interface (positional `?` parameters). Pass a file path for durable
 * storage (e.g. `.harness/cup.db`) or omit for an in-memory database.
 */
export function openNodeSqlite(location = ':memory:'): NodeSqliteHandle {
  const db = new DatabaseSync(location);
  db.exec('pragma journal_mode = WAL;');
  const client: SqlClient = {
    async query<T = unknown>(sql: string, values: readonly unknown[] = []): Promise<{ rows: T[] }> {
      const params = values.map(value => {
        if (value === undefined) return null;
        if (typeof value === 'boolean') return value ? 1 : 0;
        return value;
      }) as Array<null | number | bigint | string | Uint8Array>;
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma|with)/i.test(sql)) {
        return { rows: statement.all(...params) as T[] };
      }
      statement.run(...params);
      return { rows: [] as T[] };
    },
  };
  return { client, exec: (sql: string) => db.exec(sql), close: () => db.close() };
}

/** SQLite read/write repository. Handler functions remain in application code. */
export class SqliteCupPersistence implements CupPersistence {
  constructor(private readonly db: SqlClient) {}

  async policyVersion(): Promise<string> {
    const result = await this.db.query<{ version: number | bigint }>('select version from cup_policy_revisions where singleton = 1');
    return `policy-${result.rows[0]?.version ?? 0}`;
  }

  async resources(): Promise<Resource[]> {
    const result = await this.db.query<any>('select id, resource_type, version, sensitivity, schema_json, owner_subject_id, metadata from cup_resources where active = 1 order by id');
    return result.rows.map(row => ({ id: row.id, type: row.resource_type, version: row.version, sensitivity: row.sensitivity, schema: parseJson(row.schema_json) as Resource['schema'], owner: row.owner_subject_id ?? undefined, metadata: parseJson(row.metadata) as Resource['metadata'] }));
  }

  async policies(): Promise<Policy[]> {
    const now = new Date().toISOString();
    const result = await this.db.query<any>('select policy_key, effect, principal, operation, resource_id, scope, conditions, obligations, priority, expires_at, valid_during_starts_at, valid_during_ends_at from cup_policies where active = 1 and (expires_at is null or expires_at > ?) order by priority desc', [now]);
    return result.rows.map(row => ({
      id: row.policy_key,
      effect: row.effect,
      principal: parseJson(row.principal) as Policy['principal'],
      operation: parseJson(row.operation) as Policy['operation'],
      resource: { id: row.resource_id },
      scope: row.scope ? (parseJson(row.scope) as Policy['scope']) : undefined,
      conditions: [],
      obligations: (row.obligations ? parseJson(row.obligations) : []) as Policy['obligations'],
      priority: Number(row.priority),
      expiresAt: row.expires_at ?? undefined,
      validDuring: (row.valid_during_starts_at || row.valid_during_ends_at)
        ? { startsAt: row.valid_during_starts_at ?? undefined, endsAt: row.valid_during_ends_at ?? undefined }
        : undefined,
    }));
  }

  async appendReceipt(receipt: Receipt): Promise<void> {
    await this.db.query(
      'insert into cup_receipts (id, request_id, status, actor_id, actor_type, capability_id, input_hash, decision, result_summary, created_at) values (?,?,?,?,?,?,?,?,?,?)',
      [receipt.id, receipt.decision.requestId, receipt.status, receipt.actor.id, receipt.actor.type, receipt.capability, receipt.inputHash, JSON.stringify(receipt.decision), JSON.stringify(receipt.resultSummary ?? null), receipt.createdAt],
    );
  }

  async receipts(query: { actorId?: string; capability?: string; status?: Receipt['status'] } = {}): Promise<Receipt[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.actorId) { clauses.push('actor_id = ?'); params.push(query.actorId); }
    if (query.capability) { clauses.push('capability_id = ?'); params.push(query.capability); }
    if (query.status) { clauses.push('status = ?'); params.push(query.status); }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const result = await this.db.query<any>(`select id, status, actor_id, actor_type, capability_id, input_hash, decision, result_summary, created_at from cup_receipts ${where} order by created_at desc`, params);
    return result.rows.map(row => ({ id: row.id, status: row.status, actor: { id: row.actor_id, type: row.actor_type }, capability: row.capability_id, inputHash: row.input_hash, decision: parseJson(row.decision) as Receipt['decision'], resultSummary: parseNullableJson(row.result_summary), createdAt: row.created_at }));
  }

  async appendDelegation(grant: DelegationGrant): Promise<void> {
    await this.db.query(
      'insert into cup_delegation_grants (id, from_subject_id, to_subject_id, capability_id, operations, scope, purpose, expires_at) values (?,?,?,?,?,?,?,?)',
      [grant.id, grant.from.id, grant.to.id, grant.capability, JSON.stringify(grant.operations), JSON.stringify(grant.scope ?? null), grant.purpose ?? null, grant.expiresAt],
    );
  }

  async delegations(subjectId?: string): Promise<DelegationGrant[]> {
    const now = new Date().toISOString();
    const clauses = ['revoked_at is null', 'expires_at > ?'];
    const params: unknown[] = [now];
    if (subjectId) { clauses.push('to_subject_id = ?'); params.push(subjectId); }
    const result = await this.db.query<any>(`select id, from_subject_id, to_subject_id, capability_id, operations, scope, purpose, expires_at from cup_delegation_grants where ${clauses.join(' and ')}`, params);
    return result.rows.map(row => ({
      id: row.id,
      from: { id: row.from_subject_id, type: 'user', authenticated: true, attributes: {} },
      to: { id: row.to_subject_id, type: 'agent', authenticated: true, attributes: {} },
      capability: row.capability_id,
      operations: parseJson(row.operations) as DelegationGrant['operations'],
      scope: row.scope ? (parseJson(row.scope) as DelegationGrant['scope']) : undefined,
      purpose: row.purpose ?? undefined,
      expiresAt: row.expires_at,
    }));
  }

  async revokeGrant(grantId: string): Promise<void> {
    await this.db.query('update cup_delegation_grants set revoked_at = ? where id = ? and revoked_at is null', [new Date().toISOString(), grantId]);
  }

  async savePreparedAction(action: { requestId: string; subjectId: string; capabilityId: string; inputHash: string; input: unknown; decision: unknown; policyVersion: string; expiresAt?: string }): Promise<void> {
    await this.db.query(
      'insert into cup_prepared_actions (request_id, subject_id, capability_id, input_hash, input_json, decision, policy_version, expires_at) values (?,?,?,?,?,?,?,?) on conflict(request_id) do update set input_hash=excluded.input_hash, input_json=excluded.input_json, decision=excluded.decision, policy_version=excluded.policy_version, expires_at=excluded.expires_at',
      [action.requestId, action.subjectId, action.capabilityId, action.inputHash, JSON.stringify(action.input), JSON.stringify(action.decision), action.policyVersion, action.expiresAt ?? null],
    );
  }

  async preparedAction(requestId: string) {
    const result = await this.db.query<any>('select request_id, subject_id, capability_id, input_hash, input_json, decision, policy_version, expires_at, consumed_at from cup_prepared_actions where request_id = ?', [requestId]);
    const row = result.rows[0];
    return row ? { requestId: row.request_id, subjectId: row.subject_id, capabilityId: row.capability_id, inputHash: row.input_hash, input: parseJson(row.input_json), decision: parseJson(row.decision), policyVersion: row.policy_version, expiresAt: row.expires_at ?? undefined, consumedAt: row.consumed_at ?? undefined } : undefined;
  }
}
