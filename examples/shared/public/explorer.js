import { api, href } from './client.js';

const WORLD = { w: 4800, h: 3600 };
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2.5;

const state = { model: null, selected: '', product: '' };
const diagram = {
  zoom: 1,
  panX: 32,
  panY: 24,
  boxes: [],
  edges: [],
  svg: null,
  bound: false,
};
const access = {
  zoom: 1,
  panX: 32,
  panY: 24,
  boxes: [],
  edges: [],
  svg: null,
  bound: false,
  fitted: false,
};

function $(id) { return document.getElementById(id); }

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function layoutStorageKey() {
  return `cup.diagram.${state.product}`;
}

function restorePositions(boxes) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(layoutStorageKey()) ?? '{}');
    for (const box of boxes) {
      const pos = saved[box.name];
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        box.x = pos.x;
        box.y = pos.y;
      }
    }
  } catch {
    return;
  }
}

function savePositions() {
  const saved = Object.fromEntries(diagram.boxes.map((box) => [box.name, { x: box.x, y: box.y }]));
  sessionStorage.setItem(layoutStorageKey(), JSON.stringify(saved));
}

function applyWorld() {
  const world = $('diagram-world');
  world.style.transform = `translate(${diagram.panX}px, ${diagram.panY}px) scale(${diagram.zoom})`;
  $('zoom-label').textContent = `${Math.round(diagram.zoom * 100)}%`;
}

function setZoom(next, originX, originY) {
  const zoom = clamp(next, ZOOM_MIN, ZOOM_MAX);
  const worldX = (originX - diagram.panX) / diagram.zoom;
  const worldY = (originY - diagram.panY) / diagram.zoom;
  diagram.zoom = zoom;
  diagram.panX = originX - worldX * zoom;
  diagram.panY = originY - worldY * zoom;
  applyWorld();
}

function fitDiagram() {
  const viewport = $('diagram-viewport');
  if (!diagram.boxes.length || !viewport.clientWidth) return;
  const pad = 56;
  const minX = Math.min(...diagram.boxes.map((box) => box.x));
  const minY = Math.min(...diagram.boxes.map((box) => box.y));
  const maxX = Math.max(...diagram.boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...diagram.boxes.map((box) => box.y + box.h));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const zoom = clamp(
    Math.min((viewport.clientWidth - pad * 2) / width, (viewport.clientHeight - pad * 2) / height),
    ZOOM_MIN,
    ZOOM_MAX,
  );
  diagram.zoom = zoom;
  diagram.panX = pad - minX * zoom;
  diagram.panY = pad - minY * zoom;
  applyWorld();
}

function drawEdges() {
  const svg = diagram.svg;
  if (!svg) return;
  svg.replaceChildren();
  const byName = Object.fromEntries(diagram.boxes.map((box) => [box.name, box]));
  diagram.edges.forEach((edge, index) => {
    const from = byName[edge.from];
    const to = byName[edge.to];
    if (!from || !to) return;
    const a = port(from, from.x >= to.x ? 'left' : 'right', index, diagram.edges.length);
    const b = port(to, from.x >= to.x ? 'right' : 'left', index, diagram.edges.length);
    const mid = (a.x + b.x) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#e6c07b');
    path.setAttribute('stroke-width', '1.5');
    svg.append(path);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(mid));
    text.setAttribute('y', String((a.y + b.y) / 2 - 8));
    text.setAttribute('fill', '#8b949e');
    text.setAttribute('font-size', '11');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = edge.label;
    svg.append(text);
  });
}

function bindDiagram() {
  if (diagram.bound) return;
  diagram.bound = true;
  const viewport = $('diagram-viewport');
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom(diagram.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  viewport.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.er-card')) return;
    event.preventDefault();
    viewport.classList.add('panning');
    viewport.setPointerCapture(event.pointerId);
    diagram.pan = { x: event.clientX - diagram.panX, y: event.clientY - diagram.panY };
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!diagram.pan) return;
    diagram.panX = event.clientX - diagram.pan.x;
    diagram.panY = event.clientY - diagram.pan.y;
    applyWorld();
  });
  const endPan = () => {
    diagram.pan = null;
    viewport.classList.remove('panning');
  };
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);
  $('zoom-in').addEventListener('click', () => {
    const viewportEl = $('diagram-viewport');
    setZoom(diagram.zoom * 1.15, viewportEl.clientWidth / 2, viewportEl.clientHeight / 2);
  });
  $('zoom-out').addEventListener('click', () => {
    const viewportEl = $('diagram-viewport');
    setZoom(diagram.zoom / 1.15, viewportEl.clientWidth / 2, viewportEl.clientHeight / 2);
  });
  $('zoom-fit').addEventListener('click', () => fitDiagram());
}

