import type { AuthorizedView } from '@capability-ui/core';
import type { ComposeUiInput, ComposeUiResult, SurfaceFilter, SurfaceKind, UiSurface } from '../../shared/types.ts';

export const KEEL_UI_SUGGESTIONS = [
  'Build a warehouse dashboard',
  'Add a low-stock table',
  'Add a draft purchase order form',
  'Add a count adjustment form',
  'Show purchase orders',
  'Clear the canvas',
] as const;

export const KEEL_CHAT_PROMPTS = [
  'Morning dock briefing: low-stock as cards with SKU and bin only, plus a note for the pick crew',
  'Night count sheet with only SKU, bin, and on hand',
  'Supplier restock worklist as cards, no unit cost',
  'Submit desk: only draft purchase orders and a send form',
] as const;

const PRODUCT_COLUMNS = ['sku', 'name', 'bin', 'onHand', 'reorderPoint', 'unitCost', 'supplier'];
const ORDER_COLUMNS = ['id', 'sku', 'quantity', 'status', 'reason', 'requestedBy'];

const FIELD_ALIASES: Array<{ phrases: string[]; column: string; resource: 'products' | 'orders' | 'both' }> = [
  { phrases: ['sku'], column: 'sku', resource: 'both' },
  { phrases: ['name', 'item'], column: 'name', resource: 'products' },
  { phrases: ['bin'], column: 'bin', resource: 'products' },
  { phrases: ['on hand', 'onhand'], column: 'onHand', resource: 'products' },
  { phrases: ['reorder'], column: 'reorderPoint', resource: 'products' },
  { phrases: ['unit cost', 'unitcost', 'cost'], column: 'unitCost', resource: 'products' },
  { phrases: ['supplier'], column: 'supplier', resource: 'products' },
  { phrases: ['quantity', 'qty'], column: 'quantity', resource: 'orders' },
  { phrases: ['status'], column: 'status', resource: 'orders' },
  { phrases: ['reason'], column: 'reason', resource: 'orders' },
  { phrases: ['requested by', 'requestedby'], column: 'requestedBy', resource: 'orders' },
  { phrases: ['po', 'order id', 'orderid'], column: 'id', resource: 'orders' },
];

function isSurfaceKind(value: string): value is SurfaceKind {
  switch (value) {
    case 'table':
    case 'form':
    case 'stat':
    case 'cards':
    case 'notice':
      return true;
    default:
      return false;
  }
}

function readableResource(view: AuthorizedView, id: string): boolean {
  return view.resources.some(resource => resource.ref.id === id && (resource.visibility === 'readable' || resource.visibility === 'usable'));
}

function unreadFields(view: AuthorizedView, resourceId: string): Set<string> {
  const resource = view.resources.find(item => item.ref.id === resourceId);
  return new Set((resource?.fields ?? []).filter(field => field.readable === false).map(field => field.path));
}

function canExecute(view: AuthorizedView, capabilityId: string): boolean {
  return view.capabilities.some(item => item.id === capabilityId);
}

function visibleColumns(view: AuthorizedView, resourceId: string, requested: string[]): string[] | undefined {
  const unread = unreadFields(view, resourceId);
  const columns = requested.filter(column => !unread.has(column));
  return columns.length ? columns : undefined;
}

function surfaceId(kind: SurfaceKind, key: string): string {
  return `${kind}:${key}`;
}

function productsTable(
  view: AuthorizedView,
  filter: SurfaceFilter,
  options: { title?: string; key?: string; columns?: string[] } = {},
): UiSurface | undefined {
  if (!readableResource(view, 'inventory.products')) return undefined;
  const low = filter === 'belowReorder';
  const columns = visibleColumns(view, 'inventory.products', options.columns ?? PRODUCT_COLUMNS);
  return {
    id: surfaceId('table', options.key ?? (low ? 'products-low' : 'products')),
    title: options.title ?? (low ? 'Below reorder' : 'On hand'),
    kind: 'table',
    resourceId: 'inventory.products',
    filter,
    columns,
  };
}

