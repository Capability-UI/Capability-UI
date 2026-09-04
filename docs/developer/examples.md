# Developer notes: example hosts

Runnable CUP hosts live in `examples/`. Product screens are branded apps (Meridian, Clearline, Keel). Shared pieces: HTTP/MCP host, SQLite helper, read-only explorer (ER diagram, access matrix, browse, SQL). The Diagram tab and the Access model graph both pan, zoom (wheel or +/-), and let you drag cards; positions persist in `sessionStorage`. Domain policy stays in CUP. Each host also seeds `access_*` SQLite tables from `catalog` so grants show up as rows with foreign keys. `seedAccessModel` lives in `examples/shared/access-model.ts`. `/api/db/model` still merges live `PRAGMA` schema with `catalog` for the matrix view.

| Host | Product | Entry | Extra |
|---|---|---|---|
| `examples/crm-workspace` | Meridian | `npm run crm` | `/explorer.html` |
| `examples/support-desk` | Clearline | `npm run support` | `/explorer.html` |
| `examples/agent-studio` | Keel | `npm run agent` | `/explorer.html`, generated floor, copilot |

Meridian Pipeline is a three-column board of open deals (discovery, proposal, renewal). Closed accounts stay off the board. Accounts is the company book: people, titles, last touch, and reachable phone or email when the role allows it. Both views share the same `contacts` rows and deal drawer.

Keel starts as an empty floor. The copilot composes tables, cards, stats, and action forms from `project()`. On boot, `ensurePurchaseOrderReason` adds `reason` to persisted SQLite files created before that column existed. New drafts write the executing CUP subject (`ExecutionContext.actorId`) into `requested_by`. The orders read model aliases `requested_by` as `requestedBy`. `composeKeelUi` in `examples/agent-studio/src/compose.ts` maps green chips one-to-one. Copilot "Try asking" prompts compose new layouts from the authorized view (custom titles, column subsets, cards, notices) rather than those chips. Clear chat is client-only and does not clear the floor. `POST /api/compose` and `POST /api/chat` both return `{ text, surfaces, suggestions }`.

Product HTML under each `public/` uses relative `app.css`, `app.js`, `client.js`, and `explorer.html` so a host can inject `<base href="/play/{app}/">`. Explorer assets in `examples/shared/public/` are relative the same way.

Docusaurus page: `docs/docs/build/examples.md`. Marketing host: sibling `marketing/` mounts these apps at `/play/{crm,support,agent}/` with each `public/` directory and SQLite under `marketing/data/`.

After protocol or example-host changes:

```bash
npm run build
cd examples
npm install
npm test
```

