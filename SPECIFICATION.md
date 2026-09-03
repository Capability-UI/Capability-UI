# Capability UI Protocol specification

The complete, versioned HTML specification is included in this repository at [`specification/index.html`](specification/index.html).

A copy is shipped with the Docusaurus site and is available at `/specification/` when the documentation site is built.

The specification defines:

- The agent-neutral CUP model
- Subjects, resources, capabilities, policies, and authorized views
- Discovery, inspection, reading, and execution
- Field-level filtering and structural redaction
- Confirmation, action tokens, idempotency, receipts, and reversal
- Delegation and attenuation
- External agent resources and runtime adapters
- MCP server and client profiles
- Subscriptions, revocation, and conformance requirements
- SQL persistence and host integration boundaries

The HTML file is the source artifact for the explainer and preserves its examples, diagrams, and interactive sections. Runtime behavior should be checked against both the specification and the executable tests in `test/`.
