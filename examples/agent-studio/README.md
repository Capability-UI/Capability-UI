# Keel

Harbor warehouse: on-hand counts, purchase orders, and a right-hand copilot (PydanticAI). Buyers do not see unit cost and cannot submit POs.

http://127.0.0.1:8784 · Data explorer at `/explorer.html`

Configure `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, and `OPENAI_MODEL` in `.env` or the copilot panel.

```bash
cd examples && npm install
pip install -r agent-studio/python/requirements.txt
npm run agent
```
