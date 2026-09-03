import {useMemo, useState, type FormEvent, type ReactNode} from 'react';
import styles from './GenUiExamples.module.css';

type Principal = 'admin' | 'bob';

type Contact = {
  id: string;
  name: string;
  company: string;
  phone?: string;
  personalEmail?: string;
};

const ADMIN_CONTACTS: Contact[] = [
  {id: 'c1', name: 'Ada Lovelace', company: 'Analytical Engines', phone: '+44 20 7946 0958', personalEmail: 'ada@home.example'},
  {id: 'c2', name: 'Grace Hopper', company: 'Navy Compiler Lab', phone: '+1 202 555 0147', personalEmail: 'grace@home.example'},
  {id: 'c3', name: 'Katherine Johnson', company: 'Flight Research', phone: '+1 757 555 0199', personalEmail: 'katherine@home.example'},
];

function withoutOwnerFields(contact: Contact): Contact {
  return {id: contact.id, name: contact.name, company: contact.company};
}

const BOB_CONTACTS: Contact[] = ADMIN_CONTACTS.map(withoutOwnerFields);

function Risk({level}: {level: 'low' | 'medium' | 'high'}) {
  return <span className={`${styles.risk} ${styles[`risk_${level}`]}`}>{level} risk</span>;
}

function Frame({title, subject, children}: {title: string; subject: string; children: ReactNode}) {
  return (
    <div className={styles.frame}>
      <div className={styles.chrome} aria-hidden="true">
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.chromeTitle}>{title}</span>
      </div>
      <div className={styles.frameBody}>
        <header className={styles.appBar}>
          <div>
            <p className={styles.kicker}>Authorized view</p>
            <h3 className={styles.appTitle}>Account review</h3>
          </div>
          <p className={styles.subject}>{subject}</p>
        </header>
        {children}
      </div>
    </div>
  );
}

