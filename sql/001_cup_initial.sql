-- CUP PostgreSQL reference migration
-- The application must still provide authentication, handler registration,
-- transaction management, and policy-condition decoding.
create extension if not exists pgcrypto;

create table if not exists cup_subjects (
  id text primary key,
  subject_type text not null check (subject_type in ('user', 'agent', 'service', 'group')),
  authenticated boolean not null default true,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cup_resources (
  id text primary key,
  resource_type text not null check (resource_type in ('data', 'capability', 'workflow', 'view', 'agent')),
  version text not null,
  sensitivity text not null check (sensitivity in ('public', 'personal', 'confidential', 'restricted')),
  schema_json jsonb not null,
  owner_subject_id text references cup_subjects(id),
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, version)
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
  effect text not null check (effect in ('allow', 'deny')),
  principal jsonb not null,
  operation jsonb not null,
  resource_id text not null references cup_resources(id),
  scope jsonb,
  conditions jsonb not null default '[]'::jsonb,
  obligations jsonb not null default '[]'::jsonb,
  priority integer not null,
  version text not null default '1',
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cup_policies_resource_priority
  on cup_policies (resource_id, priority desc) where active = true;

create table if not exists cup_delegation_grants (
  id uuid primary key default gen_random_uuid(),
  from_subject_id text not null references cup_subjects(id),
  to_subject_id text not null references cup_subjects(id),
  capability_id text not null references cup_capabilities(resource_id),
  operations jsonb not null,
  scope jsonb,
  purpose text,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists cup_grants_recipient_expiry
  on cup_delegation_grants (to_subject_id, expires_at) where revoked_at is null;

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
  status text not null check (status in ('succeeded', 'failed', 'denied', 'pending')),
  actor_id text not null references cup_subjects(id),
  actor_type text not null,
  capability_id text not null,
  input_hash text not null,
  decision jsonb not null,
  confirmation jsonb,
  result_summary jsonb,
  reversible_by text,
  created_at timestamptz not null
);

create index if not exists cup_receipts_actor_time on cup_receipts(actor_id, created_at desc);
create index if not exists cup_receipts_request on cup_receipts(request_id);

create table if not exists cup_policy_revisions (
  singleton boolean primary key default true check (singleton),
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into cup_policy_revisions(singleton, version) values (true, 0)
on conflict (singleton) do nothing;
