-- Cadre AI support chatbot -- complete persistence layer.
-- Two tables and one function. Apply once to the Supabase project.
-- Source of truth: docs/architecture.md §5.

-- Every counter the governor owns: lifetime spend, per-day spend, rate-limit
-- windows. One shape, because they are all "a number that sometimes expires".
create table if not exists governor_ledger (
  key         text primary key,        -- '<ns>:spend:lifetime'
                                       -- | '<ns>:spend:day:2026-09-23'
                                       -- | '<ns>:rl:ip:<hmac>:<window>'
                                       -- <ns> is 'client' or 'dev' (ADR-014), so a dev
                                       -- deployment cannot move the client's tier
  value       double precision not null default 0,
  expires_at  timestamptz              -- null = never
);

-- Atomic increment-and-return. An expired row resets in place rather than
-- accumulating, so fixed-window rate limiting needs no cleanup job: a stale
-- row is harmless and the next write past expires_at starts a fresh window.
create or replace function governor_incr(
  p_key text, p_delta double precision, p_ttl_seconds int default null
) returns double precision language plpgsql as $$
declare v double precision;
begin
  insert into governor_ledger (key, value, expires_at)
  values (p_key, p_delta,
          case when p_ttl_seconds is null then null
               else now() + make_interval(secs => p_ttl_seconds) end)
  on conflict (key) do update set
    value = case when governor_ledger.expires_at is not null
                  and governor_ledger.expires_at < now()
                 then excluded.value
                 else governor_ledger.value + excluded.value end,
    expires_at = case when governor_ledger.expires_at is not null
                       and governor_ledger.expires_at < now()
                      then excluded.expires_at
                      else governor_ledger.expires_at end
  returning value into v;
  return v;
end $$;

create table if not exists leads (
  id text primary key,                 -- ULID, surfaced to the user as a reference
  name text, email text, company text,
  topic text not null,
  urgency text not null check (urgency in ('general','active_project','existing_client')),
  created_at timestamptz not null default now()
);

-- RLS on, no public policies. Only the service-role key (server-side) reads or
-- writes. The anon key cannot reach the ledger or a single lead even if it leaks.
alter table governor_ledger enable row level security;
alter table leads          enable row level security;

-- Hygiene, not correctness: 30-day lead retention (docs/architecture.md §5).
-- Run from Supabase's scheduler. Nothing breaks if it does not run.
--   delete from leads where created_at < now() - interval '30 days';
