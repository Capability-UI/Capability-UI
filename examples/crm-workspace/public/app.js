import { api, href, money, runAction, when } from '/client.js';

const OPEN_STAGES = [
  { id: 'discovery', label: 'Discovery' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'renewal', label: 'Renewal' },
];

const STAGE_LABEL = {
  discovery: 'Discovery',
  proposal: 'Proposal',
  renewal: 'Renewal',
  closed: 'Closed',
};

const state = { meta: null, subjectId: '', contacts: [], notes: [], selected: null, view: 'pipeline', query: '', canMail: false };

function $(id) { return document.getElementById(id); }

async function load() {
  const [contacts, notes, view] = await Promise.all([
    api(`/api/read?subject=${encodeURIComponent(state.subjectId)}&resource=crm.contacts`),
    api(`/api/read?subject=${encodeURIComponent(state.subjectId)}&resource=crm.notes`),
    api(`/api/view?subject=${encodeURIComponent(state.subjectId)}`),
  ]);
  state.contacts = contacts.items;
  state.notes = notes.items;
  state.canMail = view.capabilities.some((item) => item.id === 'mail.send');
  render();
}

function stageLabel(id) {
  return STAGE_LABEL[id] ?? id;
}

function renderBoard() {
  const board = $('board');
  board.hidden = state.view !== 'pipeline';
  $('accounts').hidden = state.view !== 'accounts';
  $('page-title').textContent = state.view === 'pipeline' ? 'Pipeline' : 'Accounts';
  $('context').textContent = state.view === 'pipeline'
    ? 'Open deals this quarter'
    : 'Companies and people in the book';
  board.replaceChildren();
  const recap = $('closed-recap');
  const closed = state.contacts.filter((item) => item.stage === 'closed');
  recap.textContent = closed.length
    ? `${closed.length} closed account${closed.length === 1 ? '' : 's'} live in Accounts, not on this board.`
    : 'No closed accounts in this book.';
  recap.hidden = state.view !== 'pipeline';
  for (const stage of OPEN_STAGES) {
    const col = document.createElement('section');
    col.className = 'col';
    const title = document.createElement('h2');
    const rows = state.contacts.filter((item) => item.stage === stage.id);
    const total = rows.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    title.textContent = `${stage.label} · ${rows.length}`;
    col.append(title);
    if (rows.some((item) => item.amount != null)) {
      const value = document.createElement('p');
      value.className = 'col-empty';
      value.textContent = money(total);
      col.append(value);
    }
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'col-empty';
      empty.textContent = 'No open deals.';
      col.append(empty);
    }
    for (const contact of rows) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      const last = contact.lastTouch ? `Last ${contact.lastTouch}` : '';
      card.innerHTML = `<strong>${contact.company}</strong><span>${contact.name}</span>${contact.amount != null ? `<span>${money(contact.amount)}</span>` : ''}${last ? `<span>${last}</span>` : ''}`;
      card.addEventListener('click', () => open(contact.id));
      col.append(card);
    }
    board.append(col);
  }
}

function renderAccounts() {
  const root = $('accounts');
  const query = state.query.trim().toLowerCase();
  const matches = (contact) => {
    if (!query) return true;
    return [contact.company, contact.name, contact.title, contact.stage]
      .some((value) => String(value ?? '').toLowerCase().includes(query));
  };
  const grouped = new Map();
  for (const contact of state.contacts.filter(matches)) {
    const key = contact.company || 'Unknown';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(contact);
  }
  const tools = document.createElement('div');
  tools.className = 'account-tools';
  const search = document.createElement('input');
  search.id = 'account-search';
  search.type = 'search';
  search.placeholder = 'Search company or person';
  search.value = state.query;
  tools.append(search);
  const grid = document.createElement('div');
  grid.className = 'account-grid';
  if (!grouped.size) {
    const empty = document.createElement('p');
    empty.className = 'quiet';
    empty.textContent = query ? 'No accounts match that search.' : 'No accounts in the book.';
    grid.append(empty);
  }
  for (const [company, people] of grouped) {
    const article = document.createElement('article');
    article.className = 'account';
    const openDeal = people.find((item) => item.stage !== 'closed');
    const badge = openDeal
      ? `Open · ${stageLabel(openDeal.stage)}`
      : 'No open deal';
    const status = document.createElement('p');
    status.className = 'quiet';
    status.textContent = badge;
    const heading = document.createElement('h2');
    heading.textContent = company;
    article.append(status, heading);
    const list = document.createElement('div');
    list.className = 'account-people';
    for (const person of people) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'person';
      const bits = [person.title, person.lastTouch ? `last ${person.lastTouch}` : ''].filter(Boolean);
      const reach = [person.phone, person.personalEmail].filter(Boolean).join(' · ');
      const name = document.createElement('strong');
      name.textContent = person.name;
      const detail = document.createElement('span');
      detail.textContent = bits.join(' · ') || stageLabel(person.stage);
      button.append(name, detail);
      if (reach) {
        const line = document.createElement('span');
        line.textContent = reach;
        button.append(line);
      }
      button.addEventListener('click', () => open(person.id));
      list.append(button);
    }
    article.append(list);
    grid.append(article);
  }
  root.replaceChildren(tools, grid);
  search.addEventListener('input', () => {
    state.query = search.value;
    const caret = search.selectionStart;
    renderAccounts();
    const next = $('account-search');
    next?.focus();
    next?.setSelectionRange(caret, caret);
  });
}