function ContactTable({rows, redacted}: {rows: Contact[]; redacted: boolean}) {
  const columns = redacted
    ? (['name', 'company'] as const)
    : (['name', 'company', 'phone', 'personalEmail'] as const);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.caption}>
          crm.contacts {redacted ? '(phone and personalEmail omitted by policy)' : '(owner fields included)'}
        </caption>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column} scope="col">{column === 'personalEmail' ? 'personal email' : column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              {columns.map(column => (
                <td key={column}>{row[column] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SendNoteForm() {
  const [to, setTo] = useState('ada@analytical.example');
  const [body, setBody] = useState('Sharing the renewal brief for Analytical Engines.');
  const [phase, setPhase] = useState<'edit' | 'preview' | 'done'>('edit');

  function onPreview(event: FormEvent) {
    event.preventDefault();
    setPhase('preview');
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h4 className={styles.cardTitle}>mail.send</h4>
        <Risk level="high" />
      </div>
      <p className={styles.sideEffect}>Side effect: sends an external message</p>
      {phase === 'edit' && (
        <form className={styles.form} onSubmit={onPreview}>
          <label className={styles.label}>
            to
            <input className={styles.input} value={to} onChange={event => setTo(event.target.value)} name="to" />
          </label>
          <label className={styles.label}>
            body
            <textarea className={styles.textarea} value={body} onChange={event => setBody(event.target.value)} name="body" rows={3} />
          </label>
          <button className={styles.primary} type="submit">Preview</button>
        </form>
      )}
      {phase === 'preview' && (
        <div className={styles.preview}>
          <p className={styles.previewLead}>Confirm this exact input. A changed payload is denied.</p>
          <dl className={styles.dl}>
            <div><dt>to</dt><dd>{to}</dd></div>
            <div><dt>body</dt><dd>{body}</dd></div>
            <div><dt>side effects</dt><dd>Sends an external message</dd></div>
          </dl>
          <div className={styles.actions}>
            <button className={styles.ghost} type="button" onClick={() => setPhase('edit')}>Edit</button>
            <button className={styles.primary} type="button" onClick={() => setPhase('done')}>Confirm and send</button>
          </div>
        </div>
      )}
      {phase === 'done' && (
        <div>
          <p className={styles.receiptOk} role="status">
            Receipt succeeded. Capability mail.send. Reason ALLOWED.
          </p>
          <div className={styles.actions}>
            <button className={styles.ghost} type="button" onClick={() => setPhase('edit')}>
              Send another
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ForgeDenied() {
  const [shown, setShown] = useState(false);
  return (
    <section className={styles.cardMuted}>
      <p className={styles.mutedCopy}>No execute tools were projected for this subject. The renderer has nothing to draw for mail.send.</p>
      <button className={styles.danger} type="button" onClick={() => setShown(true)}>
        Forge tools/call mail.send
      </button>
      {shown && (
        <p className={styles.receiptDeny} role="status">
          Receipt denied. Reason NO_MATCHING_ALLOW. Handler not invoked.
        </p>
      )}
    </section>
  );
}

export function VisibilityGallery() {
  const cells = [
    {state: 'Hidden', note: 'No node. No id. No empty slot.'},
    {state: 'Listed', note: 'A label only: crm.contacts exists.'},
    {state: 'Inspectable', note: 'Schema and risk. No row values.'},
    {state: 'Readable', note: 'Filtered rows. Redacted columns gone.'},
    {state: 'Usable', note: 'Action form plus a short-lived token.'},
  ];
  return (
    <div className={`${styles.gallery} cupExample`} role="list">
      {cells.map((cell, index) => (
        <div key={cell.state} className={styles.galleryItem} role="listitem">
          <span className={styles.galleryIndex}>{String(index + 1).padStart(2, '0')}</span>
          <strong>{cell.state}</strong>
          <p>{cell.note}</p>
          {cell.state === 'Listed' && <p className={styles.chip}>crm.contacts</p>}
          {cell.state === 'Inspectable' && <p className={styles.schemaPeek}>{'{ type: object }'} · medium</p>}
          {cell.state === 'Readable' && <p className={styles.miniRow}>Ada Lovelace · Analytical Engines</p>}
          {cell.state === 'Usable' && <button className={styles.tiny} type="button" tabIndex={-1}>Preview</button>}
        </div>
      ))}
    </div>
  );
}

function principalView(principal: Principal): {subject: string; rows: Contact[]; redacted: boolean; canSend: boolean} {
  switch (principal) {
    case 'admin':
      return {subject: 'user:admin · owner', rows: ADMIN_CONTACTS, redacted: false, canSend: true};
    case 'bob':
      return {subject: 'user:bob · member', rows: BOB_CONTACTS, redacted: true, canSend: false};
    default: {
      const exhaustive: never = principal;
      throw new Error(`Unhandled principal: ${exhaustive}`);
    }
  }
}

export function PrincipalScreens() {
  const [principal, setPrincipal] = useState<Principal>('admin');
  const view = useMemo(() => principalView(principal), [principal]);

  return (
    <div className={`${styles.block} cupExample`}>
      <div className={styles.switcher} role="tablist" aria-label="Principal">
        <button
          type="button"
          role="tab"
          aria-selected={principal === 'admin'}
          className={principal === 'admin' ? styles.tabOn : styles.tab}
          onClick={() => setPrincipal('admin')}
        >
          user:admin
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={principal === 'bob'}
          className={principal === 'bob' ? styles.tabOn : styles.tab}
          onClick={() => setPrincipal('bob')}
        >
          user:bob
        </button>
      </div>
      <Frame title="acme.workspace" subject={view.subject}>
        <ContactTable rows={view.rows} redacted={view.redacted} />
        {view.canSend ? <SendNoteForm /> : <ForgeDenied />}
      </Frame>
    </div>
  );
}

export function RedactionCompare() {
  return (
    <div className={`${styles.compare} cupExample`}>
      <Frame title="read as admin" subject="user:admin">
        <ContactTable rows={ADMIN_CONTACTS} redacted={false} />
      </Frame>
      <Frame title="read as bob" subject="user:bob">
        <ContactTable rows={BOB_CONTACTS} redacted />
      </Frame>
    </div>
  );
}
