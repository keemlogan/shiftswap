-- ShiftSwap hub: shared version history for documents edited on the hub (Supabase, public schema).
-- Reads are open; writes go only through the three SECURITY DEFINER functions, which keep the history append-only
-- and assign version labels under a row lock (v1 -> v2 on the head; a stale base -> v1.1, v1.2, v1.1.1 ...).
-- Anyone may save (no accounts, by design), so saves and restores are limited per document to 10 a minute and
-- 100 a day, and a body to 300 kB.

create table if not exists public.doc_versions (
  id bigint generated always as identity primary key,
  doc text not null check (doc ~ '^[a-z0-9-]{1,40}$'),
  label text not null check (label ~ '^[0-9]+(\.[0-9]+)*$'),
  parent_id bigint references public.doc_versions (id),
  is_main boolean not null,
  kind text not null default 'edit' check (kind in ('seed', 'edit', 'restore')),
  restored_from bigint references public.doc_versions (id),
  author text not null check (char_length(author) between 1 and 40),
  note text check (note is null or char_length(note) <= 200),
  html text not null check (octet_length(html) between 1 and 600000),
  created_at timestamptz not null default now(),
  unique (doc, label)
);
create index if not exists doc_versions_doc_idx on public.doc_versions (doc, id);
create index if not exists doc_versions_parent_idx on public.doc_versions (parent_id);
create index if not exists doc_versions_restored_idx on public.doc_versions (restored_from);
create index if not exists doc_versions_doc_time_idx on public.doc_versions (doc, created_at);

create table if not exists public.doc_heads (
  doc text primary key,
  head_id bigint not null references public.doc_versions (id),
  main_count integer not null check (main_count >= 1)
);
create index if not exists doc_heads_head_idx on public.doc_heads (head_id);

create table if not exists public.doc_translations (
  id bigint generated always as identity primary key,
  version_id bigint not null references public.doc_versions (id),
  lang text not null default 'ko' check (lang = 'ko'),
  engine text not null check (engine in ('claude', 'chrome')),
  html text not null check (octet_length(html) between 1 and 900000),
  created_at timestamptz not null default now(),
  unique (version_id, lang, engine)
);

alter table public.doc_versions enable row level security;
alter table public.doc_heads enable row level security;
alter table public.doc_translations enable row level security;

drop policy if exists "read versions" on public.doc_versions;
drop policy if exists "read heads" on public.doc_heads;
drop policy if exists "read translations" on public.doc_translations;
create policy "read versions" on public.doc_versions for select to anon, authenticated using (true);
create policy "read heads" on public.doc_heads for select to anon, authenticated using (true);
create policy "read translations" on public.doc_translations for select to anon, authenticated using (true);

-- Tables are not exposed to the Data API by default in new projects (2026-05-30 change): grant reads only.
grant select on public.doc_versions, public.doc_heads, public.doc_translations to anon, authenticated;

