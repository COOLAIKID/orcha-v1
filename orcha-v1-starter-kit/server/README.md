# Smart AI Router — $20 Orcha Pro on a ~$10 VM

Everyday chat is 100% free-tier. A live free model ranked at or above GPT-5.6 (Ox Alpha today) takes **all** work. About $5/month of GPT-5.6 is only used when no such model is listed.

## What it does

0. **Star (continuous)** — OpenRouter catalog refresh every 15 minutes. If `stealth/ox-alpha` (or any later free model) is still $0 and ranks ≥ GPT-5.6, it handles general and advanced prompts with full context. Video **creation** is outsourced; Ox Alpha can take video as input and replies in text.
1. **Tier 1 (premium simulator)** — Google AI Studio free tier, Gemini 2.5 Flash, full system prompt + history, **50,000 tokens/user/month**, no delay.
2. **Tier 2 (infinite fallback)** — after 50k tokens, Groq free tier Llama 3.3 70B (or Gemini with a tiny context). System prompt becomes one sentence. History is the last **2 turns**. **5 second** delay before the provider call.
3. **Frontier (optional)** — if `OPENAI_API_KEY` is set and no star model is live, challenging prompts can use GPT-5.6 until **$5/month** is spent.

Mock users (in-memory):

- `user-under-limit` — 0% usage → Tier 1
- `user-at-limit` — 100% usage → Tier 2

## Run on the VM

```bash
cd server
npm install          # Express. Optional: skip and the process still boots on node:http
copy .env.example .env
npm start            # http://127.0.0.1:8787
```

Local preview (`cd ui && npm run dev`) uses the **same router** inside Vite at http://127.0.0.1:5175/api/chat — you do not need this process for day-to-day UI work.

## Test both paths

```bash
curl -N http://127.0.0.1:8787/api/usage/user-under-limit
curl -N http://127.0.0.1:8787/api/usage/user-at-limit

curl -N -H "Content-Type: application/json" -d "{\"userId\":\"user-under-limit\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}" http://127.0.0.1:8787/api/chat

curl -N -H "Content-Type: application/json" -d "{\"userId\":\"user-at-limit\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello again\"}]}" http://127.0.0.1:8787/api/chat
```

The second chat waits 5 seconds on purpose.

## Env

See `.env.example`. Free keys: [OpenRouter](https://openrouter.ai/keys) (Ox Alpha), [Google AI Studio](https://aistudio.google.com/apikey), and [Groq](https://console.groq.com/keys). Leave `OPENAI_API_KEY` empty for a $0 prototype. Inspect `GET /api/models` for the live catalog.
