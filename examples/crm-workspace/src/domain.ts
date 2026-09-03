import { defineCapability, denyByDefault, redact, subject, type Resource } from '@capability-ui/core';
import { allowDataRead, allowExecute } from '../../shared/policy.ts';
import { seedAccessModel } from '../../shared/access-model.ts';
import { ExampleSqlite, sqliteFile } from '../../shared/sqlite.ts';
import type { ExampleApp } from '../../shared/types.ts';

const SCHEMA = `
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT,
  company TEXT NOT NULL,
  stage TEXT NOT NULL,
  phone TEXT,
  personal_email TEXT,
  amount INTEGER NOT NULL,
  last_touch TEXT NOT NULL
);
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE outbound_mail (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id),
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO contacts VALUES
  ('c1', 'Ada Lovelace', 'Principal Engineer', 'Analytical Engines', 'renewal', '+44 20 7946 0958', 'ada@home.example', 48000, '2026-08-28'),
  ('c2', 'Grace Hopper', 'CTO', 'Navy Compiler Lab', 'discovery', '+1 202 555 0147', 'grace@home.example', 12500, '2026-08-12'),
  ('c3', 'Katherine Johnson', 'Staff Analyst', 'Flight Research', 'closed', '+1 757 555 0199', 'katherine@home.example', 91000, '2026-07-02'),
  ('c4', 'Michael Stonebraker', 'Advisor', 'Ingress Systems', 'proposal', '+1 617 555 0112', 'mike@home.example', 220000, '2026-09-01'),
  ('c5', 'Radia Perlman', 'Fellow', 'Spanning Tree Co', 'renewal', '+1 425 555 0166', 'radia@home.example', 64000, '2026-08-30'),
  ('c6', 'Timnit Gebru', 'Director', 'Distributed AI League', 'proposal', '+1 650 555 0133', 'timnit@home.example', 155000, '2026-08-21');
INSERT INTO notes VALUES
  ('n1', 'c1', 'Send the Q3 architecture brief before Friday.', 'Maya Chen', '2026-08-28T14:10:00Z'),
  ('n2', 'c2', 'Compiler workshop next month. Keep the invite internal.', 'Maya Chen', '2026-08-12T09:40:00Z'),
  ('n3', 'c4', 'Legal is reviewing the data processing addendum.', 'Bob Nguyen', '2026-09-01T16:02:00Z'),
  ('n4', 'c5', 'They want a named support engineer on the renewal.', 'Maya Chen', '2026-08-30T11:18:00Z');
`;