function open(id) {
  state.selected = state.contacts.find((item) => item.id === id) ?? null;
  renderDrawer();
}

function closeDrawer() {
  state.selected = null;
  renderDrawer();
}

function renderDrawer() {
  const drawer = $('drawer');
  const scrim = $('scrim');
  const contact = state.selected;
  if (!contact) {
    drawer.hidden = true;
    scrim.hidden = true;
    return;
  }
  drawer.hidden = false;
  scrim.hidden = false;
  const notes = state.notes.filter((item) => item.contactId === contact.id);
  drawer.innerHTML = `
    <div class="drawer-head">
      <div>
        <p class="quiet">${stageLabel(contact.stage)}</p>
        <h2>${contact.company}</h2>
      </div>
      <button class="ghost" type="button" id="close-drawer">Close</button>
    </div>
    <p class="meta">${contact.name}${contact.title ? ` · ${contact.title}` : ''}${contact.lastTouch ? ` · last ${contact.lastTouch}` : ''}</p>
    ${contact.phone ? `<p>${contact.phone}</p>` : ''}
    ${contact.personalEmail ? `<p>${contact.personalEmail}</p>` : ''}
    ${contact.amount != null ? `<p>${money(contact.amount)} open</p>` : '<p class="quiet">Deal value is hidden for this role.</p>'}
    <h3>Activity</h3>
    <div class="notes">${notes.map((note) => `<div class="note"><strong>${note.author}</strong><div>${note.body}</div><span class="quiet">${when(note.createdAt)}</span></div>`).join('') || '<p class="quiet">No notes yet.</p>'}</div>
    <form class="stack" id="note-form">
      <textarea name="body" rows="3" placeholder="Add an internal note" required></textarea>
      <button class="primary" type="submit">Save note</button>
    </form>
    <div id="mail"></div>
    <p class="flash" id="flash" hidden></p>
    <p class="warn" id="warn" hidden></p>
  `;
  drawer.querySelector('#close-drawer').addEventListener('click', closeDrawer);
  drawer.querySelector('#note-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = new FormData(event.currentTarget).get('body');
    const result = await runAction({ subjectId: state.subjectId, capability: 'crm.addNote', input: { contactId: contact.id, body } });
    banner(result.receipt.status === 'succeeded' ? 'Note saved.' : 'Could not save that note.', result.receipt.status === 'succeeded');
    await load();
    open(contact.id);
  });
  const mail = drawer.querySelector('#mail');
  if (state.canMail) {
    mail.innerHTML = `
      <form class="stack" id="mail-form">
        <h3>Email</h3>
        <input name="to" type="email" required placeholder="Recipient" value="${contact.personalEmail ?? ''}" />
        <input name="subject" placeholder="Subject" value="Following up with ${contact.company}" />
        <textarea name="body" rows="4" required>Hi ${contact.name.split(' ')[0]}, checking in on next steps.</textarea>
        <button class="primary" type="submit">Send email</button>
      </form>
    `;
    mail.querySelector('#mail-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const result = await runAction({
        subjectId: state.subjectId,
        capability: 'mail.send',
        input: { to: [data.to], body: data.body, subject: data.subject, contactId: contact.id },
      });
      banner(result.receipt.status === 'succeeded' ? 'Email sent.' : 'You cannot send email with this account.', result.receipt.status === 'succeeded');
    });
  }
}

function banner(text, ok) {
  const flash = document.getElementById('flash');
  const warn = document.getElementById('warn');
  if (!flash || !warn) return;
  flash.hidden = !ok;
  warn.hidden = ok;
  (ok ? flash : warn).textContent = text;
}

function render() {
  renderBoard();
  renderAccounts();
  if (state.selected) open(state.selected.id);
  else renderDrawer();
}

async function boot() {
  state.meta = await api('/api/meta');
  document.title = state.meta.product;
  state.subjectId = state.meta.defaultSubjectId;
  const select = $('principal');
  for (const principal of state.meta.principals) {
    const option = document.createElement('option');
    option.value = principal.id;
    option.textContent = `${principal.label} · ${principal.role}`;
    select.append(option);
  }
  select.value = state.subjectId;
  select.addEventListener('change', async () => {
    state.subjectId = select.value;
    state.selected = null;
    await load();
  });
  for (const button of document.querySelectorAll('.nav[data-view]')) {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      for (const item of document.querySelectorAll('.nav[data-view]')) item.classList.toggle('on', item === button);
      render();
    });
  }
  document.querySelector('a.nav.foot').setAttribute('href', href('/explorer.html'));
  $('scrim').addEventListener('click', closeDrawer);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
  });
  await load();
}

boot().catch((error) => { $('page-title').textContent = error.message; });