function resourcesForTable(model, tableName) {
  return (model.resources ?? []).filter((item) => item.table === tableName || item.writesTable === tableName);
}

function rankTables(tables) {
  const byName = Object.fromEntries(tables.map((table) => [table.name, table]));
  const memo = new Map();
  function rank(name, stack) {
    if (memo.has(name)) return memo.get(name);
    if (stack.has(name)) return 0;
    stack.add(name);
    const keys = byName[name]?.foreignKeys ?? [];
    const value = keys.length
      ? 1 + Math.max(...keys.map((key) => rank(key.toTable, stack)))
      : 0;
    stack.delete(name);
    memo.set(name, value);
    return value;
  }
  for (const table of tables) rank(table.name, new Set());
  return memo;
}

function layoutTables(tables) {
  const ranks = rankTables(tables);
  const groups = new Map();
  for (const table of tables) {
    const rank = ranks.get(table.name) ?? 0;
    if (!groups.has(rank)) groups.set(rank, []);
    groups.get(rank).push(table);
  }
  const width = 240;
  const colGap = 96;
  const rowGap = 28;
  const boxes = [];
  const ranksSorted = [...groups.keys()].sort((a, b) => a - b);
  for (const rank of ranksSorted) {
    let y = 24;
    for (const table of groups.get(rank)) {
      const header = 44;
      const body = table.columns.length * 22 + 28;
      boxes.push({
        ...table,
        x: 32 + rank * (width + colGap),
        y,
        w: width,
        h: header + body,
      });
      y += header + body + rowGap;
    }
  }
  return boxes;
}

function port(box, side, index, count) {
  const t = (index + 1) / (count + 1);
  if (side === 'right') return { x: box.x + box.w, y: box.y + 20 + t * (box.h - 24) };
  return { x: box.x, y: box.y + 20 + t * (box.h - 24) };
}

function renderGrid(tableEl, result) {
  tableEl.replaceChildren();
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of result.columns) {
    const th = document.createElement('th');
    th.textContent = column;
    headRow.append(th);
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  for (const row of result.rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      td.textContent = cell == null ? 'NULL' : String(cell);
      tr.append(td);
    }
    body.append(tr);
  }
  tableEl.append(head, body);
}

function renderDiagram(model) {
  const boxes = layoutTables(model.tables);
  restorePositions(boxes);
  diagram.boxes = boxes;
  diagram.edges = [];
  for (const table of boxes) {
    for (const key of table.foreignKeys ?? []) {
      diagram.edges.push({ from: table.name, to: key.toTable, label: `${key.from} → ${key.toColumn}` });
    }
  }
  const world = $('diagram-world');
  world.replaceChildren();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(WORLD.w));
  svg.setAttribute('height', String(WORLD.h));
  svg.setAttribute('viewBox', `0 0 ${WORLD.w} ${WORLD.h}`);
  svg.style.pointerEvents = 'none';
  diagram.svg = svg;
  world.append(svg);
  for (const box of boxes) {
    const card = document.createElement('div');
    card.className = box.name.startsWith('access_') ? 'er-card access' : 'er-card';
    card.style.left = `${box.x}px`;
    card.style.top = `${box.y}px`;
    card.style.width = `${box.w}px`;
    card.dataset.table = box.name;
    const fkCols = new Set((box.foreignKeys ?? []).map((key) => key.from));
    const mapped = resourcesForTable(model, box.name);
    card.innerHTML = `<div class="er-head">${box.name}<span>${box.rowCount} rows</span></div>${box.columns.map((column) => {
      const kind = column.pk ? 'pk' : fkCols.has(column.name) ? 'fk' : '';
      return `<div class="er-col ${kind}">${column.name}<em>${column.type}${column.pk ? ' · PK' : ''}${fkCols.has(column.name) ? ' · FK' : ''}</em></div>`;
    }).join('')}${mapped.length ? `<div class="er-res">${mapped.map((item) => item.id).join(' · ')}</div>` : ''}`;
    bindCard(card, box);
    world.append(card);
    box.h = card.offsetHeight || box.h;
  }
  drawEdges();
  bindDiagram();
  applyWorld();
  requestAnimationFrame(() => fitDiagram());
}