function ordersTable(
  view: AuthorizedView,
  filter: SurfaceFilter,
  options: { title?: string; key?: string; columns?: string[] } = {},
): UiSurface | undefined {
  if (!readableResource(view, 'inventory.orders')) return undefined;
  const drafts = filter === 'drafts';
  return {
    id: surfaceId('table', options.key ?? (drafts ? 'orders-drafts' : 'orders')),
    title: options.title ?? (drafts ? 'Draft purchase orders' : 'Purchase orders'),
    kind: 'table',
    resourceId: 'inventory.orders',
    filter,
    columns: visibleColumns(view, 'inventory.orders', options.columns ?? ORDER_COLUMNS),
  };
}

function productCards(
  view: AuthorizedView,
  options: { title?: string; key?: string; filter?: SurfaceFilter; columns?: string[] } = {},
): UiSurface | undefined {
  if (!readableResource(view, 'inventory.products')) return undefined;
  const filter = options.filter ?? 'belowReorder';
  return {
    id: surfaceId('cards', options.key ?? 'products-low'),
    title: options.title ?? 'Bins that need a buy',
    kind: 'cards',
    resourceId: 'inventory.products',
    filter,
    columns: options.columns
      ? visibleColumns(view, 'inventory.products', options.columns)
      : undefined,
  };
}

function formSurface(view: AuthorizedView, capabilityId: string, title: string): UiSurface | undefined {
  if (!canExecute(view, capabilityId)) return undefined;
  return {
    id: surfaceId('form', capabilityId),
    title,
    kind: 'form',
    capabilityId,
  };
}

function statSurface(view: AuthorizedView, metric: UiSurface['metric'], title: string, resourceId: string): UiSurface | undefined {
  if (!metric || !readableResource(view, resourceId)) return undefined;
  return {
    id: surfaceId('stat', metric),
    title,
    kind: 'stat',
    resourceId,
    metric,
  };
}

function constrainSurface(view: AuthorizedView, surface: UiSurface): UiSurface | undefined {
  if (!isSurfaceKind(surface.kind)) return undefined;
  switch (surface.kind) {
    case 'table': {
      if (!surface.resourceId || !readableResource(view, surface.resourceId)) return undefined;
      return {
        ...surface,
        columns: visibleColumns(view, surface.resourceId, surface.columns ?? (
          surface.resourceId === 'inventory.orders' ? ORDER_COLUMNS : PRODUCT_COLUMNS
        )),
      };
    }
    case 'cards':
      if (!surface.resourceId || !readableResource(view, surface.resourceId)) return undefined;
      return surface;
    case 'stat':
      if (!surface.resourceId || !readableResource(view, surface.resourceId)) return undefined;
      return surface;
    case 'form':
      if (!surface.capabilityId || !canExecute(view, surface.capabilityId)) return undefined;
      return surface;
    case 'notice':
      return surface;
    default: {
      const _exhaustive: never = surface.kind;
      void _exhaustive;
      return undefined;
    }
  }
}

export function constrainSurfaces(view: AuthorizedView, surfaces: UiSurface[]): UiSurface[] {
  const output: UiSurface[] = [];
  for (const surface of surfaces) {
    const next = constrainSurface(view, surface);
    if (next) output.push(next);
  }
  return output;
}

function upsert(existing: UiSurface[], additions: UiSurface[]): UiSurface[] {
  const byId = new Map(existing.map(item => [item.id, item]));
  for (const item of additions) byId.set(item.id, item);
  return [...byId.values()];
}

function compact(view: AuthorizedView, items: Array<UiSurface | undefined>): UiSurface[] {
  return constrainSurfaces(view, items.filter((item): item is UiSurface => Boolean(item)));
}

