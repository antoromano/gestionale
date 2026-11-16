-- 009_telegram_dedup.sql
-- Telegram rimanda lo stesso messaggio quando il bot non risponde subito: senza questo registro
-- una spesa poteva finire salvata due volte. Ogni update_id si elabora una volta sola.

create table if not exists public.telegram_processed_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);

alter table public.telegram_processed_updates enable row level security;

-- Nessuna policy: solo la Edge Function (service role) ci scrive. L'app non ha motivo di leggerlo.

-- Pulizia: si tengono solo gli ultimi 7 giorni, così la tabella non cresce all'infinito.
create index if not exists telegram_processed_updates_processed_at_idx
  on public.telegram_processed_updates (processed_at);

create or replace function public.purge_telegram_processed_updates()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.telegram_processed_updates where processed_at < now() - interval '7 days';
$$;

revoke all on function public.purge_telegram_processed_updates() from public, anon, authenticated;