function bindCard(card, box) {
  let drag = null;
  card.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    card.setPointerCapture(event.pointerId);
    const worldPoint = {
      x: (event.clientX - $('diagram-viewport').getBoundingClientRect().left - diagram.panX) / diagram.zoom,
      y: (event.clientY - $('diagram-viewport').getBoundingClientRect().top - diagram.panY) / diagram.zoom,
    };
    drag = {
      moved: false,
      offsetX: worldPoint.x - box.x,
      offsetY: worldPoint.y - box.y,
    };
    card.classList.add('dragging');
  });
  card.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const rect = $('diagram-viewport').getBoundingClientRect();
    const x = (event.clientX - rect.left - diagram.panX) / diagram.zoom - drag.offsetX;
    const y = (event.clientY - rect.top - diagram.panY) / diagram.zoom - drag.offsetY;
    if (Math.abs(x - box.x) + Math.abs(y - box.y) > 6) drag.moved = true;
    box.x = clamp(x, 8, WORLD.w - box.w - 8);
    box.y = clamp(y, 8, WORLD.h - box.h - 8);
    card.style.left = `${box.x}px`;
    card.style.top = `${box.y}px`;
    drawEdges();
  });
  const endDrag = (event) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    card.classList.remove('dragging');
    savePositions();
    if (!moved && event.type === 'pointerup') {
      showPane('browse');
      void openTable(box.name);
    }
  };
  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);
}

function accessStorageKey() {
  return `cup.access.${state.product}`;
}

function restoreAccessPositions(boxes) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(accessStorageKey()) ?? '{}');
    for (const box of boxes) {
      const pos = saved[box.id];
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        box.x = pos.x;
        box.y = pos.y;
      }
    }
  } catch {
    return;
  }
}

function saveAccessPositions() {
  const saved = Object.fromEntries(access.boxes.map((box) => [box.id, { x: box.x, y: box.y }]));
  sessionStorage.setItem(accessStorageKey(), JSON.stringify(saved));
}

function applyAccessWorld() {
  $('access-world').style.transform = `translate(${access.panX}px, ${access.panY}px) scale(${access.zoom})`;
  $('access-zoom-label').textContent = `${Math.round(access.zoom * 100)}%`;
}

function setAccessZoom(next, originX, originY) {
  const zoom = clamp(next, ZOOM_MIN, ZOOM_MAX);
  const worldX = (originX - access.panX) / access.zoom;
  const worldY = (originY - access.panY) / access.zoom;
  access.zoom = zoom;
  access.panX = originX - worldX * zoom;
  access.panY = originY - worldY * zoom;
  applyAccessWorld();
}

function fitAccess() {
  const viewport = $('access-viewport');
  if (!access.boxes.length || !viewport.clientWidth) return;
  const pad = 48;
  const minX = Math.min(...access.boxes.map((box) => box.x));
  const minY = Math.min(...access.boxes.map((box) => box.y));
  const maxX = Math.max(...access.boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...access.boxes.map((box) => box.y + box.h));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const zoom = clamp(
    Math.min((viewport.clientWidth - pad * 2) / width, (viewport.clientHeight - pad * 2) / height),
    ZOOM_MIN,
    ZOOM_MAX,
  );
  access.zoom = zoom;
  access.panX = pad - minX * zoom;
  access.panY = pad - minY * zoom;
  applyAccessWorld();
}

function drawAccessEdges() {
  const svg = access.svg;
  if (!svg) return;
  svg.replaceChildren();
  const byId = Object.fromEntries(access.boxes.map((box) => [box.id, box]));
  for (const edge of access.edges) {
    const from = byId[edge.from];
    const to = byId[edge.to];
    if (!from || !to) continue;
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h;
    const x2 = to.x + to.w / 2;
    const y2 = to.y;
    const midY = (y1 + y2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', edge.color);
    path.setAttribute('stroke-width', '1.25');
    path.setAttribute('opacity', '0.8');
    svg.append(path);
  }
}

function bindAccess() {
  if (access.bound) return;
  access.bound = true;
  const viewport = $('access-viewport');
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    setAccessZoom(access.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  viewport.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.er-card')) return;
    event.preventDefault();
    viewport.classList.add('panning');
    viewport.setPointerCapture(event.pointerId);
    access.pan = { x: event.clientX - access.panX, y: event.clientY - access.panY };
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!access.pan) return;
    access.panX = event.clientX - access.pan.x;
    access.panY = event.clientY - access.pan.y;
    applyAccessWorld();
  });
  const endPan = () => {
    access.pan = null;
    viewport.classList.remove('panning');
  };
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);
  $('access-zoom-in').addEventListener('click', () => {
    setAccessZoom(access.zoom * 1.15, viewport.clientWidth / 2, viewport.clientHeight / 2);
  });
  $('access-zoom-out').addEventListener('click', () => {
    setAccessZoom(access.zoom / 1.15, viewport.clientWidth / 2, viewport.clientHeight / 2);
  });
  $('access-zoom-fit').addEventListener('click', () => fitAccess());
}

