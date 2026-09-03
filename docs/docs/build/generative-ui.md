---
id: generative-ui
title: Generative UI with CUP
sidebar_label: Generative UI
description: Turn an AuthorizedView into forms, tables, and action controls without treating the screen as the security boundary.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Generative UI with CUP

A generated interface is a presentation of an `AuthorizedView`. CUP decides what exists for this subject, this purpose, and this policy version. The renderer only maps that document onto controls.

Do not hide a button and call that authorization. The same view can drive a web form, a mobile sheet, a voice prompt, or no UI at all. Execution still goes through `prepare` and `execute` (or MCP `tools/call`).

## The rendering contract

```ts
import type { AuthorizedView, RendererAdapter } from '@capability-ui/core';

type UiTree = {
  kind: 'screen';
  title: string;
  sections: Array<{ kind: 'table' | 'form' | 'notice'; id: string }>;
};

const renderer: RendererAdapter<UiTree> = {
  render(view: AuthorizedView, target: UiTree) {
    return {
      ...target,
      title: view.goal ?? 'Workspace',
      policyVersion: view.policyVersion,
      sections: view.resources.flatMap(resource => {
        if (resource.visibility === 'listed') {
          return [{ kind: 'notice', id: resource.ref.id, label: resource.ref.id }];
        }
        if (resource.visibility === 'readable') {
          return [{ kind: 'table', id: resource.ref.id, schema: resource.schema, fields: resource.fields }];
        }
        return [];
      }),
      actions: view.capabilities.map(capability => ({
        kind: 'form',
        id: capability.id,
        schema: capability.inputSchema,
        risk: capability.risk,
        sideEffects: capability.sideEffects,
        confirmation: capability.confirmation,
        actionToken: capability.actionToken,
      })),
    };
  },
};
```

