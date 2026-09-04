import { fileURLToPath } from 'node:url';
import { defineCapability, denyByDefault, redact, subject, type Resource } from '@capability-ui/core';
import { allowDataRead, allowExecute } from '../../shared/policy.ts';
import { seedAccessModel } from '../../shared/access-model.ts';
import { ExampleSqlite, sqliteFile } from '../../shared/sqlite.ts';
import type { ExampleApp } from '../../shared/types.ts';
import { composeKeelUi } from './compose.ts';

const SCHEMA = `
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  bin TEXT NOT NULL,
  on_hand INTEGER NOT NULL,
  reorder_point INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  supplier TEXT NOT NULL
);
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES products(sku),
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE stock_moves (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES products(sku),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO products VALUES
  ('p1', 'WID-200', 'Harbor widget', 'A-12', 12, 40, 18.5, 'North Mill'),
  ('p2', 'BOLT-8', 'Stainless bolt 8mm', 'C-04', 400, 120, 0.42, 'FastCo'),
  ('p3', 'SEAL-A', 'Dock seal kit', 'B-09', 6, 15, 64, 'Marine Parts'),
  ('p4', 'ROPE-16', 'Mooring line 16mm', 'D-01', 28, 24, 11.2, 'North Mill'),
  ('p5', 'LAMP-LED', 'Flood lamp, marine', 'A-02', 9, 20, 47, 'Harbor Light'),
  ('p6', 'GASK-9', 'Hatch gasket set', 'B-11', 55, 30, 8.75, 'Marine Parts');
INSERT INTO purchase_orders VALUES
  ('po-20', 'SEAL-A', 10, 'submitted', 'user:nia', 'Restock dock seals before the weekend', '2026-09-01T10:00:00Z'),
  ('po-21', 'LAMP-LED', 24, 'draft', 'user:ellis', 'Flood lamps below reorder on the north pier', '2026-09-02T15:30:00Z');
INSERT INTO stock_moves VALUES
  ('sm1', 'WID-200', -4, 'Picked for slip 14', '2026-09-02T08:12:00Z');
`;

function purchaseOrderColumns(database: ExampleSqlite): string[] {
  return database
    .all<{ name: string }>(`PRAGMA table_info(purchase_orders)`)
    .map(column => column.name);
}

function ensurePurchaseOrderReason(database: ExampleSqlite): void {
  if (!purchaseOrderColumns(database).includes('reason')) {
    database.run(`ALTER TABLE purchase_orders ADD COLUMN reason TEXT NOT NULL DEFAULT ''`);
  }
  database.run(`UPDATE purchase_orders SET reason = ? WHERE id = ? AND (reason = '' OR reason IS NULL)`, [
    'Restock dock seals before the weekend',
    'po-20',
  ]);
  database.run(`UPDATE purchase_orders SET reason = ? WHERE id = ? AND (reason = '' OR reason IS NULL)`, [
    'Flood lamps below reorder on the north pier',
    'po-21',
  ]);
}

