# English Coach Hooks

Persistent translation + vocabulary tracker for Claude Code. Two hooks fire on every turn:

- **On send** (`UserPromptSubmit`): your message is translated to idiomatic English and mined
  for B2+ vocabulary. A desktop toast shows the English. The pair is stored.
- **On reply done** (`Stop`): Claude's final message is mined for unfamiliar words. New and
  conflicting words are toasted and stored.

A static viewer on Cloudflare Pages (backed by D1) shows the full history — your Chinese, the
English, and a growing word list — polling every 10s.

## Architecture (where each part runs)

```
local (your machine, 内网)
  → you send a message
  → hook fires (local Node process)
  → hook calls AIGW              ← happens ON YOUR MACHINE, inside 内网
  → AIGW responds
  → hook POSTs result to Cloudflare D1   ← only the DB update goes to Cloudflare

browser viewer ──poll 10s──► GET /api/recent ─► D1 ─► render history + vocab
```

- **AIGW = 内网 only.** The token never leaves your machine; Cloudflare never calls AIGW.
- **Cloudflare = public internet, storage + viewer only.**

## How it works (the key design)

"Is this word unfamiliar?" is split into two stages:

- **Stage 1 — LLM (text-only, bounded prompt).** `deepseek-v4-flash` via AIGW
  `/v1/chat/completions`, `thinking:{type:"disabled"}`, `response_format:{type:"json_object"}`.
  One combined call returns `{en, words}`. Your known-set never enters the prompt → it stays
  `O(message length)`, never `O(vocab size)`. `thinking:disabled` keeps reasoning tokens at 0
  (without it, DeepSeek burns ~1000+ tokens/call — fatal for a blocking hook).
- **Stage 2 — SQL (D1).** `/api/vocab` does `SELECT ... WHERE word IN (...)`, drops words you
  already know, and flags conflicts when a word's stored meaning differs from the new gloss.

Unfamiliar = candidates ∩ ¬known. No bloat, no agent.

## First-time setup

### 1. Cloudflare D1

```powershell
npm i -g wrangler
wrangler login
wrangler d1 create english-coach                     # paste database_id into wrangler.toml
wrangler d1 execute english-coach --file=schema.sql --remote   # --remote is REQUIRED for prod
```

> ⚠️ Without `--remote`, the schema only applies to your **local** dev DB. Pages uses the
> **remote** D1. Always add `--remote` for schema changes.

### 2. Cloudflare Pages (connected to Git)

1. Push the repo to GitHub.
2. Dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Build settings:
   - **构建命令 (Build command)**: _empty_
   - **构建输出 (Build output)**: `public`
   - **根目录 (Root directory)**: _empty_
   - Framework preset: **None** (`functions/` is auto-detected)
4. Note your URL — Cloudflare appends a suffix, e.g. `english-coach-7et.pages.dev` (not the
   bare `english-coach.pages.dev`).

### 3. Dashboard env vars + binding (REQUIRED — Functions won't work without them)

On the Pages project → **Settings**:

- **Variables and Secrets** → add `COACH_API_KEY` (any secret you pick — see below). Type
  **Secret**, environment **Production**.
- **Functions → D1 database bindings** → `COACH_DB` → `english-coach`.

> ⚠️ Env vars and bindings only apply to **new** deployments. After setting them, **redeploy**
> (push a commit, or Deployments → "Retry deployment").

### 4. Local hook secrets

```powershell
cp .env.example .env
```

Edit `.env`:

- `COACH_AIGW_TOKEN` = your AIGW bearer token (内网)
- `COACH_API_URL` = your real `*.pages.dev` URL (with the `-7et`-style suffix)
- `COACH_API_KEY` = **the exact same value** you set in the dashboard

### 5. Install as a plugin (portable across machines)

This repo is a Claude Code plugin **and** a plugin marketplace. Installing it via the
marketplace means the hooks use `${CLAUDE_PLUGIN_ROOT}` paths (no hardcoded `C:\Users\...`),
so the same install works on any machine/OS — one command, no clone, no manual path edits.

**Install from the GitHub marketplace (recommended):**

```
/plugin marketplace add A0150315/English-Coach
/plugin install english-coach@english-coach-marketplace
/reload-plugins
```

Verify with `/hooks` — you should see `english-coach` `UserPromptSubmit` + `Stop` hooks sourced
as `Plugin`. Update later with `/plugin update english-coach@english-coach-marketplace`.

**Alternatives:**

