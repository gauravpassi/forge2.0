# Forge 2.0 — Setup Guide

## Prerequisites

- Node.js 20+
- A GitHub account
- A Supabase project (free tier works)
- A Google AI Studio account (for Gemini)

---

## 1. GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in:
   - **Application name**: `Forge 2.0`
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github`
3. Copy the **Client ID** and generate a **Client Secret**

```env
GITHUB_CLIENT_ID=<your-client-id>
GITHUB_CLIENT_SECRET=<your-client-secret>
```

---

## 2. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the entire `supabase-schema.sql` file
3. Grab your keys from **Project Settings → API**:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

---

## 3. Google Gemini API Key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Create an API key
3. Paste into `GOOGLE_GEMINI_API_KEY`

The free tier supports:
- `text-embedding-004` — 1M requests/month free
- `gemini-2.0-flash` — 15 RPM / 1M tokens/day free

---

## 4. Auth Secret

Generate a random 32+ character string:

```bash
openssl rand -base64 32
```

Paste into `AUTH_SECRET`.

---

## 5. Vercel Token (optional)

Only needed if you want Forge to auto-deploy after each task.

1. Go to [vercel.com/account/tokens](https://vercel.com/account/tokens)
2. Create a token with full scope
3. Paste into `VERCEL_TOKEN`

---

## 6. Fill `.env.local`

```env
# Auth
AUTH_SECRET=<32-char-random-secret>
GITHUB_CLIENT_ID=<from step 1>
GITHUB_CLIENT_SECRET=<from step 1>

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# AI
GOOGLE_GEMINI_API_KEY=<from step 3>
ANTHROPIC_API_KEY=<optional — only for complex tasks>

# Vercel (optional)
VERCEL_TOKEN=<from step 5>

# App
NEXTAUTH_URL=http://localhost:3000
```

---

## 7. Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → Sign in with GitHub → Connect a repo → Index it → Submit tasks.

---

## How It Works

```
User submits task
       │
       ▼
RAG search (pgvector similarity)
       │
       ▼
Gemini Flash plans which files to change
       │
       ▼
Expanded RAG search per file
       │
       ▼
Gemini Flash generates code for each file
       │
       ▼
simple-git: clone → branch → apply → commit → push
       │
       ▼
Octokit: create Pull Request
       │
       ▼
(optional) Vercel: trigger deploy
       │
       ▼
RAG updates only changed files (incremental re-index)
```

## Cost Estimate (per task)

| Operation | Model | Approx Cost |
|-----------|-------|-------------|
| RAG embed (query) | text-embedding-004 | ~$0.000004 |
| Planning | gemini-2.0-flash | ~$0.002 |
| Code gen (3 files) | gemini-2.0-flash | ~$0.005 |
| Total | | **~$0.007/task** |

Indexing a 500-file repo: ~$0.05 one-time.
