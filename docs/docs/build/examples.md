---
id: examples
title: Example applications
sidebar_label: Example applications
description: Run branded local CUP apps with SQLite and a SQL explorer.
---

# Example applications

`examples/` ships three branded hosts. The product UI looks like a CRM, a service desk, and a warehouse console. CUP stays on the server. Each process also exposes MCP and a read-only SQLite explorer.

See the [examples README](https://github.com/Capability-UI/Capability-UI/tree/main/examples) for ports. The protocol workspace marketing site can host the same processes at `/play/crm/`, `/play/support/`, and `/play/agent/`. Product HTML uses relative asset URLs so that prefix works with `<base href>`.

## Setup

```bash
npm install
npm run build
cd examples
npm install
```

## Meridian (CRM)

```bash
npm run crm
```

http://127.0.0.1:8782 · [Data explorer](http://127.0.0.1:8782/explorer.html)

Pipeline is open deals on a three-column board. Accounts is the company book (people, titles, last touch). Maya can email. Bob does not see phone, personal email, or deal value.

## Clearline (service desk)

```bash
npm run support
```

http://127.0.0.1:8783 · [Data explorer](http://127.0.0.1:8783/explorer.html)

Ticket queue and thread. Aisha can assign and escalate. Rio never sees internal notes.

## Keel (warehouse)

```bash
python3 -m venv agent-studio/.venv
source agent-studio/.venv/bin/activate
pip install -r agent-studio/python/requirements.txt
npm run agent
```

http://127.0.0.1:8784 · [Data explorer](http://127.0.0.1:8784/explorer.html)

Inventory and purchase orders, generated onto a blank floor by the copilot. Ask it to add a table, form, cards, or a dashboard. Configure `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, and `OPENAI_MODEL` if you want the model to change data in chat. Generated forms still call CUP without a model.

The explorer Diagram tab and Access model graph pan, zoom with the wheel or +/- buttons, and let you drag cards. Browse and SQL include both product tables and `access_*` permission tables. The Access model tab also has a grant matrix. SELECT, WITH, EXPLAIN, and table PRAGMA only. CUP still enforces access; the `access_*` tables document the seeded policy.
