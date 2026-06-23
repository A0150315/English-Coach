# English Coach Hooks

Persistent translation + vocabulary tracker for Claude Code. Two hooks fire on every turn:

- **On send** (`UserPromptSubmit`): your message is translated to idiomatic English and mined
  for B2+ vocabulary. A desktop toast shows the English. The pair is stored.
- **On reply done** (`Stop`): Claude's final message is mined for unfamiliar words. New and
  conflicting words are toasted and stored.

A static viewer on Cloudflare Pages (backed by D1) shows the full history — your Chinese, the
English, and a growing word list — refreshing within ~3s.

## How it works (the key design)

"Is this word unfamiliar?" is split into two stages:

- **Stage 1 — LLM (text-only, bounded prompt).** `deepseek-v4-flash` via AIGW
  `/v1/chat/completions`, `thinking:disabled`, `response_format:json_object`. One combined call
  returns `{en, words}`. Your known-set never enters the prompt → it stays `O(message length)`,
  never `O(vocab size)`.
- **Stage 2 — SQL (D1).** `/api/vocab` does `SELECT ... WHERE word IN (...)`, drops words you
  already know, and flags conflicts when a word's stored meaning differs from the new gloss.

Unfamiliar = candidates ∩ ¬known. No bloat, no agent.

## Setup

### 1. Cloudflare D1 + Pages

```bash
npm i -g wrangler
wrangler login
wrangler d1 create english-coach        # paste database_id into wrangler.toml
wrangler d1 execute english-coach --file=schema.sql
```

Push the repo to GitHub. In the Cloudflare dashboard: **Workers & Pages → Create → Pages →
Connect to Git** → pick the repo. Framework preset: none. Build command: none. Output dir:
`public`.

Bind the D1 database: **Settings → Functions → D1 database bindings → production →
COACH_DB → english-coach**.

Add environment variable **`COACH_API_KEY`** (generate a random secret, e.g.
`openssl rand -hex 24`).

### 2. Local hook secrets

```bash
cp .env.example .env
# fill in COACH_API_URL (your *.pages.dev URL) and COACH_API_KEY (same secret as above)
```

### 3. Wire the hooks

Add to `~/.claude/settings.json` (see the Settings section in the plan). Then `/hooks` to verify.

## Verify

```bash
# Stage 1 round-trip: should toast + print JSON, reasoning_tokens:0
echo '{"prompt":"帮我重构一下认证模块"}' | node hook/on-send.js
```

See the Verification section of the plan for the full assertion list.

## Repo layout

```
hook/            local Node scripts (NOT deployed) — Stage 1
functions/api/   Cloudflare Pages Functions — Stage 2 + reads
public/          static viewer (deployed)
schema.sql       D1 tables
```
