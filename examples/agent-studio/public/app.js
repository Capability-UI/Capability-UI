import { api, href, money, runAction } from '/client.js';

const state = {
  meta: null,
  subjectId: '',
  products: [],
  orders: [],
  view: 'inventory',
  canAdjust: false,
  canDraft: false,
  canSubmit: false,
};

function $(id) { return document.getElementById(id); }

async function load() {
  const [products, orders, view] = await Promise.all([
    api(`/api/read?subject=${encodeURIComponent(state.subjectId)}&resource=inventory.products`),
    api(`/api/read?subject=${encodeURIComponent(state.subjectId)}&resource=inventory.orders`),
    api(`/api/view?subject=${encodeURIComponent(state.subjectId)}`),
  ]);
  state.products = products.items;
  state.orders = orders.items;
  state.canAdjust = view.capabilities.some((item) => item.id === 'inventory.adjust');
  state.canDraft = view.capabilities.some((item) => item.id === 'inventory.draftPurchaseOrder');
  state.canSubmit = view.capabilities.some((item) => item.id === 'inventory.submitPurchaseOrder');
  render();
}

function table(columns, rows, actions) {
  const wrap = document.createElement('div');
  const tableEl = document.createElement('table');
  tableEl.innerHTML = `<thead><tr>${columns.map((column) => `<th>${column.label}</th>`).join('')}${actions ? '<th></th>' : ''}</tr></thead>`;
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const column of columns) {
      const td = document.createElement('td');
      const snake = column.key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      const value = row[column.key] ?? row[snake];
      td.textContent = column.format ? column.format(value, row) : (value == null || value === '' ? '—' : String(value));
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
  tableEl.append(body);
  wrap.className = 'table-wrap';
  wrap.append(tableEl);
  return wrap;
}

function personName(id) {
  const found = state.meta?.principals.find((item) => item.id === id);
  if (found) return found.label;
  if (!id || id === 'workspace') return '—';
  return String(id).replace(/^(user|agent):/, '');
}

function btn(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function renderInventory() {
  const root = $('inventory');
  root.hidden = state.view !== 'inventory';
  const head = document.createElement('div');
  head.className = 'toolbar';
  head.innerHTML = `<h1>On hand</h1><p class="quiet">${state.products.filter((item) => item.onHand < item.reorderPoint).length} below reorder</p>`;
  const grid = table(
    [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Item' },
      { key: 'bin', label: 'Bin' },
      { key: 'onHand', label: 'On hand', alert: (row) => row.onHand < row.reorderPoint },
      { key: 'reorderPoint', label: 'Reorder' },
      { key: 'unitCost', label: 'Unit cost', format: (value) => (value == null ? '—' : money(value)) },
      { key: 'supplier', label: 'Supplier' },
    ],
    state.products,
    (row) => {
      const cell = document.createElement('div');
      cell.className = 'btn-row';
      if (state.canAdjust) cell.append(btn('Adjust', () => adjust(row)));
      if (state.canDraft) cell.append(btn('Draft PO', () => draft(row)));
      return cell;
    },
  );
  root.replaceChildren(head, grid);
}

function renderOrders() {
  const root = $('orders');
  root.hidden = state.view !== 'orders';
  const head = document.createElement('div');
  head.className = 'toolbar';
  head.innerHTML = '<h1>Purchase orders</h1>';
  const grid = table(
    [
      { key: 'id', label: 'PO' },
      { key: 'sku', label: 'SKU' },
      { key: 'quantity', label: 'Qty' },
      { key: 'status', label: 'Status' },
      { key: 'reason', label: 'Reason' },
      { key: 'requestedBy', label: 'Requested by', format: (value) => personName(value) },
    ],
    state.orders,
    (row) => {
      const cell = document.createElement('div');
      cell.className = 'btn-row';
      if (state.canSubmit && row.status === 'draft') cell.append(btn('Submit to supplier', () => submit(row)));
      return cell;
    },
  );
  root.replaceChildren(head, grid);
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
      await load();
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
      await load();
    },
  );
}

async function submit(row) {
  await runAction({
    subjectId: state.subjectId,
    capability: 'inventory.submitPurchaseOrder',
    input: { orderId: row.id },
  });
  await load();
}

function render() {
  renderInventory();
  renderOrders();
}

function addChat(role, text) {
  const log = $('chat-log');
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  log.append(bubble);
  log.scrollTop = log.scrollHeight;
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
    await load();
  });
  document.querySelector('.top a').setAttribute('href', href('/explorer.html'));
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      state.view = tab.dataset.view;
      for (const item of document.querySelectorAll('.tab')) item.classList.toggle('on', item === tab);
      render();
    });
  }
  $('openai-base').value = localStorage.getItem('cup.openai.base') ?? state.meta.model.baseUrl;
  $('openai-model').value = localStorage.getItem('cup.openai.model') ?? state.meta.model.model;
  addChat('system', 'Copilot can count stock and draft purchase orders. It uses your current shift role.');
  $('chat-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('chat-input').value.trim();
    if (!message) return;
    $('chat-input').value = '';
    localStorage.setItem('cup.openai.base', $('openai-base').value);
    localStorage.setItem('cup.openai.model', $('openai-model').value);
    addChat('user', message);
    try {
      const result = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          subjectId: state.subjectId,
          message,
          openai: {
            apiKey: $('openai-key').value,
            baseUrl: $('openai-base').value,
            model: $('openai-model').value,
          },
        }),
      });
      addChat('assistant', result.text ?? 'Done.');
    } catch (error) {
      addChat('system', error.message);
    }
    await load();
  });
  await load();
}

boot().catch((error) => { $('inventory').textContent = error.message; });