function bindAccessCard(card, box) {
  let drag = null;
  card.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    card.setPointerCapture(event.pointerId);
    const rect = $('access-viewport').getBoundingClientRect();
    const worldPoint = {
      x: (event.clientX - rect.left - access.panX) / access.zoom,
      y: (event.clientY - rect.top - access.panY) / access.zoom,
    };
    drag = {
      moved: false,
      offsetX: worldPoint.x - box.x,
      offsetY: worldPoint.y - box.y,
    };
    card.classList.add('dragging');
  });
  card.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const rect = $('access-viewport').getBoundingClientRect();
    const x = (event.clientX - rect.left - access.panX) / access.zoom - drag.offsetX;
    const y = (event.clientY - rect.top - access.panY) / access.zoom - drag.offsetY;
    if (Math.abs(x - box.x) + Math.abs(y - box.y) > 6) drag.moved = true;
    box.x = clamp(x, 8, WORLD.w - box.w - 8);
    box.y = clamp(y, 8, WORLD.h - box.h - 8);
    card.style.left = `${box.x}px`;
    card.style.top = `${box.y}px`;
    drawAccessEdges();
  });
  const endDrag = (event) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    card.classList.remove('dragging');
    saveAccessPositions();
    if (!moved && event.type === 'pointerup' && box.kind === 'table') {
      showPane('browse');
      void openTable(box.tableName);
    }
  };
  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);
}

