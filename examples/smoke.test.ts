import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMCPServer, type AuthorizedCapability } from '@capability-ui/core';
import type { ExampleApp, ExamplePrincipal } from './shared/types.ts';
import { createAgentStudio } from './agent-studio/src/domain.ts';
import { createCrmWorkspace } from './crm-workspace/src/domain.ts';
import { createSupportDesk } from './support-desk/src/domain.ts';

function principal(app: ExampleApp, id: string): ExamplePrincipal['subject'] {
  const found = app.principals.find((item: ExamplePrincipal) => item.id === id)?.subject;
  assert.ok(found);
  return found;
}

test('crm workspace redacts Bob and denies mail.send', async () => {
  const app = await createCrmWorkspace();
  const bob = principal(app, 'user:bob');
  const maya = principal(app, 'user:maya');
  const bobView = await app.cup.project({ subject: bob, context: { channel: 'web' } });
  assert.equal(bobView.capabilities.some((item: AuthorizedCapability) => item.id === 'mail.send'), false);
  const page = await app.cup.read({ subject: bob, resource: 'crm.contacts', context: { channel: 'web' } });
  const row = page.items[0] as Record<string, unknown>;
  assert.equal(row.phone, undefined);
  const forged = await app.cup.execute({
    subject: bob,
    capability: 'mail.send',
    input: { to: ['everyone@example.com'], body: 'Hello' },
    context: { channel: 'web' },
  });
  assert.equal(forged.status, 'denied');
  const mayaView = await app.cup.project({ subject: maya, context: { channel: 'web' } });
  assert.equal(mayaView.capabilities.some((item: AuthorizedCapability) => item.id === 'mail.send'), true);
});

test('support desk hides internal notes from the contractor and exposes MCP', async () => {
  const app = await createSupportDesk();
  const rio = principal(app, 'user:rio');
  const aisha = principal(app, 'user:aisha');
  const page = await app.cup.read({ subject: rio, resource: 'support.tickets', context: { channel: 'web' } });
  const row = page.items[0] as Record<string, unknown>;
  assert.equal(row.internalNotes, undefined);
  const forged = await app.cup.execute({
    subject: rio,
    capability: 'tickets.escalate',
    input: { ticketId: 't-1042', reason: 'skip the queue' },
    context: { channel: 'web' },
  });
  assert.equal(forged.status, 'denied');
  const mcp = createMCPServer({ cup: app.cup, name: app.name, authenticate: () => aisha });
  const listed = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { subjectId: aisha.id } });
  const tools = (listed.result as { tools: Array<{ name: string }> }).tools.map((item: { name: string }) => item.name);
  assert.ok(tools.includes('tickets.escalate'));
});

test('agent studio lets the ops lead draft a purchase order', async () => {
  const app = await createAgentStudio();
  const nia = principal(app, 'user:nia');
  const ellis = principal(app, 'user:ellis');
  const receipt = await app.cup.execute({
    subject: nia,
    capability: 'inventory.draftPurchaseOrder',
    input: { sku: 'WID-200', quantity: 50, reason: 'Harbor widget below reorder' },
    context: { channel: 'web', purpose: 'example' },
  });
  assert.equal(receipt.status, 'succeeded');
  const drafted = app.database?.get<{ requested_by: string; reason: string }>(
    `SELECT requested_by, reason FROM purchase_orders WHERE sku = ? ORDER BY created_at DESC`,
    ['WID-200'],
  );
  assert.equal(drafted?.requested_by, nia.id);
  assert.equal(drafted?.reason, 'Harbor widget below reorder');
  const orders = await app.cup.read({ subject: nia, resource: 'inventory.orders', context: { channel: 'web' } });
  const created = orders.items.find((item: unknown) => (item as { sku: string }).sku === 'WID-200') as {
    requestedBy?: string;
    reason?: string;
  };
  assert.equal(created?.requestedBy, nia.id);
  assert.equal(created?.reason, 'Harbor widget below reorder');
  const ellisPage = await app.cup.read({ subject: ellis, resource: 'inventory.products', context: { channel: 'web' } });
  const widget = ellisPage.items.find((item: unknown) => (item as { sku: string }).sku === 'WID-200') as Record<string, unknown>;
  assert.equal(widget.unitCost, undefined);
  const forged = await app.cup.execute({
    subject: ellis,
    capability: 'inventory.submitPurchaseOrder',
    input: { orderId: 'po-20' },
    context: { channel: 'web' },
  });
  assert.equal(forged.status, 'denied');
});

