# Developer notes: example hosts

Runnable CUP hosts live in `examples/`. Product screens are branded apps (Meridian, Clearline, Keel). Shared pieces: HTTP/MCP host, SQLite helper, read-only explorer (ER diagram, access matrix, browse, SQL). The Diagram tab and the Access model graph both pan, zoom (wheel or +/-), and let you drag cards; positions persist in `sessionStorage`. Domain policy stays in CUP. Each host also seeds `access_*` SQLite tables from `catalog` so grants show up as rows with foreign keys. `seedAccessModel` lives in `examples/shared/access-model.ts`. `/api/db/model` still merges live `PRAGMA` schema with `catalog` for the matrix view.

| Host | Product | Entry | Extra |
|---|---|---|---|
| `examples/crm-workspace` | Meridian | `npm run crm` | `/explorer.html` |
| `examples/support-desk` | Clearline | `npm run support` | `/explorer.html` |
| `examples/agent-studio` | Keel | `npm run agent` | `/explorer.html`, copilot |

Meridian Pipeline is a three-column board of open deals (discovery, proposal, renewal). Closed accounts stay off the board. Accounts is the company book: people, titles, last touch, and reachable phone or email when the role allows it. Both views share the same `contacts` rows and deal drawer.

Keel purchase orders store `reason` and `requested_by`. On boot, `ensurePurchaseOrderReason` adds `reason` to persisted SQLite files created before that column existed. New drafts write the executing CUP subject (`ExecutionContext.actorId`) into `requested_by`, not a hardcoded workspace string. The orders read model aliases `requested_by` as `requestedBy` so the table can render both fields.

After protocol or example-host changes:

```bash
npm run build
cd examples
npm install
npm test
```

