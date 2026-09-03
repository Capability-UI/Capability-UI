import { api, href, runAction, when } from '/client.js';

const state = { meta: null, subjectId: '', tickets: [], comments: [], selected: null, canAssign: false, canEscalate: false };

function $(id) { return document.getElementById(id); }

async function load() {
  const [tickets, comments, view] = await Promise.all([
    api(`/api/read?subject=${encodeURIComponent(state.subjectId)}&resource=support.tickets`),
    api(`/api/read?subject=${encodeURIComponent(state.subjectId)}&resource=support.comments`),
    api(`/api/view?subject=${encodeURIComponent(state.subjectId)}`),
  ]);
  state.tickets = tickets.items;
  state.comments = comments.items;
  state.canAssign = view.capabilities.some((item) => item.id === 'tickets.assign');
  state.canEscalate = view.capabilities.some((item) => item.id === 'tickets.escalate');
  $('queue-meta').textContent = `${state.tickets.length} in queue`;
  if (!state.selected && state.tickets[0]) {
    open(state.tickets[0].id);
    return;
  }
  renderList();
  if (state.selected) open(state.selected.id);
}

function renderList() {
  const list = $('list');
  list.replaceChildren();
  for (const ticket of state.tickets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ticket${state.selected?.id === ticket.id ? ' on' : ''}`;
    button.innerHTML = `<span class="pri ${ticket.priority}">${ticket.priority} · ${ticket.slaMinutes}m</span><strong>${ticket.title}</strong><span>${ticket.customer} · ${ticket.status}</span>`;
    button.addEventListener('click', () => open(ticket.id));
    list.append(button);
  }
}

function open(id) {
  state.selected = state.tickets.find((item) => item.id === id) ?? null;
  renderList();
  const ticket = state.selected;
  const detail = $('detail');
  if (!ticket) {
    detail.innerHTML = '<div class="detail-body"><p class="empty">Pick a ticket from the queue to open the thread.</p></div>';
    return;
  }
  const thread = state.comments.filter((item) => item.ticketId === ticket.id);
  detail.innerHTML = `
    <div class="detail-body">
      <p class="quiet">${ticket.id}</p>
      <h2>${ticket.title}</h2>
      <div class="pills">
        <span class="pill">${ticket.customer}</span>
        <span class="pill">${ticket.status}</span>
        <span class="pill">${ticket.assignee.replace('user:', '')}</span>
        <span class="pill">${ticket.requester}</span>
      </div>
      ${ticket.internalNotes
        ? `<div class="internal"><strong>Internal</strong><p>${ticket.internalNotes}</p></div>`
        : '<p class="quiet">Internal notes are not available on this account.</p>'}
      <h3>Conversation</h3>
      <div class="thread">${thread.map((item) => `<div class="comment"><strong>${item.author}</strong><p>${item.body}</p><span class="quiet">${when(item.createdAt)}</span></div>`).join('') || '<p class="quiet">No public comments yet.</p>'}</div>
      <div id="lead-actions" class="actions-row"></div>
      <p class="flash" id="flash" hidden></p>
      <p class="warn" id="warn" hidden></p>
    </div>
    <form class="composer stack" id="comment-form">
      <textarea name="body" rows="3" required placeholder="Reply to the requester"></textarea>
      <button class="primary" type="submit">Add comment</button>
    </form>
  `;
  detail.querySelector('#comment-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = new FormData(event.currentTarget).get('body');
    await runAction({ subjectId: state.subjectId, capability: 'tickets.comment', input: { ticketId: ticket.id, body } });
    await load();
  });
  const lead = detail.querySelector('#lead-actions');
  if (state.canAssign) {
    lead.insertAdjacentHTML('beforeend', `
      <form id="assign-form" class="stack">
        <label>Assign
          <select name="assignee">
            <option value="user:aisha">Aisha Rahman</option>
            <option value="user:rio">Rio Patel</option>
          </select>
        </label>
        <button class="primary" type="submit">Update owner</button>
      </form>
    `);
    lead.querySelector('#assign-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const assignee = new FormData(event.currentTarget).get('assignee');
      await runAction({ subjectId: state.subjectId, capability: 'tickets.assign', input: { ticketId: ticket.id, assignee } });
      await load();
    });
  }
  if (state.canEscalate) {
    lead.insertAdjacentHTML('beforeend', `
      <form id="esc-form" class="stack">
        <textarea name="reason" rows="2" required placeholder="Why page on-call?"></textarea>
        <button class="danger" type="submit">Escalate</button>
      </form>
    `);
    lead.querySelector('#esc-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const reason = new FormData(event.currentTarget).get('reason');
      const result = await runAction({ subjectId: state.subjectId, capability: 'tickets.escalate', input: { ticketId: ticket.id, reason } });
      const flash = document.getElementById(result.receipt.status === 'succeeded' ? 'flash' : 'warn');
      flash.hidden = false;
      flash.textContent = result.receipt.status === 'succeeded' ? 'On-call paged.' : 'You cannot escalate with this account.';
      await load();
    });
  }
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
    $('detail').innerHTML = '<div class="detail-body"><p class="empty">Pick a ticket from the queue to open the thread.</p></div>';
  });
  document.querySelector('.top a').setAttribute('href', href('/explorer.html'));
  await load();
}

boot().catch((error) => { $('queue-meta').textContent = error.message; });