test('keel composes generative UI from the authorized view', async () => {
  const app = await createAgentStudio();
  const nia = principal(app, 'user:nia');
  const ellis = principal(app, 'user:ellis');
  const niaView = await app.cup.project({ subject: nia, context: { channel: 'web' } });
  const ellisView = await app.cup.project({ subject: ellis, context: { channel: 'web' } });
  assert.ok(app.composeUi);
  const dashboard = app.composeUi({ view: niaView, message: 'Build a warehouse dashboard', surfaces: [] });
  assert.deepEqual(dashboard.surfaces.map((item) => item.id), [
    'stat:lowStockCount',
    'stat:draftCount',
    'stat:onHandTotal',
  ]);
  assert.equal(dashboard.surfaces.every((item) => item.kind === 'stat'), true);
  const form = app.composeUi({ view: niaView, message: 'Add a draft purchase order form', surfaces: [] });
  assert.deepEqual(form.surfaces.map((item) => item.id), ['form:inventory.draftPurchaseOrder']);
  const low = app.composeUi({ view: niaView, message: 'Add a low-stock table', surfaces: [] });
  assert.deepEqual(low.surfaces.map((item) => item.id), ['table:products-low']);
  const adjust = app.composeUi({ view: niaView, message: 'Add a count adjustment form', surfaces: [] });
  assert.deepEqual(adjust.surfaces.map((item) => item.id), ['form:inventory.adjust']);
  const orders = app.composeUi({ view: niaView, message: 'Show purchase orders', surfaces: [] });
  assert.deepEqual(orders.surfaces.map((item) => item.id), ['table:orders']);
  const briefing = app.composeUi({
    view: niaView,
    message: 'Morning dock briefing: low-stock as cards with SKU and bin only, plus a note for the pick crew',
    surfaces: [],
  });
  assert.equal(briefing.surfaces.some((item) => item.kind === 'notice'), true);
  assert.equal(briefing.surfaces.some((item) => item.kind === 'cards' && item.columns?.join() === 'sku,bin'), true);
  const sheet = app.composeUi({
    view: niaView,
    message: 'Night count sheet with only SKU, bin, and on hand',
    surfaces: [],
  });
  assert.deepEqual(sheet.surfaces.map((item) => item.columns), [['sku', 'bin', 'onHand']]);
  assert.equal(sheet.surfaces.every((item) => item.kind === 'table'), true);
  const worklist = app.composeUi({
    view: niaView,
    message: 'Supplier restock worklist as cards, no unit cost',
    surfaces: [],
  });
  assert.equal(worklist.surfaces[0]?.kind, 'cards');
  assert.equal(worklist.surfaces[0]?.columns?.includes('unitCost'), false);
  const desk = app.composeUi({
    view: niaView,
    message: 'Submit desk: only draft purchase orders and a send form',
    surfaces: [],
  });
  assert.equal(desk.surfaces.some((item) => item.filter === 'drafts'), true);
  assert.equal(desk.surfaces.some((item) => item.capabilityId === 'inventory.submitPurchaseOrder'), true);
  const buyerDesk = app.composeUi({
    view: ellisView,
    message: 'Submit desk: only draft purchase orders and a send form',
    surfaces: [],
  });
  assert.equal(buyerDesk.surfaces.some((item) => item.capabilityId === 'inventory.submitPurchaseOrder'), false);
  const buyer = app.composeUi({ view: ellisView, message: 'Build a warehouse dashboard', surfaces: dashboard.surfaces });
  assert.equal(buyer.surfaces.some((item) => item.capabilityId === 'inventory.submitPurchaseOrder'), false);
  assert.equal(buyer.surfaces.some((item) => item.columns?.includes('unitCost')), false);
  const cleared = app.composeUi({ view: niaView, message: 'Clear the canvas', surfaces: dashboard.surfaces });
  assert.equal(cleared.surfaces.length, 0);
});

test('sqlite explorer is read-only and lists the CRM model', async () => {
  const app = await createCrmWorkspace();
  assert.ok(app.database);
  const tables = app.database.schema().map((table: { name: string }) => table.name);
  assert.deepEqual(tables, [
    'access_grant_operations',
    'access_grants',
    'access_hidden_fields',
    'access_principals',
    'access_resources',
    'contacts',
    'notes',
    'outbound_mail',
  ]);
  const notes = app.database.schema().find((table) => table.name === 'notes');
  assert.equal(notes?.foreignKeys[0]?.toTable, 'contacts');
  const grants = app.database.schema().find((table) => table.name === 'access_grants');
  assert.equal(grants?.foreignKeys.some((key) => key.toTable === 'access_principals'), true);
  const hidden = app.database.query('SELECT field FROM access_hidden_fields ORDER BY field');
  assert.deepEqual(hidden.rows.map((row) => row[0]), ['amount', 'personal_email', 'phone']);
  assert.ok(app.catalog?.grants.some((grant) => grant.hiddenFields.includes('amount')));
  assert.throws(() => app.database?.query('DELETE FROM contacts'));
  const count = app.database.query('SELECT COUNT(*) FROM contacts');
  assert.equal(count.rows[0]?.[0], 6);
});
