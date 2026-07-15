-- TCG Pre-Grade — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query)

create extension if not exists pgcrypto;

create table if not exists pregrades (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  game text not null check (game in ('pokemon', 'onepiece')),
  card_name text,
  set_name text,
  card_number text,

  front_image_url text not null,
  back_image_url text not null,

  centering_score numeric,
  centering_front_ratio text,
  centering_back_ratio text,
  corners_score numeric,
  surface_score numeric,
  edges_score numeric,

  psa_estimate numeric,
  psa_confidence numeric,
  cgc_estimate numeric,
  cgc_confidence numeric,
  bgs_estimate numeric,
  bgs_confidence numeric,
  tag_estimate numeric,
  tag_confidence numeric,

  defects jsonb default '[]'::jsonb,
  ai_raw_response jsonb,
  notes text
);

create index if not exists pregrades_created_at_idx on pregrades (created_at desc);
create index if not exists pregrades_game_idx on pregrades (game);

-- Storage bucket for card photos. Private bucket; the app only ever accesses it
-- through Netlify Functions using the service-role key, so no public access
-- or RLS policy is required.
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', false)
on conflict (id) do nothing;

-- Row Level Security stays enabled with no policies, which blocks all
-- anon/authenticated access by default. Only the service-role key (used
-- server-side in Netlify Functions) bypasses RLS, which is exactly the
-- access pattern this app uses.
alter table pregrades enable row level security;