export async function createAgentStudio(options: { databaseFile?: string } = {}): Promise<ExampleApp> {
  const cup = denyByDefault();
  const nia = subject('user:nia', { role: 'ops_lead', workspaceId: 'harbor' });
  const ellis = subject('user:ellis', { role: 'buyer', workspaceId: 'harbor' });
  const agent = subject('agent:pydantic', { role: 'assistant', workspaceId: 'harbor', runtime: 'pydantic-ai' });
  const database = await new ExampleSqlite(SCHEMA, options.databaseFile).init();
  ensurePurchaseOrderReason(database);

  const productResource: Resource = {
    id: 'inventory.products',
    type: 'data',
    version: '1.0',
    sensitivity: 'confidential',
    owner: nia.id,
    schema: { type: 'array', items: { type: 'object' } },
    read: async () => database.all(`
      SELECT id, sku, name, bin, on_hand AS onHand, reorder_point AS reorderPoint,
             unit_cost AS unitCost, supplier FROM products ORDER BY sku
    `),
  };
  const orderResource: Resource = {
    id: 'inventory.orders',
    type: 'data',
    version: '1.0',
    sensitivity: 'confidential',
    owner: nia.id,
    schema: { type: 'array', items: { type: 'object' } },
    read: async () => database.all(`
      SELECT id, sku, quantity, status, requested_by AS requestedBy, reason, created_at AS createdAt
      FROM purchase_orders ORDER BY created_at DESC
    `),
  };
  cup.register(productResource);
  cup.register(orderResource);
  for (const principal of [nia, ellis, agent]) {
    allowDataRead(cup, { id: `${principal.id}-products`, principal: { id: principal.id }, resourceId: productResource.id, priority: 10 });
    allowDataRead(cup, { id: `${principal.id}-orders`, principal: { id: principal.id }, resourceId: orderResource.id, priority: 10 });
  }
  cup.policy.allow({
    id: 'ellis-products-redact',
    principal: { id: ellis.id },
    operation: 'read',
    resource: { id: productResource.id },
    priority: 20,
    obligations: [redact(['unitCost'])],
  });

  cup.register(defineCapability({
    id: 'inventory.adjust',
    operation: 'update',
    version: '1.0',
    sensitivity: 'confidential',
    schema: { type: 'object' },
    inputSchema: {
      type: 'object',
      required: ['sku', 'delta', 'reason'],
      properties: { sku: { type: 'string' }, delta: { type: 'integer' }, reason: { type: 'string' } },
    },
    outputSchema: { type: 'object' },
    sideEffects: ['Changes on-hand inventory'],
    risk: 'medium',
    confirmation: 'preview',
    idempotency: 'supported',
    reversibility: 'partially_reversible',
    handler: async (input) => {
      const value = input as { sku: string; delta: number; reason: string };
      database.run(`UPDATE products SET on_hand = on_hand + ? WHERE sku = ?`, [value.delta, value.sku]);
      database.run(
        `INSERT INTO stock_moves (id, sku, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
        [`sm${Date.now()}`, value.sku, value.delta, value.reason, new Date().toISOString()],
      );
      cup.publish({ resource: { id: productResource.id }, type: 'updated' });
      return database.get(`SELECT sku, on_hand AS onHand FROM products WHERE sku = ?`, [value.sku]);
    },
  }));
  cup.register(defineCapability({
    id: 'inventory.draftPurchaseOrder',
    operation: 'create',
    version: '1.0',
    sensitivity: 'confidential',
    schema: { type: 'object' },
    inputSchema: {
      type: 'object',
      required: ['sku', 'quantity', 'reason'],
      properties: {
        sku: { type: 'string' },
        quantity: { type: 'integer' },
        reason: { type: 'string' },
      },
    },
    outputSchema: { type: 'object' },
    sideEffects: ['Creates a purchase order draft'],
    risk: 'low',
    confirmation: 'none',
    idempotency: 'supported',
    reversibility: 'reversible',
    handler: async (input, context) => {
      const value = input as { sku: string; quantity: number; reason: string };
      const id = `po-${Date.now()}`;
      const requestedBy = context.actorId || 'unknown';
      const reason = String(value.reason ?? '').trim();
      database.run(
        `INSERT INTO purchase_orders (id, sku, quantity, status, requested_by, reason, created_at) VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
        [id, value.sku, value.quantity, requestedBy, reason, new Date().toISOString()],
      );
      cup.publish({ resource: { id: orderResource.id }, type: 'updated' });
      return { id };
    },
  }));
  cup.register(defineCapability({
    id: 'inventory.submitPurchaseOrder',
    operation: 'execute',
    version: '1.0',
    sensitivity: 'confidential',
    schema: { type: 'object' },
    inputSchema: {
      type: 'object',
      required: ['orderId'],
      properties: { orderId: { type: 'string' } },
    },
    outputSchema: { type: 'object' },
    sideEffects: ['Sends a purchase order to the supplier'],
    risk: 'high',
    confirmation: 'explicit',
    idempotency: 'required',
    reversibility: 'irreversible',
    handler: async (input) => {
      const value = input as { orderId: string };
      database.run(`UPDATE purchase_orders SET status = 'submitted' WHERE id = ?`, [value.orderId]);
      cup.publish({ resource: { id: orderResource.id }, type: 'updated' });
      return database.get(`SELECT * FROM purchase_orders WHERE id = ?`, [value.orderId]);
    },
  }));
  for (const principal of [nia, agent]) {
    allowExecute(cup, { id: `${principal.id}-adjust`, principal: { id: principal.id }, resourceId: 'inventory.adjust', priority: 20 });
    allowExecute(cup, { id: `${principal.id}-draft`, principal: { id: principal.id }, resourceId: 'inventory.draftPurchaseOrder', priority: 20 });
    allowExecute(cup, { id: `${principal.id}-submit`, principal: { id: principal.id }, resourceId: 'inventory.submitPurchaseOrder', priority: 20 });
  }
  allowExecute(cup, { id: 'ellis-draft', principal: { id: ellis.id }, resourceId: 'inventory.draftPurchaseOrder', priority: 10 });

  const catalog = {
    summary: 'Products are bin-level stock. Purchase orders and stock moves reference a SKU. Unit cost is stripped for buyers on inventory.products. Submit PO is an action on purchase_orders, ops lead and copilot only.',
    resources: [
      { id: 'inventory.products', table: 'products', kind: 'data' as const, description: 'On-hand inventory. unit_cost is hidden from buyers.' },
      { id: 'inventory.orders', table: 'purchase_orders', kind: 'data' as const, description: 'Purchase order headers keyed by SKU.' },
      { id: 'inventory.adjust', table: 'products', kind: 'action' as const, writesTable: 'stock_moves', description: 'Updates products.on_hand and inserts stock_moves.' },
      { id: 'inventory.draftPurchaseOrder', table: 'purchase_orders', kind: 'action' as const, writesTable: 'purchase_orders', description: 'Inserts a draft purchase_orders row.' },
      { id: 'inventory.submitPurchaseOrder', table: 'purchase_orders', kind: 'action' as const, writesTable: 'purchase_orders', description: 'Sets purchase_orders.status to submitted.' },
    ],
    grants: [
      { principalId: nia.id, principalLabel: 'Nia Okonkwo', resourceId: 'inventory.products', mapsToTable: 'products', operations: ['discover', 'inspect', 'read'], recordScope: 'Every products row', hiddenFields: [] },
      { principalId: nia.id, principalLabel: 'Nia Okonkwo', resourceId: 'inventory.orders', mapsToTable: 'purchase_orders', operations: ['discover', 'inspect', 'read'], recordScope: 'Every purchase_orders row', hiddenFields: [] },
      { principalId: nia.id, principalLabel: 'Nia Okonkwo', resourceId: 'inventory.adjust', mapsToTable: 'stock_moves', operations: ['execute'], recordScope: 'May adjust any SKU', hiddenFields: [] },
      { principalId: nia.id, principalLabel: 'Nia Okonkwo', resourceId: 'inventory.draftPurchaseOrder', mapsToTable: 'purchase_orders', operations: ['execute'], recordScope: 'May draft a PO for any SKU', hiddenFields: [] },
      { principalId: nia.id, principalLabel: 'Nia Okonkwo', resourceId: 'inventory.submitPurchaseOrder', mapsToTable: 'purchase_orders', operations: ['execute'], recordScope: 'May submit any draft PO', hiddenFields: [] },
      { principalId: ellis.id, principalLabel: 'Ellis Ward', resourceId: 'inventory.products', mapsToTable: 'products', operations: ['discover', 'inspect', 'read'], recordScope: 'Every products row', hiddenFields: ['unit_cost'] },
      { principalId: ellis.id, principalLabel: 'Ellis Ward', resourceId: 'inventory.orders', mapsToTable: 'purchase_orders', operations: ['discover', 'inspect', 'read'], recordScope: 'Every purchase_orders row', hiddenFields: [] },
      { principalId: ellis.id, principalLabel: 'Ellis Ward', resourceId: 'inventory.draftPurchaseOrder', mapsToTable: 'purchase_orders', operations: ['execute'], recordScope: 'May draft a PO for any SKU', hiddenFields: [] },
      { principalId: agent.id, principalLabel: 'Keel copilot', resourceId: 'inventory.products', mapsToTable: 'products', operations: ['discover', 'inspect', 'read'], recordScope: 'Every products row', hiddenFields: [] },
      { principalId: agent.id, principalLabel: 'Keel copilot', resourceId: 'inventory.orders', mapsToTable: 'purchase_orders', operations: ['discover', 'inspect', 'read'], recordScope: 'Every purchase_orders row', hiddenFields: [] },
      { principalId: agent.id, principalLabel: 'Keel copilot', resourceId: 'inventory.adjust', mapsToTable: 'stock_moves', operations: ['execute'], recordScope: 'May adjust any SKU when acting as the copilot principal', hiddenFields: [] },
      { principalId: agent.id, principalLabel: 'Keel copilot', resourceId: 'inventory.draftPurchaseOrder', mapsToTable: 'purchase_orders', operations: ['execute'], recordScope: 'May draft a PO', hiddenFields: [] },
      { principalId: agent.id, principalLabel: 'Keel copilot', resourceId: 'inventory.submitPurchaseOrder', mapsToTable: 'purchase_orders', operations: ['execute'], recordScope: 'May submit a draft PO', hiddenFields: [] },
    ],
  };
  const principals = [
    { id: nia.id, label: 'Nia Okonkwo', role: 'Ops lead', subject: nia },
    { id: ellis.id, label: 'Ellis Ward', role: 'Buyer', subject: ellis },
    { id: agent.id, label: 'Keel copilot', role: 'Assistant', subject: agent },
  ];
  seedAccessModel(database, catalog, principals);

  return {
    name: 'agent-studio',
    product: 'Keel',
    title: 'Keel',
    subtitle: 'Harbor warehouse: bins, counts, and purchase orders.',
    cup,
    database,
    defaultSubjectId: nia.id,
    catalog,
    pythonAgent: { script: fileURLToPath(new URL('../python/agent.py', import.meta.url)) },
    composeUi: composeKeelUi,
    principals,
  };
}

export function keelDatabaseFile(): string {
  return sqliteFile(import.meta.url);
}
