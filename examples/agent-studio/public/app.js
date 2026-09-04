import { api, href, money, runAction } from './client.js';

const DEFAULT_SUGGESTIONS = [
  'Build a warehouse dashboard',
  'Add a low-stock table',
  'Add a draft purchase order form',
  'Add a count adjustment form',
  'Show purchase orders',
];

const DEFAULT_PROMPTS = [
  'Morning dock briefing: low-stock as cards with SKU and bin only, plus a note for the pick crew',
  'Night count sheet with only SKU, bin, and on hand',
  'Supplier restock worklist as cards, no unit cost',
  'Submit desk: only draft purchase orders and a send form',
];

const state = {
  meta: null,
  subjectId: '',
  view: null,
  products: [],
  orders: [],
  surfaces: [],
  suggestions: DEFAULT_SUGGESTIONS,
  prompts: DEFAULT_PROMPTS,
};

function $(id) { return document.getElementById(id); }

function unused(_value) {
  throw new Error(`Unhandled surface kind: ${_value}`);
}

function cellValue(row, key) {
  const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const value = row[key] ?? row[snake];
  if (value == null || value === '') return '—';
  if (key === 'unitCost') return money(value);
  return String(value);
}

function personName(id) {
  const found = state.meta?.principals.find((item) => item.id === id);
  if (found) return found.label;
  if (!id) return '—';
  return String(id).replace(/^(user|agent):/, '');
}

function capability(id) {
  return state.view?.capabilities.find((item) => item.id === id);
}

function can(id) {
  return Boolean(capability(id));
}

function filteredRows(surface) {
  const resourceId = surface.resourceId;
  const rows = resourceId === 'inventory.orders' ? state.orders : state.products;
  switch (surface.filter) {
    case 'belowReorder':
      return rows.filter((row) => Number(row.onHand) < Number(row.reorderPoint));
    case 'drafts':
      return rows.filter((row) => row.status === 'draft');
    case 'all':
    case undefined:
      return rows;
    default:
      return rows;
  }
}

async function loadData() {
  const [products, orders, view] = await Promise.all([
    api(`/api/read?subject=${encodeURIComponent(state.subjectId)}&resource=inventory.products`),
    api(`/api/read?subject=${encodeURIComponent(state.subjectId)}&resource=inventory.orders`),
    api(`/api/view?subject=${encodeURIComponent(state.subjectId)}`),
  ]);
  state.products = products.items;
  state.orders = orders.items;
  state.view = view;
}

function btn(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function tableEl(columns, rows, actions) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const table = document.createElement('table');
  table.innerHTML = `<thead><tr>${columns.map((column) => `<th>${column.label}</th>`).join('')}${actions ? '<th></th>' : ''}</tr></thead>`;
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const column of columns) {
      const td = document.createElement('td');
      const snake = column.key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      const value = row[column.key] ?? row[snake];
      td.textContent = column.format ? column.format(value, row) : cellValue(row, column.key);
      if (column.alert && column.alert(row)) td.className = 'low';
      tr.append(td);
    }
    if (actions) {
      const td = document.createElement('td');
      td.append(actions(row));
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

function fieldControl(name, schema) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = name;
  wrap.append(caption);
  if (Array.isArray(schema?.enum)) {
    const select = document.createElement('select');
    select.name = name;
    for (const value of schema.enum) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = String(value);
      select.append(option);
    }
    wrap.append(select);
    return wrap;
  }
  const input = document.createElement(schema?.type === 'string' && (schema?.maxLength ?? 0) > 80 ? 'textarea' : 'input');
  input.name = name;
  if (schema?.type === 'number' || schema?.type === 'integer') input.type = 'number';
  else if (schema?.type === 'boolean') input.type = 'checkbox';
  else input.type = 'text';
  wrap.append(input);
  return wrap;
}

