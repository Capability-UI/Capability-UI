import { defineCapability, denyByDefault, redact, subject, type Resource } from '@capability-ui/core';
import { allowDataRead, allowExecute } from '../../shared/policy.ts';
import { seedAccessModel } from '../../shared/access-model.ts';
import { ExampleSqlite, sqliteFile } from '../../shared/sqlite.ts';
import type { ExampleApp } from '../../shared/types.ts';

const SCHEMA = `
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  customer TEXT NOT NULL,
  requester TEXT NOT NULL,
  status TEXT NOT NULL,
  assignee TEXT NOT NULL,
  sla_minutes INTEGER NOT NULL,
  priority TEXT NOT NULL,
  internal_notes TEXT NOT NULL,
  last_update TEXT NOT NULL
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO tickets VALUES
  ('t-1042', 'SSO login loop after IdP rotation', 'Northwind', 'priya.nair@northwind.example', 'open', 'user:aisha', 45, 'high', 'IdP metadata is stale. Do not mention the backup cert.', '2026-09-03T14:10:00Z'),
  ('t-1043', 'Invoice PDF missing line items', 'Contoso', 'billing@contoso.example', 'pending', 'user:rio', 240, 'medium', 'Billing exception queued in finance.', '2026-09-03T12:02:00Z'),
  ('t-1044', 'Webhook retries exhausted', 'Adventure Works', 'ops@adventure.example', 'escalated', 'user:aisha', 20, 'urgent', 'Pager was silenced overnight. Review on-call notes.', '2026-09-03T15:40:00Z'),
  ('t-1045', 'Cannot export CSV over 10k rows', 'Fabrikam', 'lee@fabrikam.example', 'open', 'user:rio', 180, 'low', 'Known limit in the report worker. Do not promise a same-day fix.', '2026-09-02T18:11:00Z'),
  ('t-1046', 'SCIM group sync duplicates', 'Wide World Importers', 'it@wwi.example', 'pending', 'user:aisha', 90, 'high', 'Duplicate groups come from nested AD OUs.', '2026-09-03T09:22:00Z'),
  ('t-1047', 'Mobile push notifications silent', 'Litware', 'mobile@litware.example', 'open', 'user:rio', 300, 'medium', 'APNs token likely rotated. Check the sandbox cert.', '2026-09-01T21:00:00Z');
INSERT INTO comments VALUES
  ('cm1', 't-1042', 'Reproduced on Chrome 128 with Okta.', 'Aisha Rahman', '2026-09-03T14:12:00Z'),
  ('cm2', 't-1043', 'Asked finance for the source invoice XML.', 'Rio Patel', '2026-09-03T12:40:00Z');
`;

