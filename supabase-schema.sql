-- ════════════════════════════════════════════════════════════════
-- Forge 2.0 — Supabase Schema
-- Run this in your Supabase SQL editor to bootstrap the database.
-- ════════════════════════════════════════════════════════════════

-- 1. Enable pgvector extension
create extension if not exists vector;

-- ────────────────────────────────────────────────────────────────
-- 2. Users
-- ────────────────────────────────────────────────────────────────
create table if not exists users (
  id            text primary key,            -- GitHub user ID (string)
  github_login  text not null unique,
  name          text,
  avatar_url    text,
  email         text,
  created_at    timestamptz default now()
);

-- ────────────────────────────────────────────────────────────────
-- 3. Projects  (one project = one connected GitHub repo)
-- ────────────────────────────────────────────────────────────────
create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null references users(id) on delete cascade,
  repo_full_name  text not null,             -- e.g. "gauravpassi/forge2.0"
  repo_id         bigint,                    -- GitHub repo numeric ID
  default_branch  text default 'main',
  last_indexed_at timestamptz,
  index_status    text default 'idle',       -- idle | indexing | ready | error
  vercel_project  text,                      -- Vercel project name (optional)
  created_at      timestamptz default now(),
  unique(user_id, repo_full_name)
);

-- ────────────────────────────────────────────────────────────────
-- 4. Code chunks  (vector knowledge base per project)
-- ────────────────────────────────────────────────────────────────
create table if not exists code_chunks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  file_path    text not null,
  chunk_index  integer not null,            -- order within file
  content      text not null,              -- raw code text
  summary      text,                       -- 1-line summary for display
  language     text,                       -- ts | py | go | etc.
  start_line   integer,
  end_line     integer,
  token_count  integer,
  embedding    vector(768),                -- text-embedding-004 output
  created_at   timestamptz default now(),
  unique(project_id, file_path, chunk_index)
);

-- ivfflat index for fast cosine similarity search
-- (create AFTER inserting data; nlist = sqrt(row_count) is a good rule)
create index if not exists code_chunks_embedding_idx
  on code_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ────────────────────────────────────────────────────────────────
-- 5. Tasks
-- ────────────────────────────────────────────────────────────────
create table if not exists tasks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  user_id        text not null,
  description    text not null,
  status         text default 'queued',     -- queued | running | done | failed
  branch_name    text,
  pr_url         text,
  deploy_url     text,
  error          text,
  result_summary text,
  files_changed  jsonb,                     -- array of {path, action}
  created_at     timestamptz default now(),
  completed_at   timestamptz
);

-- ────────────────────────────────────────────────────────────────
-- 6. Helper function: vector similarity search
-- ────────────────────────────────────────────────────────────────
create or replace function match_code_chunks(
  query_embedding vector(768),
  match_project_id uuid,
  match_threshold float default 0.5,
  match_count int default 10
)
returns table (
  id          uuid,
  file_path   text,
  content     text,
  summary     text,
  language    text,
  start_line  integer,
  end_line    integer,
  similarity  float
)
language sql stable
as $$
  select
    cc.id,
    cc.file_path,
    cc.content,
    cc.summary,
    cc.language,
    cc.start_line,
    cc.end_line,
    1 - (cc.embedding <=> query_embedding) as similarity
  from code_chunks cc
  where
    cc.project_id = match_project_id
    and 1 - (cc.embedding <=> query_embedding) > match_threshold
  order by cc.embedding <=> query_embedding
  limit match_count;
$$;

-- ────────────────────────────────────────────────────────────────
-- 7. RLS Policies (enable row-level security)
-- ────────────────────────────────────────────────────────────────
alter table users        enable row level security;
alter table projects     enable row level security;
alter table code_chunks  enable row level security;
alter table tasks        enable row level security;

-- Service role bypasses RLS — all mutations go through service role key
-- (Forge 2.0 uses service role on the server; no direct client DB access)

-- Public read for own rows (optional — remove if service-role-only)
create policy "users: own row" on users
  for all using (id = current_setting('app.user_id', true));

create policy "projects: own rows" on projects
  for all using (user_id = current_setting('app.user_id', true));

create policy "tasks: own rows" on tasks
  for all using (user_id = current_setting('app.user_id', true));
