-- TA Metrics persistent trade index
-- Run this once in Supabase > SQL Editor.

create table if not exists public.ta_swaps (
  tx_hash text not null,
  log_index integer not null,
  pool_id text not null,
  block_number bigint not null,
  block_timestamp timestamptz not null,
  wallet text,
  side text not null check (side in ('buy', 'sell')),
  ta_amount numeric not null,
  usd_volume_estimate numeric,
  ta_price_usd_used numeric,
  indexed_at timestamptz not null default now(),
  primary key (tx_hash, log_index)
);

create index if not exists ta_swaps_timestamp_idx on public.ta_swaps (block_timestamp desc);
create index if not exists ta_swaps_wallet_idx on public.ta_swaps (wallet);
create index if not exists ta_swaps_side_timestamp_idx on public.ta_swaps (side, block_timestamp desc);

create table if not exists public.ta_indexer_state (
  id text primary key,
  last_synced_block bigint,
  backfill_start_block bigint,
  backfill_cursor_block bigint,
  backfill_target_block bigint,
  backfill_complete boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.ta_swaps enable row level security;
alter table public.ta_indexer_state enable row level security;

revoke all on table public.ta_swaps from anon, authenticated;
revoke all on table public.ta_indexer_state from anon, authenticated;
grant all on table public.ta_swaps to service_role;
grant all on table public.ta_indexer_state to service_role;