function readForm(form, schema) {
  const properties = schema?.properties ?? {};
  const data = {};
  for (const [name, fieldSchema] of Object.entries(properties)) {
    const control = form.elements.namedItem(name);
    if (!control) continue;
    const type = fieldSchema?.type;
    if (type === 'boolean') data[name] = Boolean(control.checked);
    else if (type === 'number' || type === 'integer') data[name] = control.value === '' ? undefined : Number(control.value);
    else data[name] = control.value;
  }
  return data;
}

function dialogForm(title, fields, onSubmit) {
  const dialog = $('dialog');
  dialog.innerHTML = `<form class="stack" method="dialog"><h2>${title}</h2>${fields}<button type="submit">Save</button><button type="button" id="cancel" value="cancel">Cancel</button></form>`;
  dialog.showModal();
  dialog.querySelector('#cancel').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    onSubmit(Object.fromEntries(new FormData(event.currentTarget)));
    dialog.close();
  });
}

function adjust(row) {
  dialogForm(
    `Adjust ${row.sku}`,
    `<input name="delta" type="number" required placeholder="Delta, e.g. -2" /><input name="reason" required placeholder="Reason" />`,
    async (data) => {
      await runAction({
        subjectId: state.subjectId,
        capability: 'inventory.adjust',
        input: { sku: row.sku, delta: Number(data.delta), reason: data.reason },
      });
      await loadData();
      render();
    },
  );
}

function draft(row) {
  dialogForm(
    `Draft PO for ${row.sku}`,
    `<input name="quantity" type="number" required min="1" value="${Math.max(row.reorderPoint - row.onHand, 1)}" /><input name="reason" required placeholder="Why this order?" />`,
    async (data) => {
      await runAction({
        subjectId: state.subjectId,
        capability: 'inventory.draftPurchaseOrder',
        input: { sku: row.sku, quantity: Number(data.quantity), reason: data.reason },
      });
      await loadData();
      render();
    },
  );
}

async function submit(row) {
  await runAction({
    subjectId: state.subjectId,
    capability: 'inventory.submitPurchaseOrder',
    input: { orderId: row.id },
  });
  await loadData();
  render();
}

function metricValue(surface) {
  switch (surface.metric) {
    case 'lowStockCount':
      return String(state.products.filter((item) => Number(item.onHand) < Number(item.reorderPoint)).length);
    case 'draftCount':
      return String(state.orders.filter((item) => item.status === 'draft').length);
    case 'onHandTotal':
      return String(state.products.reduce((sum, item) => sum + (Number(item.onHand) || 0), 0));
    default:
      return '—';
  }
}

function removeSurface(id) {
  state.surfaces = state.surfaces.filter((item) => item.id !== id);
  render();
}

function renderTable(surface) {
  const rows = filteredRows(surface);
  const keys = surface.columns?.length
    ? surface.columns
    : (rows[0] ? Object.keys(rows[0]) : []);
  const columns = keys.map((key) => ({
    key,
    label: key.replace(/([A-Z])/g, ' $1'),
    alert: key === 'onHand' ? (row) => Number(row.onHand) < Number(row.reorderPoint) : undefined,
    format: key === 'requestedBy' ? (value) => personName(value) : undefined,
  }));
  const rowActions = (row) => {
    const cell = document.createElement('div');
    cell.className = 'btn-row';
    if (surface.resourceId === 'inventory.products') {
      if (can('inventory.adjust')) cell.append(btn('Adjust', () => adjust(row)));
      if (can('inventory.draftPurchaseOrder')) cell.append(btn('Draft PO', () => draft(row)));
    }
    if (surface.resourceId === 'inventory.orders' && can('inventory.submitPurchaseOrder') && row.status === 'draft') {
      cell.append(btn('Submit to supplier', () => submit(row)));
    }
    return cell;
  };
  const hasActions = surface.resourceId === 'inventory.products'
    ? can('inventory.adjust') || can('inventory.draftPurchaseOrder')
    : surface.resourceId === 'inventory.orders' && can('inventory.submitPurchaseOrder');
  return tableEl(columns, rows, hasActions ? rowActions : undefined);
}