export function parseCupUiBlock(text: string): { op: 'upsert' | 'replace' | 'clear'; surfaces: UiSurface[] } | undefined {
  const match = text.match(/```cup-ui\s*([\s\S]*?)```/i);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1] ?? '') as { op?: string; surfaces?: UiSurface[] };
    const op = parsed.op === 'replace' || parsed.op === 'clear' || parsed.op === 'upsert' ? parsed.op : 'upsert';
    return { op, surfaces: Array.isArray(parsed.surfaces) ? parsed.surfaces : [] };
  } catch {
    return undefined;
  }
}

export function stripCupUiBlock(text: string): string {
  return text.replace(/```cup-ui\s*[\s\S]*?```/gi, '').trim();
}

function applyCupUiOp(
  view: AuthorizedView,
  current: UiSurface[],
  patch: { op: 'upsert' | 'replace' | 'clear'; surfaces: UiSurface[] },
): UiSurface[] {
  switch (patch.op) {
    case 'clear':
      return [];
    case 'replace':
      return constrainSurfaces(view, patch.surfaces);
    case 'upsert':
      return constrainSurfaces(view, upsert(current, patch.surfaces));
    default: {
      const _exhaustive: never = patch.op;
      return _exhaustive;
    }
  }
}

function slug(value: string): string {
  const trimmed = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return trimmed.slice(0, 48) || 'generated';
}

function headline(message: string): string {
  const beforeColon = message.split(':')[0]?.trim() ?? message;
  if (beforeColon.length > 0 && beforeColon.length <= 48) return beforeColon;
  return message.split(/\s+/).slice(0, 6).join(' ');
}

function parseRequestedColumns(text: string, resource: 'products' | 'orders'): string[] {
  const catalog = resource === 'products' ? PRODUCT_COLUMNS : ORDER_COLUMNS;
  const aliases = FIELD_ALIASES.filter(item => item.resource === resource || item.resource === 'both');
  const found: string[] = [];
  for (const alias of aliases) {
    if (alias.phrases.some(phrase => (
      phrase.includes(' ') ? text.includes(phrase) : new RegExp(`\\b${phrase}\\b`).test(text)
    ))) found.push(alias.column);
  }
  const unique = [...new Set(found)].filter(column => catalog.includes(column));
  if (/\b(no|hide|without|drop)\b.{0,20}\b(unit )?cost\b/.test(text)) {
    const withoutCost = unique.filter(column => column !== 'unitCost');
    return withoutCost.length ? withoutCost : catalog.filter(column => column !== 'unitCost');
  }
  if (/\bonly\b/.test(text)) return unique;
  return unique;
}

function planGeneratedUi(view: AuthorizedView, message: string): UiSurface[] {
  const text = message.toLowerCase();
  const title = headline(message);
  const key = slug(title);
  const asCards = /\b(cards?|tiles?|worklist)\b/.test(text);
  const briefing = /\b(briefing|memo|note for|pick crew)\b/.test(text);
  const low = /\b(low[- ]?stock|below reorder|restock)\b/.test(text);
  const drafts = /\bdrafts?\b/.test(text);
  const submit = /\b(submit|send form|send desk)\b/.test(text);
  const draftForm = /\bdraft (a )?(po |purchase )?form\b/.test(text);
  const adjust = /\b(count adjustment|adjust(?:ment)? form|adjust (a )?count)\b/.test(text);
  const ordersFocus = /\b(purchase orders?|draft pos?|submit desk|send form)\b/.test(text)
    && !low
    && !/\b(sku|bin|on hand|inventory|count sheet)\b/.test(text);
  const productColumns = parseRequestedColumns(text, 'products');
  const orderColumns = parseRequestedColumns(text, 'orders');
  const onlyColumns = /\bonly\b/.test(text) || productColumns.length > 0;

  const items: Array<UiSurface | undefined> = [];
  if (briefing) {
    items.push({
      id: surfaceId('notice', key),
      title,
      kind: 'notice',
      body: message.replace(/^[^:]+:\s*/, '').trim() || message,
    });
  }
  if (asCards && readableResource(view, 'inventory.products')) {
    items.push(productCards(view, {
      title,
      key,
      filter: low ? 'belowReorder' : 'all',
      columns: productColumns.length ? productColumns : undefined,
    }));
  } else if (ordersFocus) {
    items.push(ordersTable(view, drafts || submit ? 'drafts' : 'all', {
      title,
      key,
      columns: orderColumns.length ? orderColumns : undefined,
    }));
  } else if (onlyColumns || low || /\b(count sheet|inventory|on hand|sku|bin)\b/.test(text)) {
    items.push(productsTable(view, low ? 'belowReorder' : 'all', {
      title,
      key,
      columns: productColumns.length ? productColumns : undefined,
    }));
  }
  if (draftForm) {
    items.push(formSurface(view, 'inventory.draftPurchaseOrder', 'Draft a purchase order'));
  }
  if (submit) {
    items.push(formSurface(view, 'inventory.submitPurchaseOrder', 'Submit a draft'));
  }
  if (adjust) {
    items.push(formSurface(view, 'inventory.adjust', 'Adjust a count'));
  }
  return compact(view, items);
}