function renderMatrix(model) {
  const people = model.principals;
  const resources = model.resources;
  const wrap = $('matrix');
  wrap.replaceChildren();
  const table = document.createElement('table');
  table.className = 'matrix';
  const head = document.createElement('thead');
  head.innerHTML = `<tr><th>Person</th>${resources.map((item) => `<th>${item.id}</th>`).join('')}</tr>`;
  const body = document.createElement('tbody');
  for (const person of people) {
    const tr = document.createElement('tr');
    const name = document.createElement('th');
    name.innerHTML = `${person.label}<span>${person.role}</span>`;
    tr.append(name);
    for (const resource of resources) {
      const td = document.createElement('td');
      const grant = model.grants.find((item) => item.principalId === person.id && item.resourceId === resource.id);
      if (!grant) {
        td.innerHTML = '<span class="deny">No grant</span>';
      } else {
        td.innerHTML = `
          <div class="ops">${grant.operations.map((op) => `<span class="op">${op}</span>`).join('')}</div>
          <p>${grant.recordScope}</p>
          ${grant.hiddenFields.length ? `<div class="ops">${grant.hiddenFields.map((field) => `<span class="op hide">hide ${field}</span>`).join('')}</div>` : ''}
        `;
      }
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(head, body);
  wrap.append(table);
}

function renderAccess(model) {
  $('access-lede').textContent = `${model.summary} Scroll to zoom. Drag the canvas to pan. Drag a card to move it.`;
  renderMatrix(model);
  const col = 208;
  const nodeW = 184;
  const nodeH = 58;
  const boxes = [];
  model.principals.forEach((item, index) => {
    boxes.push({
      id: item.id,
      kind: 'person',
      title: item.label,
      subtitle: item.role,
      x: 32 + index * col,
      y: 32,
      w: nodeW,
      h: nodeH,
    });
  });
  model.resources.forEach((item, index) => {
    boxes.push({
      id: item.id,
      kind: 'resource',
      title: item.id,
      subtitle: item.kind,
      table: item.table,
      writesTable: item.writesTable,
      x: 32 + index * col,
      y: 168,
      w: nodeW,
      h: nodeH,
    });
  });
  model.tables.forEach((item, index) => {
    boxes.push({
      id: `table:${item.name}`,
      kind: 'table',
      title: item.name,
      subtitle: `${item.rowCount} rows`,
      tableName: item.name,
      x: 32 + index * col,
      y: 304,
      w: nodeW,
      h: nodeH,
    });
  });
  restoreAccessPositions(boxes);
  access.boxes = boxes;
  access.edges = [];
  for (const grant of model.grants) {
    access.edges.push({ from: grant.principalId, to: grant.resourceId, color: '#8bb4ff' });
  }
  for (const resource of model.resources) {
    const tableName = resource.table || resource.writesTable;
    if (tableName) access.edges.push({ from: resource.id, to: `table:${tableName}`, color: '#7dd3a0' });
  }
  const world = $('access-world');
  world.replaceChildren();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(WORLD.w));
  svg.setAttribute('height', String(WORLD.h));
  svg.setAttribute('viewBox', `0 0 ${WORLD.w} ${WORLD.h}`);
  access.svg = svg;
  world.append(svg);
  for (const box of boxes) {
    const card = document.createElement('div');
    card.className = `er-card node ${box.kind}`;
    card.style.left = `${box.x}px`;
    card.style.top = `${box.y}px`;
    card.style.width = `${box.w}px`;
    card.innerHTML = `<div class="er-head">${box.title}</div><div class="er-col">${box.subtitle}</div>`;
    bindAccessCard(card, box);
    world.append(card);
    box.h = card.offsetHeight || box.h;
  }
  drawAccessEdges();
  bindAccess();
  applyAccessWorld();
  const list = $('grants');
  list.replaceChildren();
  for (const resource of model.resources) {
    const card = document.createElement('article');
    card.className = 'grant';
    card.innerHTML = `
      <h3>${resource.id}</h3>
      <p>${resource.description}</p>
      <p class="quiet-line">${resource.kind === 'action' ? 'Action writes' : 'Reads'} ${resource.writesTable ?? resource.table ?? 'no table'}</p>
    `;
    list.append(card);
  }
}

async function openTable(name) {
  state.selected = name;
  for (const button of $('schema').querySelectorAll('.table-btn')) {
    button.classList.toggle('on', button.dataset.name === name);
  }
  $('sql').value = `SELECT * FROM ${name} LIMIT 200;`;
  const result = await api(`/api/db/table?name=${encodeURIComponent(name)}`);
  renderGrid($('grid'), result);
}

function showPane(id) {
  for (const pane of document.querySelectorAll('.pane')) pane.classList.toggle('on', pane.id === `pane-${id}`);
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('on', tab.dataset.pane === id);
  if (id === 'access' && !access.fitted) {
    requestAnimationFrame(() => {
      fitAccess();
      if ($('access-viewport').clientWidth) access.fitted = true;
    });
  }
}

async function boot() {
  const meta = await api('/api/meta');
  document.title = `${meta.product} · Data explorer`;
  $('title').textContent = `${meta.product} explorer`;
  $('back').setAttribute('href', href('/'));
  state.product = meta.product;
  state.model = await api('/api/db/model');
  $('diagram-lede').textContent = 'Scroll to zoom. Drag the canvas to pan. Drag a table to move it. Click a table (without dragging) to browse its rows.';
  renderDiagram(state.model);
  renderAccess(state.model);
  $('schema').replaceChildren();
  for (const table of state.model.tables) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'table-btn';
    button.dataset.name = table.name;
    button.textContent = `${table.name}  ${table.rowCount}`;
    button.addEventListener('click', () => { void openTable(table.name); });
    const cols = document.createElement('div');
    cols.className = 'cols';
    cols.textContent = table.columns.map((column) => `${column.name} ${column.type}${column.pk ? ' pk' : ''}`).join('\n');
    $('schema').append(button, cols);
  }
  if (state.model.tables[0]) await openTable(state.model.tables[0].name);
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showPane(tab.dataset.pane));
  }
}

$('run').addEventListener('click', async () => {
  const errorEl = $('sql-error');
  errorEl.hidden = true;
  try {
    renderGrid($('sql-grid'), await api('/api/db/query', { method: 'POST', body: JSON.stringify({ sql: $('sql').value }) }));
  } catch (error) {
    errorEl.hidden = false;
    errorEl.textContent = error.message;
  }
});

boot().catch((error) => { $('title').textContent = error.message; });