export async function createSupportDesk(options: { databaseFile?: string } = {}): Promise<ExampleApp> {
  const cup = denyByDefault();
  const aisha = subject('user:aisha', { role: 'lead', workspaceId: 'helpdesk' });
  const rio = subject('user:rio', { role: 'contractor', workspaceId: 'helpdesk' });
  const database = await new ExampleSqlite(SCHEMA, options.databaseFile).init();

  const ticketResource: Resource = {
    id: 'support.tickets',
    type: 'data',
    version: '1.0',
    sensitivity: 'confidential',
    owner: aisha.id,
    schema: { type: 'array', items: { type: 'object' } },
    read: async () => database.all(`
      SELECT id, title, customer, requester, status, assignee, sla_minutes AS slaMinutes,
             priority, internal_notes AS internalNotes, last_update AS lastUpdate
      FROM tickets ORDER BY sla_minutes ASC
    `),
  };
  cup.register(ticketResource);
  allowDataRead(cup, { id: 'aisha-tickets', principal: { id: aisha.id }, resourceId: ticketResource.id, priority: 20 });
  allowDataRead(cup, {
    id: 'rio-tickets',
    principal: { id: rio.id },
    resourceId: ticketResource.id,
    priority: 10,
    obligations: [redact(['internalNotes'])],
  });

  const commentResource: Resource = {
    id: 'support.comments',
    type: 'data',
    version: '1.0',
    sensitivity: 'confidential',
    owner: aisha.id,
    schema: { type: 'array', items: { type: 'object' } },
    read: async () => database.all(`SELECT id, ticket_id AS ticketId, body, author, created_at AS createdAt FROM comments ORDER BY created_at`),
  };
  cup.register(commentResource);
  allowDataRead(cup, { id: 'aisha-comments', principal: { id: aisha.id }, resourceId: commentResource.id, priority: 20 });
  allowDataRead(cup, { id: 'rio-comments', principal: { id: rio.id }, resourceId: commentResource.id, priority: 10 });

  function touch(id: string): void {
    database.run(`UPDATE tickets SET last_update = ? WHERE id = ?`, [new Date().toISOString(), id]);
    cup.publish({ resource: { id: ticketResource.id }, type: 'updated' });
  }

  cup.register(defineCapability({
    id: 'tickets.comment',
    operation: 'update',
    version: '1.0',
    sensitivity: 'confidential',
    schema: { type: 'object' },
    inputSchema: {
      type: 'object',
      required: ['ticketId', 'body'],
      properties: { ticketId: { type: 'string' }, body: { type: 'string' } },
    },
    outputSchema: { type: 'object' },
    sideEffects: ['Appends a customer-visible comment'],
    risk: 'low',
    confirmation: 'none',
    idempotency: 'supported',
    reversibility: 'reversible',
    handler: async (input) => {
      const value = input as { ticketId: string; body: string };
      database.run(
        `INSERT INTO comments (id, ticket_id, body, author, created_at) VALUES (?, ?, ?, ?, ?)`,
        [`cm${Date.now()}`, value.ticketId, value.body, 'workspace', new Date().toISOString()],
      );
      database.run(`UPDATE tickets SET status = CASE WHEN status = 'resolved' THEN status ELSE 'pending' END WHERE id = ?`, [value.ticketId]);
      touch(value.ticketId);
      return { ok: true };
    },
  }));
  cup.register(defineCapability({
    id: 'tickets.assign',
    operation: 'update',
    version: '1.0',
    sensitivity: 'confidential',
    schema: { type: 'object' },
    inputSchema: {
      type: 'object',
      required: ['ticketId', 'assignee'],
      properties: {
        ticketId: { type: 'string' },
        assignee: { type: 'string', enum: [aisha.id, rio.id] },
      },
    },
    outputSchema: { type: 'object' },
    sideEffects: ['Changes ticket ownership'],
    risk: 'medium',
    confirmation: 'preview',
    idempotency: 'supported',
    reversibility: 'reversible',
    handler: async (input) => {
      const value = input as { ticketId: string; assignee: string };
      database.run(`UPDATE tickets SET assignee = ? WHERE id = ?`, [value.assignee, value.ticketId]);
      touch(value.ticketId);
      return { ok: true };
    },
  }));
  cup.register(defineCapability({
    id: 'tickets.escalate',
    operation: 'execute',
    version: '1.0',
    sensitivity: 'restricted',
    schema: { type: 'object' },
    inputSchema: {
      type: 'object',
      required: ['ticketId', 'reason'],
      properties: { ticketId: { type: 'string' }, reason: { type: 'string' } },
    },
    outputSchema: { type: 'object' },
    sideEffects: ['Pages the on-call rotation'],
    risk: 'high',
    confirmation: 'explicit',
    idempotency: 'required',
    reversibility: 'irreversible',
    handler: async (input) => {
      const value = input as { ticketId: string; reason: string };
      database.run(
        `UPDATE tickets SET status = 'escalated', sla_minutes = MIN(sla_minutes, 15),
         internal_notes = internal_notes || ' Escalation: ' || ? WHERE id = ?`,
        [value.reason, value.ticketId],
      );
      touch(value.ticketId);
      return { ok: true };
    },
  }));
  allowExecute(cup, { id: 'aisha-comment', principal: { id: aisha.id }, resourceId: 'tickets.comment', priority: 20 });
  allowExecute(cup, { id: 'rio-comment', principal: { id: rio.id }, resourceId: 'tickets.comment', priority: 10 });
  allowExecute(cup, { id: 'aisha-assign', principal: { id: aisha.id }, resourceId: 'tickets.assign', priority: 20 });
  allowExecute(cup, { id: 'aisha-escalate', principal: { id: aisha.id }, resourceId: 'tickets.escalate', priority: 20 });

  const catalog = {
    summary: 'Tickets are the case record. Comments belong to a ticket. Internal notes live on the ticket row and are stripped for contractors at read time. Escalate and assign are actions on tickets, not extra tables.',
    resources: [
      { id: 'support.tickets', table: 'tickets', kind: 'data' as const, description: 'Service cases. internal_notes is redacted for contractors.' },
      { id: 'support.comments', table: 'comments', kind: 'data' as const, description: 'Public thread on a ticket.' },
      { id: 'tickets.comment', table: 'comments', kind: 'action' as const, writesTable: 'comments', description: 'Inserts a comments row and may move ticket status to pending.' },
      { id: 'tickets.assign', table: 'tickets', kind: 'action' as const, writesTable: 'tickets', description: 'Updates tickets.assignee. Desk lead only.' },
      { id: 'tickets.escalate', table: 'tickets', kind: 'action' as const, writesTable: 'tickets', description: 'Updates status, SLA, and internal_notes. Desk lead only.' },
    ],
    grants: [
      { principalId: aisha.id, principalLabel: 'Aisha Rahman', resourceId: 'support.tickets', mapsToTable: 'tickets', operations: ['discover', 'inspect', 'read'], recordScope: 'Every tickets row, including internal_notes', hiddenFields: [] },
      { principalId: aisha.id, principalLabel: 'Aisha Rahman', resourceId: 'support.comments', mapsToTable: 'comments', operations: ['discover', 'inspect', 'read'], recordScope: 'Every comments row', hiddenFields: [] },
      { principalId: aisha.id, principalLabel: 'Aisha Rahman', resourceId: 'tickets.comment', mapsToTable: 'comments', operations: ['execute'], recordScope: 'May comment on any ticket', hiddenFields: [] },
      { principalId: aisha.id, principalLabel: 'Aisha Rahman', resourceId: 'tickets.assign', mapsToTable: 'tickets', operations: ['execute'], recordScope: 'May reassign any ticket', hiddenFields: [] },
      { principalId: aisha.id, principalLabel: 'Aisha Rahman', resourceId: 'tickets.escalate', mapsToTable: 'tickets', operations: ['execute'], recordScope: 'May escalate any ticket', hiddenFields: [] },
      { principalId: rio.id, principalLabel: 'Rio Patel', resourceId: 'support.tickets', mapsToTable: 'tickets', operations: ['discover', 'inspect', 'read'], recordScope: 'Every tickets row', hiddenFields: ['internal_notes'] },
      { principalId: rio.id, principalLabel: 'Rio Patel', resourceId: 'support.comments', mapsToTable: 'comments', operations: ['discover', 'inspect', 'read'], recordScope: 'Every comments row', hiddenFields: [] },
      { principalId: rio.id, principalLabel: 'Rio Patel', resourceId: 'tickets.comment', mapsToTable: 'comments', operations: ['execute'], recordScope: 'May comment on any ticket', hiddenFields: [] },
    ],
  };
  const principals = [
    { id: aisha.id, label: 'Aisha Rahman', role: 'Desk lead', subject: aisha },
    { id: rio.id, label: 'Rio Patel', role: 'Contractor', subject: rio },
  ];
  seedAccessModel(database, catalog, principals);

  return {
    name: 'support-desk',
    product: 'Clearline',
    title: 'Clearline',
    subtitle: 'IT service desk for Northwind, Contoso, and the rest of the tenant.',
    cup,
    database,
    defaultSubjectId: aisha.id,
    catalog,
    principals,
  };
}

export function supportDatabaseFile(): string {
  return sqliteFile(import.meta.url);
}