function dashboard(view: AuthorizedView): UiSurface[] {
  return compact(view, [
    statSurface(view, 'lowStockCount', 'Below reorder', 'inventory.products'),
    statSurface(view, 'draftCount', 'Open drafts', 'inventory.orders'),
    statSurface(view, 'onHandTotal', 'Units on hand', 'inventory.products'),
  ]);
}

function describe(surfaces: UiSurface[]): string {
  if (!surfaces.length) {
    return 'The floor is empty. Ask for a table, form, cards, or a full dashboard. CUP still decides what each shift is allowed to see and run.';
  }
  const names = surfaces.map(item => item.title).join(', ');
  return `On the floor now: ${names}. Ask to add another component, swap the layout, or clear the canvas.`;
}

function chipAdditions(view: AuthorizedView, message: string): UiSurface[] | undefined {
  if (!(KEEL_UI_SUGGESTIONS as readonly string[]).includes(message)) return undefined;
  const label = message as (typeof KEEL_UI_SUGGESTIONS)[number];
  switch (label) {
    case 'Build a warehouse dashboard':
      return dashboard(view);
    case 'Add a low-stock table':
      return compact(view, [productsTable(view, 'belowReorder')]);
    case 'Add a draft purchase order form':
      return compact(view, [formSurface(view, 'inventory.draftPurchaseOrder', 'Draft a purchase order')]);
    case 'Add a count adjustment form':
      return compact(view, [formSurface(view, 'inventory.adjust', 'Adjust a count')]);
    case 'Show purchase orders':
      return compact(view, [ordersTable(view, 'all')]);
    case 'Clear the canvas':
      return [];
    default: {
      const _exhaustive: never = label;
      void _exhaustive;
      return undefined;
    }
  }
}