-- Save an edited document. Base = head -> next main version; otherwise a branch under the base.
create or replace function public.save_version(p_doc text, p_base_id bigint, p_author text, p_html text, p_note text default null)
returns table (id bigint, label text, is_main boolean, head_label text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_head public.doc_heads%rowtype;
  v_base public.doc_versions%rowtype;
  v_label text;
  v_main boolean;
  v_n integer;
  v_id bigint;
begin
  p_author := btrim(coalesce(p_author, ''));
  if char_length(p_author) not between 1 and 40 then raise exception 'AUTHOR_REQUIRED'; end if;
  if p_html is null or octet_length(p_html) not between 1 and 300000 then raise exception 'INVALID_HTML'; end if;

  select * into v_head from public.doc_heads h where h.doc = p_doc for update;
  if not found then raise exception 'UNKNOWN_DOC'; end if;
  if (select count(*) from public.doc_versions v where v.doc = p_doc and v.created_at > now() - interval '1 minute') >= 10 then
    raise exception '저장이 너무 잦습니다. 1분 뒤 다시 저장하세요. (RATE_LIMIT)';
  end if;
  if (select count(*) from public.doc_versions v where v.doc = p_doc and v.created_at > now() - interval '1 day') >= 100 then
    raise exception '오늘 저장 한도(100회)를 넘었습니다. (DAILY_LIMIT)';
  end if;
  select * into v_base from public.doc_versions v where v.id = p_base_id and v.doc = p_doc;
  if not found then raise exception 'UNKNOWN_BASE'; end if;

  if v_base.id = v_head.head_id then
    v_n := v_head.main_count + 1;
    v_label := v_n::text;
    v_main := true;
  else
    select count(*) + 1 into v_n from public.doc_versions v where v.parent_id = v_base.id and not v.is_main;
    v_label := v_base.label || '.' || v_n;
    v_main := false;
  end if;

  insert into public.doc_versions as dv (doc, label, parent_id, is_main, kind, author, note, html)
  values (p_doc, v_label, v_base.id, v_main, 'edit', p_author, nullif(btrim(p_note), ''), p_html)
  returning dv.id into v_id;

  if v_main then
    update public.doc_heads h set head_id = v_id, main_count = v_n where h.doc = p_doc;
  end if;

  return query
    select v_id, v_label, v_main,
           case when v_main then v_label
                else (select v.label from public.doc_versions v where v.id = v_head.head_id) end;
end
$$;

-- Restore = a new main version with the content of an earlier one, only if the head is still the one the user saw.
create or replace function public.restore_version(p_doc text, p_version_id bigint, p_expected_head_id bigint, p_author text)
returns table (id bigint, label text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_head public.doc_heads%rowtype;
  v_src public.doc_versions%rowtype;
  v_n integer;
  v_id bigint;
begin
  p_author := btrim(coalesce(p_author, ''));
  if char_length(p_author) not between 1 and 40 then raise exception 'AUTHOR_REQUIRED'; end if;

  select * into v_head from public.doc_heads h where h.doc = p_doc for update;
  if not found then raise exception 'UNKNOWN_DOC'; end if;
  if v_head.head_id is distinct from p_expected_head_id then raise exception 'HEAD_CHANGED'; end if;
  if (select count(*) from public.doc_versions v where v.doc = p_doc and v.created_at > now() - interval '1 minute') >= 10 then
    raise exception '저장이 너무 잦습니다. 1분 뒤 다시 저장하세요. (RATE_LIMIT)';
  end if;
  if (select count(*) from public.doc_versions v where v.doc = p_doc and v.created_at > now() - interval '1 day') >= 100 then
    raise exception '오늘 저장 한도(100회)를 넘었습니다. (DAILY_LIMIT)';
  end if;
  select * into v_src from public.doc_versions v where v.id = p_version_id and v.doc = p_doc;
  if not found then raise exception 'UNKNOWN_VERSION'; end if;
  if v_src.id = v_head.head_id then raise exception 'ALREADY_HEAD'; end if;

  v_n := v_head.main_count + 1;
  insert into public.doc_versions as dv (doc, label, parent_id, is_main, kind, restored_from, author, note, html)
  values (p_doc, v_n::text, v_head.head_id, true, 'restore', v_src.id, p_author, 'v' || v_src.label || ' 복원', v_src.html)
  returning dv.id into v_id;
  update public.doc_heads h set head_id = v_id, main_count = v_n where h.doc = p_doc;

  return query select v_id, v_n::text;
end
$$;

-- Store a browser-made Korean translation of one version (first one wins; 'claude' translations are loaded by the team).
create or replace function public.add_translation(p_version_id bigint, p_lang text, p_html text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lang is distinct from 'ko' then raise exception 'UNSUPPORTED_LANG'; end if;
  if p_html is null or octet_length(p_html) not between 1 and 400000 then raise exception 'INVALID_HTML'; end if;
  if not exists (select 1 from public.doc_versions v where v.id = p_version_id) then raise exception 'UNKNOWN_VERSION'; end if;
  insert into public.doc_translations (version_id, lang, engine, html)
  values (p_version_id, 'ko', 'chrome', p_html)
  on conflict (version_id, lang, engine) do nothing;
end
$$;

revoke execute on function public.save_version(text, bigint, text, text, text) from public;
revoke execute on function public.restore_version(text, bigint, bigint, text) from public;
revoke execute on function public.add_translation(bigint, text, text) from public;
grant execute on function public.save_version(text, bigint, text, text, text) to anon, authenticated;
grant execute on function public.restore_version(text, bigint, bigint, text) to anon, authenticated;
grant execute on function public.add_translation(bigint, text, text) to anon, authenticated;

-- Least privilege: the API roles only read these tables (default grants in the public schema would allow more).
revoke insert, update, delete, truncate, references, trigger on public.doc_versions, public.doc_heads, public.doc_translations from anon, authenticated;
