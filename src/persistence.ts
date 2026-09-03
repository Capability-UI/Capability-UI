import type { Policy, Receipt, Resource, Subject } from './runtime.js';

export interface SqlClient {
  query<T = unknown>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface CupPersistence {
  policyVersion(): Promise<string>;
  resources(): Promise<Resource[]>;
  policies(): Promise<Policy[]>;
  appendReceipt(receipt: Receipt): Promise<void>;
  receipts(query?: { actorId?: string; capability?: string; status?: Receipt['status'] }): Promise<Receipt[]>;
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
    const result = await this.db.query<any>('select policy_key, effect, principal, operation, resource_id, scope, conditions, obligations, priority, expires_at from cup_policies where active = true and (expires_at is null or expires_at > now()) order by priority desc');
    return result.rows.map(row => ({ id: row.policy_key, effect: row.effect, principal: row.principal, operation: row.operation, resource: { id: row.resource_id }, scope: row.scope ?? undefined, conditions: [], obligations: row.obligations ?? [], priority: row.priority, expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at ?? undefined }));
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
}

export function subjectFromRow(row: { id: string; subject_type: Subject['type']; authenticated: boolean; attributes: Record<string, unknown> }): Subject {
  return { id: row.id, type: row.subject_type, authenticated: row.authenticated, attributes: row.attributes };
}
