# Changelog

## 0.3.0

Requires Node.js 22.5 or newer (`engines.node` is `>=22.5`, `.nvmrc` is `22`). Core uses the built-in `node:sqlite` module. Package CI now installs Node from `.nvmrc`.

### Receipts

- New receipts always set `operation` (`read` from `cup.read`, and the capability operation from `cup.execute`). The field stays optional on the type so older stored rows still parse.
- Policy denials on `read` and `execute` (including unauthenticated subjects, reason `NO_ACCOUNT`) append a `denied` receipt with capability id, operation, actor, and reason code. When there is no subject, the actor is `{ id: 'anonymous', type: 'anonymous' }`. Denied receipts never store the input payload or a result summary. `writeDeniedReceipts` on `CapabilityUI` defaults to on and can be a boolean or a sampling function.
- Receipts never store the raw input payload. Result summaries pass through `summarizeResult` (default: no summary for `delete`; ids and counts only otherwise).
- `stripReceiptContent`, `scrubReceiptsForResource`, and `MemoryReceiptSink.scrubForResource` drop summaries, confirmation, and input hashes from receipts that reference a resource id, so hosts can scrub history after a hard delete.

### Operations

- `move` is a core `Operation`. `update` and `delete` are invoked and projected as themselves rather than as generic `execute`.
- `update` records one resource ref (from `input.id` when present).
- `delete` defaults to high risk and explicit confirmation in `defineCapability` (same prepare/confirm hash binding as execute).
- `move` requires `{ id, toType }` and puts source and destination in `resourceRefs`.
- Policy evaluation, `discover`/`project`, and the MCP profile (`initialize._cup.operations`, `tools/list`) expose these operations.

### Confirmation hashes

- Pass `confirmationKey` to HMAC-SHA256 the canonical input. Plain SHA-256 remains only when no key is set. Short health-style inputs are brute-forceable with the fallback; hosts should set a key.

### Migration

- Read `receipt.operation` first. For older rows, infer from the capability suffix or treat missing as `execute`/`read` from context.
- Unauthenticated protected requests now use reason `NO_ACCOUNT` (was `SUBJECT_NOT_AUTHENTICATED`). Thrown errors remain `CUP_NOT_AUTHORIZED:<reason>`.
- Authorize tools with the capability's operation (`update`, `delete`, `move`, `create`, `execute`), not only `execute`.
- Apply `sql/002_cup_receipts_operation.sql` if you already created receipts from `001_cup_initial.sql`.
- Set `confirmationKey` in production. Existing stored confirmation hashes remain SHA-256 until callers re-prepare with the key.
- Grant id / owner fields on receipts are not in this release.
