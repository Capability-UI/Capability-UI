const state = {
  meta: null,
  subjectId: '',
  view: null,
  previewByCapability: {},
};

const BASE = (document.querySelector('meta[name="cup-base"]')?.getAttribute('content') ?? '').replace(/\/$/, '');

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

function fieldControl(name, schema) {
  const type = schema?.type;
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
  const input = document.createElement(type === 'string' && (schema?.maxLength ?? 0) > 80 ? 'textarea' : 'input');
  input.name = name;
  if (type === 'number' || type === 'integer') input.type = 'number';
  else if (type === 'boolean') input.type = 'checkbox';
  else input.type = 'text';
  if (schema?.default != null) input.value = String(schema.default);
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
    else if (type === 'array') {
      data[name] = String(control.value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    } else data[name] = control.value;
  }
  return data;
}

function tableFor(resourceId, items, fields) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  if (!items.length) {
    wrap.innerHTML = '<p class="notice">No rows in this authorized read.</p>';
    return wrap;
  }
  const unread = new Set((fields ?? []).filter((field) => field.readable === false).map((field) => field.path));
  const keys = Object.keys(items[0]).filter((key) => !unread.has(key));
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const key of keys) {
    const th = document.createElement('th');
    th.textContent = key;
    headRow.append(th);
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  for (const item of items) {
    const row = document.createElement('tr');
    for (const key of keys) {
      const td = document.createElement('td');
      const value = item[key];
      td.textContent = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      row.append(td);
    }
    body.append(row);
  }
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

function riskClass(risk) {
  switch (risk) {
    case 'low':
    case 'medium':
    case 'high':
    case 'critical':
      return risk;
    default:
      return 'low';
  }
}

async function renderResources(view) {
  const root = $('resources');
  root.replaceChildren();
  for (const resource of view.resources) {
    const section = document.createElement('article');
    section.className = 'resource';
    const title = document.createElement('h3');
    title.textContent = resource.ref.id;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `visibility ${resource.visibility}${resource.fields?.length ? `; redacted ${resource.fields.filter((f) => !f.readable).map((f) => f.path).join(', ')}` : ''}`;
    section.append(title, meta);
    if (resource.visibility === 'listed') {
      const notice = document.createElement('p');
      notice.className = 'notice';
      notice.textContent = 'Listed only. Schema and rows are withheld.';
      section.append(notice);
    } else if (resource.visibility === 'inspectable') {
      const preview = document.createElement('pre');
      preview.className = 'preview';
      preview.textContent = JSON.stringify(resource.schema ?? {}, null, 2);
      section.append(preview);
    } else if (resource.visibility === 'readable' || resource.visibility === 'usable') {
      try {
        const page = await api(`/api/read?subject=${encodeURIComponent(state.subjectId)}&resource=${encodeURIComponent(resource.ref.id)}`);
        section.append(tableFor(resource.ref.id, page.items, resource.fields));
      } catch (error) {
        const notice = document.createElement('p');
        notice.className = 'notice';
        notice.textContent = error.message;
        section.append(notice);
      }
    }
    root.append(section);
  }
}

function renderActions(view) {
  const root = $('actions');
  root.replaceChildren();
  if (!view.capabilities.length) {
    const notice = document.createElement('p');
    notice.className = 'notice';
    notice.textContent = 'No usable capabilities for this principal.';
    root.append(notice);
    return;
  }
  for (const capability of view.capabilities) {
    const section = document.createElement('article');
    section.className = 'action';
    const title = document.createElement('h3');
    title.textContent = capability.id;
    const badge = document.createElement('span');
    badge.className = `risk ${riskClass(capability.risk)}`;
    badge.textContent = `${capability.risk} risk`;
    title.append(' ', badge);
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `side effects: ${capability.sideEffects.join(', ') || 'none'}; confirmation ${capability.confirmation}`;
    const form = document.createElement('form');
    form.className = 'action-grid';
    const properties = capability.inputSchema?.properties ?? {};
    for (const [name, schema] of Object.entries(properties)) form.append(fieldControl(name, schema));
    const preview = document.createElement('pre');
    preview.className = 'preview';
    preview.hidden = true;
    const row = document.createElement('div');
    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'secondary';
    previewBtn.textContent = 'Preview';
    const runBtn = document.createElement('button');
    runBtn.type = 'submit';
    runBtn.textContent = capability.confirmation === 'none' ? 'Run' : 'Confirm and run';
    row.append(previewBtn, runBtn);
    form.append(preview, row);
    previewBtn.addEventListener('click', async () => {
      const prepared = await api('/api/prepare', {
        method: 'POST',
        body: JSON.stringify({
          subjectId: state.subjectId,
          capability: capability.id,
          input: readForm(form, capability.inputSchema),
        }),
      });
      state.previewByCapability[capability.id] = prepared;
      preview.hidden = false;
      preview.textContent = JSON.stringify(prepared.preview, null, 2);
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = readForm(form, capability.inputSchema);
      const result = await api('/api/execute', {
        method: 'POST',
        body: JSON.stringify({
          subjectId: state.subjectId,
          capability: capability.id,
          input,
          actionToken: capability.actionToken,
          confirm: true,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      preview.hidden = false;
      preview.textContent = JSON.stringify(result.receipt, null, 2);
      await refresh();
    });
    section.append(title, meta, form);
    root.append(section);
  }
}

async function renderReceipts() {
  const { receipts } = await api('/api/receipts');
  const root = $('receipts');
  root.replaceChildren();
  for (const receipt of receipts) {
    const row = document.createElement('div');
    row.className = 'receipt';
    const status = document.createElement('strong');
    status.className = `status-${receipt.status}`;
    status.textContent = receipt.status;
    const cap = document.createElement('span');
    cap.textContent = `${receipt.capability} · ${receipt.decision?.reasonCode ?? ''}`;
    const when = document.createElement('span');
    when.textContent = new Date(receipt.createdAt).toLocaleTimeString();
    row.append(status, cap, when);
    root.append(row);
  }
}

async function refresh() {
  state.view = await api(`/api/view?subject=${encodeURIComponent(state.subjectId)}`);
  $('view-meta').textContent = `${state.view.subjectId} · policy ${state.view.policyVersion}`;
  await renderResources(state.view);
  renderActions(state.view);
  await renderReceipts();
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
  document.title = state.meta.title;
  $('example-name').textContent = state.meta.name;
  $('example-title').textContent = state.meta.title;
  $('example-subtitle').textContent = state.meta.subtitle;
  $('mcp-chip').textContent = `MCP ${location.origin}${BASE}/mcp`;
  const select = $('principal');
  for (const principal of state.meta.principals) {
    const option = document.createElement('option');
    option.value = principal.id;
    option.textContent = `${principal.label} (${principal.role})`;
    select.append(option);
  }
  state.subjectId = state.meta.defaultSubjectId;
  select.value = state.subjectId;
  select.addEventListener('change', async () => {
    state.subjectId = select.value;
    await refresh();
  });
  if (state.meta.layout === 'chat') {
    document.querySelector('.shell').classList.add('chat');
    $('chat-pane').hidden = false;
    $('openai-base').value = localStorage.getItem('cup.openai.base') ?? state.meta.model.baseUrl;
    $('openai-model').value = localStorage.getItem('cup.openai.model') ?? state.meta.model.model;
    addChat('system', state.meta.model.hasServerKey
      ? 'Server OPENAI_API_KEY is set. Browser fields override it for this session only.'
      : 'Set an API key in the form or as OPENAI_API_KEY. The generated UI still works without a model.');
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
        addChat('assistant', result.text ?? JSON.stringify(result, null, 2));
      } catch (error) {
        addChat('system', error.message);
      }
      await refresh();
    });
  }
  await refresh();
  for (const resource of state.meta.eventResources ?? []) {
    const source = new EventSource(`${BASE}/api/events?subject=${encodeURIComponent(state.subjectId)}&resource=${encodeURIComponent(resource)}`);
    source.addEventListener('message', () => { void refresh(); });
  }
}

boot().catch((error) => {
  $('example-title').textContent = 'Could not load example';
  $('example-subtitle').textContent = error.message;
});