function renderForm(surface) {
  const cap = capability(surface.capabilityId);
  const section = document.createElement('form');
  section.className = 'generated-form';
  if (!cap) {
    section.innerHTML = '<p class="quiet">This form is not on this shift.</p>';
    return section;
  }
  const properties = cap.inputSchema?.properties ?? {};
  for (const [name, schema] of Object.entries(properties)) section.append(fieldControl(name, schema));
  const run = document.createElement('button');
  run.type = 'submit';
  run.textContent = cap.confirmation === 'none' ? 'Run' : 'Preview and run';
  section.append(run);
  section.addEventListener('submit', async (event) => {
    event.preventDefault();
    await runAction({
      subjectId: state.subjectId,
      capability: cap.id,
      input: readForm(section, cap.inputSchema),
    });
    await loadData();
    render();
  });
  return section;
}

function renderStat(surface) {
  const card = document.createElement('div');
  card.className = 'stat';
  card.innerHTML = `<strong>${metricValue(surface)}</strong>`;
  return card;
}

function renderCards(surface) {
  const grid = document.createElement('div');
  grid.className = 'card-grid';
  const rows = filteredRows(surface);
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'quiet';
    empty.textContent = 'No matching bins.';
    grid.append(empty);
    return grid;
  }
  const fields = surface.columns?.length ? surface.columns : ['sku', 'name', 'onHand', 'reorderPoint', 'bin'];
  for (const row of rows) {
    const card = document.createElement('article');
    card.className = 'bin-card';
    for (const field of fields) {
      const line = document.createElement(field === fields[0] ? 'strong' : 'span');
      if (field === 'onHand') line.className = 'low';
      line.textContent = `${field}: ${cellValue(row, field)}`;
      if (field === fields[0] && (row.sku || row.name)) line.textContent = String(row.sku ?? row.name);
      card.append(line);
    }
    const actions = document.createElement('div');
    actions.className = 'btn-row';
    if (can('inventory.draftPurchaseOrder')) actions.append(btn('Draft PO', () => draft(row)));
    if (can('inventory.adjust')) actions.append(btn('Adjust', () => adjust(row)));
    card.append(actions);
    grid.append(card);
  }
  return grid;
}

function renderNotice(surface) {
  const note = document.createElement('p');
  note.className = 'notice';
  note.textContent = surface.body || surface.title;
  return note;
}

function renderSurface(surface) {
  const article = document.createElement('article');
  article.className = `surface surface-${surface.kind}`;
  const head = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = surface.title;
  const remove = btn('Remove', () => removeSurface(surface.id));
  remove.className = 'ghost';
  head.append(title, remove);
  article.append(head);
  switch (surface.kind) {
    case 'table':
      article.append(renderTable(surface));
      break;
    case 'form':
      article.append(renderForm(surface));
      break;
    case 'stat':
      article.append(renderStat(surface));
      break;
    case 'cards':
      article.append(renderCards(surface));
      break;
    case 'notice':
      article.append(renderNotice(surface));
      break;
    default:
      unused(surface.kind);
  }
  return article;
}

function renderPrompts() {
  const root = $('chat-prompts');
  if (!root) return;
  root.replaceChildren();
  for (const label of state.prompts) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'prompt';
    chip.textContent = label;
    chip.addEventListener('click', () => {
      void ask(label);
    });
    root.append(chip);
  }
}

function renderSuggestions() {
  const root = $('suggestions');
  root.replaceChildren();
  for (const label of state.suggestions) {
    if (label.toLowerCase().includes('clear')) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = label;
    chip.addEventListener('click', () => {
      void ask(label);
    });
    root.append(chip);
  }
}