`project()` is the only input the renderer should need. MCP `tools/list` plus `resources/list` is the same projection.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
const view = await cup.project({
  subject: admin,
  goal: 'review contacts and send a note',
  context: { purpose: 'account_review', channel: 'web' },
});
const screen = renderer.render(view, { kind: 'screen', title: '', sections: [] });
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {
    "subjectId": "user:admin",
    "goal": "review contacts and send a note",
    "context": { "purpose": "account_review", "channel": "web" }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/list",
  "params": {
    "subjectId": "user:admin",
    "context": { "purpose": "account_review", "channel": "web" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  --goal "review contacts and send a note" \
  --purpose account_review --context '{"channel":"web"}' \
  tools list

cup --host ./dist/setup.js --subject user:admin \
  --purpose account_review --context '{"channel":"web"}' \
  resources list
```

</TabItem>
</Tabs>

## Visibility to controls

| `visibility` | Safe UI |
|---|---|
| hidden | Nothing. Do not reserve a slot or leak the id. |
| listed | A label that the resource exists. No schema, no rows. |
| inspectable | Schema, risk, and side effects. No record values. |
| readable | Filtered rows. Apply `fields` as column redaction, not CSS hiding. |
| usable | The action control plus the short-lived `actionToken`. |

A read-only collaborator and an owner can share one renderer. The view differs, so the screen differs.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
const ownerView = await cup.project({ subject: admin, context: { channel: 'web' } });
const memberView = await cup.project({ subject: bob, context: { channel: 'web' } });
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{ "method": "tools/list", "params": { "subjectId": "user:admin" } }
```

```json
{ "method": "tools/list", "params": { "subjectId": "user:bob" } }
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin tools list
cup --host ./dist/setup.js --subject user:bob tools list
```

</TabItem>
</Tabs>

Bob's generated screen has a contacts table and no create-resource form. Admin's screen has both.

## Schema-driven action forms

A capability already carries JSON Schema, risk, confirmation, and side effects. The form should copy those fields, not invent a second contract.

```tsx
import type { AuthorizedCapability } from '@capability-ui/core';

function ActionForm({ capability, onPropose }: {
  capability: AuthorizedCapability;
  onPropose: (input: unknown) => void;
}) {
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        onPropose(Object.fromEntries(new FormData(event.currentTarget)));
      }}
    >
      <header>
        <h2>{capability.id}</h2>
        <p>{capability.risk} risk</p>
        <ul>{capability.sideEffects.map(item => <li key={item}>{item}</li>)}</ul>
      </header>
      {Object.keys((capability.inputSchema.properties ?? {}) as object).map(name => (
        <label key={name}>
          {name}
          <input name={name} />
        </label>
      ))}
      <button type="submit">{capability.confirmation === 'none' ? 'Run' : 'Preview'}</button>
    </form>
  );
}
```

When the user submits, call `prepare`, show `prepared.preview`, then `execute` with the confirmation hash and the action token from the view. If the renderer posts a different payload than the preview, CUP denies it.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
const prepared = await cup.prepare({
  subject: admin,
  capability: 'mail.send',
  input,
  context: { channel: 'web', purpose: 'personal_message' },
});

showPreview(prepared.preview);

const receipt = await cup.execute({
  ...prepared.request,
  actionToken: capability.actionToken,
  confirmation: { inputHash: prepared.inputHash, confirmedBy: admin.id },
  idempotencyKey: crypto.randomUUID(),
  context: { channel: 'web', purpose: 'personal_message' },
});
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "subjectId": "user:admin",
    "name": "mail.send",
    "arguments": { "to": ["person@example.com"], "body": "Hello" },
    "confirmation": { "confirmedBy": "user:admin" },
    "idempotencyKey": "mail-ui-1",
    "context": { "channel": "web", "purpose": "personal_message" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:admin \
  --purpose personal_message --context '{"channel":"web"}' \
  tools call mail.send \
  --args '{"to":["person@example.com"],"body":"Hello"}' \
  --confirm --idempotency-key mail-ui-1
```

</TabItem>
</Tabs>

## Field-level UI

Redaction belongs in the data, not in the stylesheet. If `fields` marks `phone` unread, the table must omit the column. Derived widgets (CSV export, copy-to-clipboard, charts) must use the same filtered records you received from `read()`.

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
const page = await cup.read({
  subject: bob,
  resource: 'crm.contacts',
  scope: { workspaceId: 'acme' },
  context: { channel: 'web' },
});
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/read",
  "params": {
    "subjectId": "user:bob",
    "uri": "cup://crm.contacts",
    "context": { "workspaceId": "acme", "channel": "web" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:bob \
  --context '{"workspaceId":"acme","channel":"web"}' \
  resources read cup://crm.contacts
```

</TabItem>
</Tabs>

## One view, several surfaces

Keep the renderer replaceable. CUP does not ship React, Web Components, or SwiftUI. Each surface implements `RendererAdapter<T>`:

- Web: forms and tables from `inputSchema` and readable resources.
- Mobile: one primary action and a compact record list.
- Voice: read listed labels, then ask for required schema fields.
- Agent: skip widgets and use MCP `tools/list` from the same projection.

If a principal's access changes while a screen is open, the next `execute` uses current policy. Refresh the view after a receipt. Do not cache action tokens across policy versions.

## Testing a generated screen

Assert the view, then assert that a forged control still fails:

<Tabs groupId="surface">
<TabItem value="cup" label="CUP">

```ts
const view = await cup.project({ subject: bob, context: { channel: 'web' } });
assert.equal(view.capabilities.some(c => c.id === 'mail.send'), false);

const forged = await cup.execute({
  subject: bob,
  capability: 'mail.send',
  input: { to: ['everyone@example.com'], body: 'Hello' },
  context: { channel: 'web' },
});
assert.equal(forged.status, 'denied');
```

</TabItem>
<TabItem value="mcp" label="MCP">

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "subjectId": "user:bob",
    "name": "mail.send",
    "arguments": { "to": ["everyone@example.com"], "body": "Hello" },
    "context": { "channel": "web" }
  }
}
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
cup --host ./dist/setup.js --subject user:bob tools list
cup --host ./dist/setup.js --subject user:bob \
  tools call mail.send \
  --args '{"to":["everyone@example.com"],"body":"Hello"}'
```

</TabItem>
</Tabs>

The missing button is a product detail. The denied receipt is the security property.