export async function createCrmWorkspace(options: { databaseFile?: string } = {}): Promise<ExampleApp> {
  const cup = denyByDefault();
  const maya = subject('user:maya', { role: 'owner', workspaceId: 'acme' });
  const bob = subject('user:bob', { role: 'member', workspaceId: 'acme' });
  const database = await new ExampleSqlite(SCHEMA, options.databaseFile).init();

  const contactResource: Resource = {
    id: 'crm.contacts',
    type: 'data',
    version: '1.0',
    sensitivity: 'confidential',
    owner: maya.id,
    schema: { type: 'array', items: { type: 'object' } },
    read: async () => database.all(`SELECT id, name, title, company, stage, phone, personal_email AS personalEmail, amount, last_touch AS lastTouch FROM contacts ORDER BY company`),
  };
  const noteResource: Resource = {
    id: 'crm.notes',
    type: 'data',
    version: '1.0',
    sensitivity: 'confidential',
    owner: maya.id,
    schema: { type: 'array', items: { type: 'object' } },
    read: async () => database.all(`SELECT id, contact_id AS contactId, body, author, created_at AS createdAt FROM notes ORDER BY created_at DESC`),
  };
  cup.register(contactResource);
  cup.register(noteResource);
  allowDataRead(cup, { id: 'maya-contacts', principal: { id: maya.id }, resourceId: contactResource.id, priority: 20 });
  allowDataRead(cup, { id: 'maya-notes', principal: { id: maya.id }, resourceId: noteResource.id, priority: 20 });
  allowDataRead(cup, {
    id: 'bob-contacts',
    principal: { id: bob.id },
    resourceId: contactResource.id,
    priority: 10,
    obligations: [redact(['phone', 'personalEmail', 'amount'])],
  });
  allowDataRead(cup, { id: 'bob-notes', principal: { id: bob.id }, resourceId: noteResource.id, priority: 10 });

  cup.register(defineCapability({
    id: 'crm.addNote',
    operation: 'create',
    version: '1.0',
    sensitivity: 'confidential',
    schema: { type: 'object' },
    inputSchema: {
      type: 'object',
      required: ['contactId', 'body'],
      properties: { contactId: { type: 'string' }, body: { type: 'string' } },
    },
    outputSchema: { type: 'object' },
    sideEffects: ['Writes a CRM note'],
    risk: 'low',
    confirmation: 'none',
    idempotency: 'supported',
    reversibility: 'reversible',
    handler: async (input) => {
      const value = input as { contactId: string; body: string };
      const id = `n${Date.now()}`;
      database.run(
        `INSERT INTO notes (id, contact_id, body, author, created_at) VALUES (?, ?, ?, ?, ?)`,
        [id, value.contactId, value.body, 'workspace', new Date().toISOString()],
      );
      cup.publish({ resource: { id: noteResource.id }, type: 'updated' });
      return { id };
    },
  }));
  cup.register(defineCapability({
    id: 'mail.send',
    operation: 'execute',
    version: '1.0',
    sensitivity: 'confidential',
    schema: { type: 'object' },
    inputSchema: {
      type: 'object',
      required: ['to', 'body'],
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
        subject: { type: 'string' },
        contactId: { type: 'string' },
      },
    },
    outputSchema: { type: 'object' },
    sideEffects: ['Sends an external message'],
    risk: 'high',
    confirmation: 'explicit',
    idempotency: 'required',
    reversibility: 'irreversible',
    handler: async (input) => {
      const value = input as { to: string[]; body: string; subject?: string; contactId?: string };
      const toAddress = value.to[0];
      if (!toAddress) throw new Error('MISSING_RECIPIENT');
      database.run(
        `INSERT INTO outbound_mail (id, contact_id, to_address, subject, body, sent_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [`m${Date.now()}`, value.contactId ?? null, toAddress, value.subject ?? 'Follow up', value.body, 'workspace', new Date().toISOString()],
      );
      return { delivered: true, to: value.to };
    },
  }));
  allowExecute(cup, { id: 'maya-note', principal: { id: maya.id }, resourceId: 'crm.addNote', priority: 20 });
  allowExecute(cup, { id: 'bob-note', principal: { id: bob.id }, resourceId: 'crm.addNote', priority: 10 });
  allowExecute(cup, { id: 'maya-mail', principal: { id: maya.id }, resourceId: 'mail.send', priority: 20 });

  const catalog = {
    summary: 'Contacts are the account record. Notes and mail hang off a contact. Policies bind people to CUP resources, which project onto these tables. Field redaction applies when a principal reads crm.contacts.',
    resources: [
      { id: 'crm.contacts', table: 'contacts', kind: 'data' as const, description: 'Account records. One row is one company/person in the book.' },
      { id: 'crm.notes', table: 'notes', kind: 'data' as const, description: 'Internal activity on a contact.' },
      { id: 'crm.addNote', table: 'notes', kind: 'action' as const, writesTable: 'notes', description: 'Inserts a notes row for a contact.' },
      { id: 'mail.send', table: 'outbound_mail', kind: 'action' as const, writesTable: 'outbound_mail', description: 'Inserts an outbound_mail row. Owner only.' },
    ],
    grants: [
      { principalId: maya.id, principalLabel: 'Maya Chen', resourceId: 'crm.contacts', mapsToTable: 'contacts', operations: ['discover', 'inspect', 'read'], recordScope: 'Every contacts row', hiddenFields: [] },
      { principalId: maya.id, principalLabel: 'Maya Chen', resourceId: 'crm.notes', mapsToTable: 'notes', operations: ['discover', 'inspect', 'read'], recordScope: 'Every notes row', hiddenFields: [] },
      { principalId: maya.id, principalLabel: 'Maya Chen', resourceId: 'crm.addNote', mapsToTable: 'notes', operations: ['execute'], recordScope: 'May insert notes for any contact', hiddenFields: [] },
      { principalId: maya.id, principalLabel: 'Maya Chen', resourceId: 'mail.send', mapsToTable: 'outbound_mail', operations: ['execute'], recordScope: 'May insert outbound_mail for any contact', hiddenFields: [] },
      { principalId: bob.id, principalLabel: 'Bob Nguyen', resourceId: 'crm.contacts', mapsToTable: 'contacts', operations: ['discover', 'inspect', 'read'], recordScope: 'Every contacts row', hiddenFields: ['phone', 'personal_email', 'amount'] },
      { principalId: bob.id, principalLabel: 'Bob Nguyen', resourceId: 'crm.notes', mapsToTable: 'notes', operations: ['discover', 'inspect', 'read'], recordScope: 'Every notes row', hiddenFields: [] },
      { principalId: bob.id, principalLabel: 'Bob Nguyen', resourceId: 'crm.addNote', mapsToTable: 'notes', operations: ['execute'], recordScope: 'May insert notes for any contact', hiddenFields: [] },
    ],
  };
  const principals = [
    { id: maya.id, label: 'Maya Chen', role: 'Account owner', subject: maya },
    { id: bob.id, label: 'Bob Nguyen', role: 'Sales associate', subject: bob },
  ];
  seedAccessModel(database, catalog, principals);

  return {
    name: 'crm-workspace',
    product: 'Meridian',
    title: 'Meridian',
    subtitle: 'Pipeline for Analytical Engines, Compiler Lab, and the rest of the book.',
    cup,
    database,
    defaultSubjectId: maya.id,
    catalog,
    principals,
  };
}

export function crmDatabaseFile(): string {
  return sqliteFile(import.meta.url);
}
