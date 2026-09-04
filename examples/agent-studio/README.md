# Keel

Harbor warehouse copilot that generates the floor from an authorized view: tables, cards, stats, and forms. The canvas starts empty. Ask for a dashboard, a low-stock table, or a draft PO form. Buyers do not see unit cost and cannot get a submit form.

http://127.0.0.1:8784 · Data explorer at `/explorer.html`

Configure `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, and `OPENAI_MODEL` in `.env` or the copilot panel. Tables and forms generate without a model. Chat that changes counts needs a key.

```bash
cd examples && npm install
pip install -r agent-studio/python/requirements.txt
npm run agent
```