- **Skills-dir auto-load (local dev):** `git clone <repo> ~/.claude/skills/english-coach` —
  auto-discovered next session, no install command. Good for hacking on the plugin itself.
- **One-session test:** `claude --plugin-dir C:\path\to\english-coach`.

**Secrets on a new machine:** on first hook fire, the script seeds `.env` from
`.env.example` into the plugin's persistent data dir (`~/.claude/plugins/data/english-coach/.env`
on any OS). Edit that file once with your real `COACH_AIGW_TOKEN` + `COACH_API_KEY` — it
survives plugin updates and never enters git.

> **Migrating from the old manual setup?** Remove the `UserPromptSubmit` and `Stop` blocks from
> `~/.claude/settings.json` (the plugin now provides them). Keeping both would double-fire —
> identical handlers dedupe, but clean removal avoids confusion.

<details>
<summary>Alternative: wire hooks manually in settings.json (not portable, legacy)</summary>

Add to `~/.claude/settings.json` (note the machine-specific absolute path):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["C:\\Users\\tanjianqing\\english-coach\\hook\\on-send.js"]
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["C:\\Users\\tanjianqing\\english-coach\\hook\\on-stop.js"]
          }
        ]
      }
    ]
  }
}
```

This hardcodes the path — only use if you can't install as a plugin.

</details>

## About `COACH_API_KEY`

It's **not** a Cloudflare-issued token. It's just a shared passphrase (暗号) you pick — any
string, your choice — stored in two places:

- **Local**: `english-coach/.env` (gitignored)
- **Cloudflare**: Pages → Settings → Variables and Secrets

Both must match **exactly** (case-sensitive, no trailing spaces), or every request returns 401.

**To rotate it:**

1. Edit the value in `english-coach/.env`.
2. Edit the same value in the Cloudflare dashboard.
3. Redeploy (`git commit --allow-empty -m "chore: rotate key" && git push`, or dashboard retry).

Generate a new one anytime: `node -e "const c=require('crypto'); console.log(c.randomBytes(24).toString('hex'))"`.

## Quota (free tier — won't run out for personal use)

D1 free tier is **per account** (all D1s + Pages + Workers share one pool):

| Limit      | Free tier | Your usage                             |
| ---------- | --------- | -------------------------------------- |
| Storage    | 5 GB      | ~0.05 MB → ~490 years at 1000 msgs/day |
| Reads/day  | 5,000,000 | ~5,760 (10s poll, 8h/day)              |
| Writes/day | 100,000   | ~10/msg                                |

You will not hit these. The 10s poll keeps reads near zero.

## Day-to-day usage

- **Just use Claude Code normally.** Hooks fire automatically on send/stop. You'll see a
  desktop toast (OSC 9) with the English translation / new words.
- **Browse history**: open your `*.pages.dev` URL, paste `COACH_API_KEY` once (saved in
  `localStorage`), it polls every 10s when the tab is visible.
- **Debug**: tail `english-coach/hook.log` — one line per hook fire.

## Verify it works

```powershell
# Stage 1 round-trip: toasts + prints JSON, AIGW call ~0.5s
echo '{"prompt":"帮我重构一下认证模块"}' | node hook/on-send.js
```

Then check the viewer — the message + words appear within ~10s.

## Repo layout

```
hook/            local Node scripts (NOT deployed) — Stage 1 (AIGW call)
functions/api/   Cloudflare Pages Functions — Stage 2 + reads (D1)
   _auth.js      auth check (X-Coach-Key) + helpers
   message.js    POST insert a message
   vocab.js      POST Stage 2: filter known + conflict check + upsert
   recent.js     GET latest N messages joined with words (viewer polls this)
public/          static viewer (deployed) — index.html, app.js, style.css
schema.sql       D1 tables (messages, words, word_usages)
wrangler.toml    D1 binding COACH_DB + project config
.env.example     template for local secrets (copy to .env)
hook.log         runtime log (gitignored)
```

## If something breaks

- **All requests 401**: `COACH_API_KEY` mismatch between `.env` and dashboard, or you set it
  but didn't redeploy.
- **`api not stored` in hook.log**: `COACH_API_URL` in `.env` is wrong (check the `-7et`
  suffix), or `COACH_API_KEY` doesn't match.
- **500 on `/api/*`**: D1 binding `COACH_DB` missing in the dashboard, or schema not applied
  with `--remote`.
- **No toast**: hooks not wired in `settings.json`, or `COACH_AIGW_TOKEN` wrong/unreachable
  (内网 only). Check `hook.log`.
