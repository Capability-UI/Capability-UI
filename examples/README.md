# CUP examples

Three branded local apps. Each one:

1. Stores data in SQLite.
2. Enforces access with CUP (the product UI never shows capability IDs). Keel is the exception that shows generated components drawn from the authorized view, still without treating the screen as the lock.
3. Serves MCP at `POST /mcp` while it is running.
4. Includes a read-only **Data explorer** (`/explorer.html`) with a table diagram (foreign keys), a row browser, and SELECT. Permission data lives in SQLite (`access_principals`, `access_resources`, `access_grants`, `access_grant_operations`, `access_hidden_fields`) so it appears on Diagram, Browse, and SQL like any other table.

Open the app, then Data explorer in the nav. On Diagram and the Access model graph, scroll or use +/- to zoom, drag the canvas to pan, and drag cards to rearrange them. Writes happen only in the product screens. The explorer rejects INSERT/UPDATE/DELETE. CUP still enforces access; the `access_*` tables are a readable model of the seeded policy, not the enforcement engine.

| App | Brand | Command | Port |
|---|---|---|---|
| Sales CRM | Meridian | `npm run crm` | 8782 |
| IT service desk | Clearline | `npm run support` | 8783 |
| Warehouse + generated UI | Keel | `npm run agent` | 8784 |

```bash
cd Capability-UI
npm install && npm run build
cd examples
npm install
npm run crm
```

SQLite files are created under each example's `data/` directory on first run.
