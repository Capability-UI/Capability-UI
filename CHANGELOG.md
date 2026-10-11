# Changelog

## 0.3.0

Requires Node.js 22.5 or newer (`engines.node` is `>=22.5`, `.nvmrc` is `22`). Core uses the built-in `node:sqlite` module. Package CI now installs Node from `.nvmrc`.

### Breaking

- **Delegation grants must list the capability's own operation.** `validDelegation` now requires `grant.operations` to include `capability.operation` (for example `update`, `delete`, `move`, or `create`). A grant that only lists `execute` no longer authorizes those tools. Re-issue grants with the real operation.
- Unauthenticated protected requests that do not match an allow now use reason `NO_ACCOUNT` (was `SUBJECT_NOT_AUTHENTICATED`, and `read` previously could surface `NO_MATCHING_ALLOW`). `NO_MATCHING_ALLOW` is only for authenticated subjects. Thrown errors remain `CUP_NOT_AUTHORIZED:<reason>`. Policies that allow guests (`principal: { any: true }` or similar) still allow public read/execute.
- Authorize and project tools with the capability's operation, not only `execute`.
- Confirmation hashes bind `{ capability, operation, input, policyVersion }`. Existing prepare hashes of input-only will not confirm. Set `confirmationKey` in production; plain SHA-256 remains only when no key is set.

### Receipts

- New receipts always set `operation` (`read` from `cup.read`, and the capability operation from `cup.execute`). The field stays optional on the type so older stored rows still parse.
- Policy denials on `read` and `execute` append a `denied` receipt with capability id, operation, actor, and reason code. Unauthenticated subjects are recorded as `{ id: 'anonymous', type: 'anonymous' }`, never the caller-supplied id. Denied receipts never store the input payload or a result summary. `writeDeniedReceipts` defaults on. A failure to persist a denied receipt is logged and never replaces `CUP_NOT_AUTHORIZED`.
- Receipts never store the raw input payload. Result summaries pass through `summarizeResult` (default: no summary for `delete`; ids and counts only otherwise). Arrays under `ids` / `*Ids` keep only string or number elements.
- `stripReceiptContent`, `scrubReceiptsForResource`, `MemoryReceiptSink.scrubForResource`, `CapabilityUI.scrubForResource`, and `CupPersistence.scrubReceiptsForResource` drop summaries, confirmation, and input hashes. `CapabilityUI.scrubForResource` also scrubs cached idempotent receipts.
- Call `migrateSqliteCupSchema` to upgrade an existing 0.2.0 SQLite database in place (one transaction, no receipt loss, idempotent, backfills `operation` from the capability suffix, and ensures `cup_subjects` exists). Postgres hosts should apply `sql/002_cup_receipts_operation.sql`, which also seeds an `anonymous` subject so denied guest receipts do not fail the `cup_subjects` foreign key.
- `appendReceipt` upserts the actor into `cup_subjects` (`INSERT ... ON CONFLICT DO NOTHING` of id and type) in the same transaction before inserting the receipt, so denied receipts for a signed-in caller with no prior subject row persist. A denied-receipt write failure is logged and still never replaces `CUP_NOT_AUTHORIZED`.

### Operations

- `move` is a core `Operation`. `update` and `delete` are invoked and projected as themselves rather than as generic `execute`.
- `update` records one resource ref (from `input.id` when present).
- `delete` defaults to high risk and explicit confirmation in both `defineCapability` and `register()` when those fields are omitted.
- `move` requires `{ id, toType }` and puts source and destination in `resourceRefs`.
- Policy evaluation, `discover`/`project`, and the MCP profile (`initialize._cup.operations`, `tools/list`) expose these operations.

### Confirmation hashes

- Pass `confirmationKey` to HMAC-SHA256 the confirmation binding. Short inputs are brute-forceable with the plain SHA-256 fallback.
- Hash compare uses `crypto.timingSafeEqual` on equal-length buffers.

### Migration

- Read `receipt.operation` first. For older rows, infer from the capability suffix (`.execute` -> `execute`, otherwise `read`).
- Re-issue delegation grants so `operations` includes the capability operation.
- Re-prepare in-flight confirmations; input-only hashes no longer match.
- Apply `sql/002_cup_receipts_operation.sql` or `migrateSqliteCupSchema` for existing databases.
- Grant id / owner fields on receipts are not in this release.
