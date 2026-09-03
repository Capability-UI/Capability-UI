---
id: production-checklist
title: Production checklist
sidebar_label: Production checklist
description: Move from the reference runtime to a production integration deliberately.
---

# Production checklist

The reference runtime gives you the semantic boundary. A production system must supply the operational controls around it.

## Identity and transport

- Verify tokens and session credentials before constructing `Subject`.
- Keep human, assistant, and service IDs distinct.
- Bind each request to a tenant and workspace in `RequestContext`.
- Add transport authentication, rate limits, timeouts, and request size limits.
- Never put provider credentials in resource metadata or receipts.

## Policy

- Store policies durably and version them atomically.
- Make policy updates invalidate prepared actions.
- Test explicit deny rules at higher priority than broad allows.
- Keep conditions deterministic and observable.
- Review delegation grants and provide revocation.

## Data

- Enforce tenant filtering in the data service, not only in CUP.
- Use field selection to reduce queries.
- Use redaction obligations for defense in depth.
- Paginate every potentially large read.
- Minimize event payloads and re-check access after revocation.

## Side effects

- Require explicit confirmation for sends, publishes, deletes, payments, and irreversible changes.
- Hash the exact normalized input that the user approved.
- Re-authorize immediately before invocation.
- Pass idempotency keys through to the provider.
- Make handlers safe to retry or reject duplicate keys.
- Record success, denial, and provider failure receipts.

## External assistants

- Give every assistant its own authenticated subject.
- Provide a filtered view instead of the full application catalog.
- Use short-lived, purpose-bound delegation grants.
- Treat assistant output as untrusted input.
- Validate assistant-generated inputs against capability schemas.
- Do not use prompts or generated UI as the enforcement layer.

## MCP

- Authenticate every MCP session.
- Map MCP identities to CUP subjects.
- Keep MCP discovery separate from resource reads.
- Expose only capabilities returned by the current authorized view.
- Re-run CUP execution for every `tools/call`.
- Map CUP reason codes to stable public errors without leaking policy internals.

## Observability

- Send receipts to a durable append-only store.
- Correlate request IDs across CUP, adapters, provider calls, and transport logs.
- Keep result summaries free of secrets and unnecessary personal data.
- Alert on repeated denials, expired delegation attempts, and handler failures.
- Review policy version and matched policy IDs during incidents.