function freeTextAdditions(view: AuthorizedView, message: string): { additions: UiSurface[]; replace: boolean; skippedSubmit: boolean } {
  const planned = planGeneratedUi(view, message);
  if (planned.length) {
    return {
      additions: planned,
      replace: false,
      skippedSubmit: /\b(submit|send form|send desk)\b/.test(message.toLowerCase())
        && !canExecute(view, 'inventory.submitPurchaseOrder'),
    };
  }
  const text = message.toLowerCase();
  if (/\b(dashboard|overview|yard view|warehouse (screen|ui|view)|full (screen|floor)|kpis?)\b/.test(text)) {
    return { additions: dashboard(view), replace: false, skippedSubmit: false };
  }
  if (/\b(low[- ]?stock|below reorder|short(?:age)?s?|need(s)? a buy)\b/.test(text)
    && /\b(card|tile)s?\b/.test(text)) {
    return { additions: compact(view, [productCards(view)]), replace: false, skippedSubmit: false };
  }
  if (/\b(low[- ]?stock|below reorder|short(?:age)?s?|need(s)? a buy)\b/.test(text)) {
    return { additions: compact(view, [productsTable(view, 'belowReorder')]), replace: false, skippedSubmit: false };
  }
  if (/\b(cards?|tiles?|bin(?:s)? that need)\b/.test(text)) {
    return { additions: compact(view, [productCards(view)]), replace: false, skippedSubmit: false };
  }
  if (/\b(draft).*(form|po|purchase)|purchase order form|(add|build|make|show).*(draft).*(form|po|order)\b/.test(text)) {
    return {
      additions: compact(view, [formSurface(view, 'inventory.draftPurchaseOrder', 'Draft a purchase order')]),
      replace: false,
      skippedSubmit: false,
    };
  }
  if (/\b(count adjustment|adjust(?:ment)? form|correction form|stock move|adjust (a )?count)\b/.test(text)) {
    return {
      additions: compact(view, [formSurface(view, 'inventory.adjust', 'Adjust a count')]),
      replace: false,
      skippedSubmit: false,
    };
  }
  if (/\b(submit).*(form|po|order)|send (the )?order\b/.test(text)) {
    const additions = compact(view, [formSurface(view, 'inventory.submitPurchaseOrder', 'Submit a draft')]);
    return {
      additions,
      replace: false,
      skippedSubmit: !canExecute(view, 'inventory.submitPurchaseOrder'),
    };
  }
  if (/\b(drafts?)\b/.test(text) && /\b(order|po|purchase|table|list)\b/.test(text)) {
    return { additions: compact(view, [ordersTable(view, 'drafts')]), replace: false, skippedSubmit: false };
  }
  if (/\b(purchase orders?|po list|orders? table|show (the )?orders)\b/.test(text)) {
    return { additions: compact(view, [ordersTable(view, 'all')]), replace: false, skippedSubmit: false };
  }
  if (/\b(inventory|on hand|stock table|products?)\b/.test(text)) {
    return { additions: compact(view, [productsTable(view, 'all')]), replace: false, skippedSubmit: false };
  }
  return { additions: [], replace: false, skippedSubmit: false };
}

export function composeKeelUi(input: ComposeUiInput): ComposeUiResult {
  const message = input.message.trim();
  const text = message.toLowerCase();
  const current = constrainSurfaces(input.view, input.surfaces);
  const suggestions = [...KEEL_UI_SUGGESTIONS];
  const prompts = [...KEEL_CHAT_PROMPTS];

  if (!message) {
    return { text: describe(current), surfaces: current, suggestions, prompts };
  }

  if ((/\b(clear|reset|empty)\b/.test(text) && /\b(canvas|floor|board|layout)\b/.test(text))
    || text === 'start over') {
    return {
      text: 'Canvas cleared. Add a table, a form, or a dashboard when you want something on the floor.',
      surfaces: [],
      suggestions,
      prompts,
    };
  }

  const parsed = parseCupUiBlock(message);
  if (parsed) {
    const surfaces = applyCupUiOp(input.view, current, parsed);
    return { text: describe(surfaces), surfaces, suggestions, prompts };
  }

  const fromChip = chipAdditions(input.view, message);
  const resolved = fromChip
    ? { additions: fromChip, replace: false, skippedSubmit: false }
    : freeTextAdditions(input.view, message);

  if (!resolved.additions.length && message !== 'Clear the canvas') {
    return {
      text: [
        'I generate warehouse UI from what this shift may see and do.',
        'Ask for a table, form, cards, stats, or a dashboard. Try a prompt under the copilot: a briefing, a count sheet, a worklist, or a submit desk.',
        describe(current),
      ].join(' '),
      surfaces: current,
      suggestions,
      prompts,
    };
  }

  const surfaces = resolved.replace ? resolved.additions : upsert(current, resolved.additions);
  const note = resolved.skippedSubmit
    ? ' Submit stays off this floor: this shift cannot run inventory.submitPurchaseOrder.'
    : '';
  const dashboardNote = message === 'Build a warehouse dashboard'
    ? 'KPI cards added for this shift: below reorder, open drafts, and units on hand.'
    : `${describe(surfaces)}${note}`;
  return {
    text: dashboardNote,
    surfaces,
    suggestions,
    prompts,
  };
}
