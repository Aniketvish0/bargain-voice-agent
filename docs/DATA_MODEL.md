# Data Model

Postgres for durable state; Redis for in-flight call state, the job queue, and the live quote board. Every extracted fact is traceable to a call → turn → recording, so nothing Doot reports is unverifiable.

## Schema

```sql
create table users (
  id            uuid primary key default gen_random_uuid(),
  telegram_id   bigint unique not null,
  name          text,
  default_lang  text default 'hi',
  prefs         jsonb default '{}',           -- budget habits, dietary, past choices
  created_at    timestamptz default now()
);

create table tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id),
  goal_text     text not null,
  constraints   jsonb not null,               -- must_haves, nice_to_haves, dates, people
  target_price  int,
  walk_away     int,
  status        text default 'draft',         -- draft|approved|calling|ranked|closing|done|cancelled
  created_at    timestamptz default now()
);

create table targets (
  id        uuid primary key default gen_random_uuid(),
  task_id   uuid references tasks(id),
  name      text not null,
  phone     text not null,
  lang      text default 'hi',
  source    text                              -- seed|places_api|user
);

create table calls (
  id            uuid primary key default gen_random_uuid(),
  target_id     uuid references targets(id),
  status        text default 'queued',        -- queued|dialing|live|escalated|done|no_answer|voicemail|callback|failed
  started_at    timestamptz,
  ended_at      timestamptz,
  recording_url text,
  record_hash   text,                         -- hash-chain signature (tamper-evident)
  outcome       text                          -- deal|walk_away|callback|unavailable
);

create table turns (
  id       uuid primary key default gen_random_uuid(),
  call_id  uuid references calls(id),
  speaker  text not null,                     -- doot|callee
  text     text not null,
  ts       timestamptz default now()
);

create table extractions (
  id              uuid primary key default gen_random_uuid(),
  call_id         uuid references calls(id) unique,
  available       boolean,
  base_price      int,                         -- first quote
  final_price     int,                         -- after negotiation
  savings_pct     int,
  concessions     jsonb,                       -- what was traded
  must_haves_met  boolean,
  notes           text,
  confidence      int,                         -- 0-100
  raw             jsonb
);

create table escalations (
  id           uuid primary key default gen_random_uuid(),
  call_id      uuid references calls(id),
  question     text not null,
  options      jsonb not null,
  answer       text,
  resolved_at  timestamptz,
  timed_out    boolean default false
);

create table bookings (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid references tasks(id),
  target_id        uuid references targets(id),
  final_price      int,
  confirmation_no  text,
  status           text default 'pending',     -- pending|confirmed|handed_off
  final_step_type  text,                        -- auto_confirmed|human_payment|human_id
  created_at       timestamptz default now()
);
```

## Redis keys (ephemeral)

| Key | Type | Purpose |
|---|---|---|
| `call:{call_id}:state` | hash | Resumable in-flight call state (turn state machine, negotiation state) |
| `task:{task_id}:quoteboard` | hash | **Live quote board** — `{target_id: final_price}`, read by every active negotiation for competitive leverage |
| `queue:calls` | list/stream | Job queue (BullMQ / Celery), bounded by max-parallel cap |
| `escalation:{call_id}` | string + TTL | Pending Checkpoint-B question awaiting the user's tap (~25s TTL) |

## Task state machine

```
draft ──(Checkpoint A: approve)──▶ approved ──▶ calling
calling ──(all calls settle)──▶ ranked ──(Checkpoint C: pick)──▶ closing
closing ──(confirm call / human handoff)──▶ done
   any ──(user cancels)──▶ cancelled
```

## Traceability & trust
- `extractions.final_price` always points back to `calls.recording_url` + the `turns` transcript that produced it.
- `calls.record_hash` chains recording + transcript so a quoted price is tamper-evident — the answer to "did Doot really get ₹3,500?" is *play the recording*.
- Per-user isolation: a query for a task always joins through `users.id`; one user can never read another's calls or bookings.