function renderFloor() {
  const floor = $('floor');
  const lede = $('canvas-lede');
  const clear = $('clear-floor');
  clear.hidden = state.surfaces.length === 0;
  if (!state.surfaces.length) {
    lede.textContent = 'This floor starts empty. Ask the copilot for a table, form, cards, stats, or a whole dashboard. CUP still decides what this shift can see and run.';
    floor.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<p>No generated components yet.</p><p class="quiet">Try a chip, or type something like "add a draft purchase order form".</p>';
    floor.append(empty);
    return;
  }
  lede.textContent = `${state.surfaces.length} generated component${state.surfaces.length === 1 ? '' : 's'} for this shift.`;
  const stats = state.surfaces.filter((item) => item.kind === 'stat');
  const rest = state.surfaces.filter((item) => item.kind !== 'stat');
  floor.replaceChildren();
  if (stats.length) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    for (const surface of stats) row.append(renderSurface(surface));
    floor.append(row);
  }
  for (const surface of rest) floor.append(renderSurface(surface));
}

function render() {
  renderSuggestions();
  renderPrompts();
  renderFloor();
}

function welcomeChat() {
  addChat('system', 'Keel starts as a blank floor. Use the green chips for ready-made pieces, or try a prompt in this panel to generate a briefing, count sheet, worklist, or submit desk from this shift.');
}

function clearChat() {
  $('chat-log').replaceChildren();
  welcomeChat();
}

function addChat(role, text) {
  const log = $('chat-log');
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  log.append(bubble);
  log.scrollTop = log.scrollHeight;
}

async function ask(message) {
  const trimmed = message.trim();
  if (!trimmed) return;
  addChat('user', trimmed);
  try {
    const result = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        subjectId: state.subjectId,
        message: trimmed,
        surfaces: state.surfaces,
        openai: {
          apiKey: $('openai-key').value,
          baseUrl: $('openai-base').value,
          model: $('openai-model').value,
        },
      }),
    });
    if (Array.isArray(result.surfaces)) state.surfaces = result.surfaces;
    if (Array.isArray(result.suggestions) && result.suggestions.length) {
      state.suggestions = result.suggestions.filter((item) => !String(item).toLowerCase().includes('clear'));
    }
    if (Array.isArray(result.prompts) && result.prompts.length) state.prompts = result.prompts;
    addChat('assistant', result.text ?? 'Done.');
  } catch (error) {
    addChat('system', error.message);
  }
  await loadData();
  render();
}

async function boot() {
  state.meta = await api('/api/meta');
  document.title = state.meta.product;
  state.subjectId = state.meta.defaultSubjectId;
  const select = $('principal');
  for (const principal of state.meta.principals.filter((item) => !item.id.startsWith('agent:'))) {
    const option = document.createElement('option');
    option.value = principal.id;
    option.textContent = `${principal.label} · ${principal.role}`;
    select.append(option);
  }
  select.value = state.subjectId;
  select.addEventListener('change', async () => {
    state.subjectId = select.value;
    await loadData();
    const constrained = await api('/api/compose', {
      method: 'POST',
      body: JSON.stringify({ subjectId: state.subjectId, message: '', surfaces: state.surfaces }),
    });
    state.surfaces = constrained.surfaces ?? [];
    render();
  });
  document.querySelector('.top a').setAttribute('href', href('/explorer.html'));
  $('openai-base').value = localStorage.getItem('cup.openai.base') ?? state.meta.model.baseUrl;
  $('openai-model').value = localStorage.getItem('cup.openai.model') ?? state.meta.model.model;
  welcomeChat();
  $('chat-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('chat-input').value.trim();
    if (!message) return;
    $('chat-input').value = '';
    localStorage.setItem('cup.openai.base', $('openai-base').value);
    localStorage.setItem('cup.openai.model', $('openai-model').value);
    await ask(message);
  });
  $('clear-floor').addEventListener('click', () => {
    void ask('Clear the canvas');
  });
  $('clear-chat').addEventListener('click', () => {
    clearChat();
  });
  await loadData();
  render();
}

boot().catch((error) => { $('floor').textContent = error.message; });
