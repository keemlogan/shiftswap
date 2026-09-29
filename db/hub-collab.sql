-- ShiftSwap hub: shared version history for documents edited on the hub (Supabase, public schema).
-- Reads are open; writes go only through the three SECURITY DEFINER functions, which keep the history append-only
-- and assign version labels under a row lock (v1 -> v2 on the head; a stale base -> v1.1, v1.2, v1.1.1 ...).
-- Anyone may save (no accounts, by design), so saves and restores are limited per document to 10 a minute and
-- 100 a day, all saves, restores and translations together to 60 MB a day (doc_bytes_today), and the size of a body per document (public.doc_limits; bytes of the English body / of a Korean
-- translation): proposal 300 kB / 400 kB, interim 400 kB / 600 kB, final-report 1.5 MB / 2 MB. A document without a
-- doc_limits row (the e2e... test documents) gets 300 kB / 400 kB. A test of a larger cap inserts a doc_limits row for
-- its e2e... document through the owner connection and deletes it together with the document.
-- The file is idempotent. Re-running it keeps existing rows, including doc_limits rows; change a cap with
-- update public.doc_limits set max_bytes = ..., max_ko_bytes = ... where doc = '...' (at most 1.5 MB / 2 MB, the
-- html check constraints below).

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
  html text not null check (octet_length(html) between 1 and 1500000),
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
  html text not null check (octet_length(html) between 1 and 2000000),
  created_at timestamptz not null default now(),
  unique (version_id, lang, engine)
);

-- Earlier installs had 600 kB / 900 kB ceilings; the ceilings must allow the largest cap in doc_limits.
alter table public.doc_versions drop constraint if exists doc_versions_html_check;
alter table public.doc_versions add constraint doc_versions_html_check check (octet_length(html) between 1 and 1500000);
alter table public.doc_translations drop constraint if exists doc_translations_html_check;
alter table public.doc_translations add constraint doc_translations_html_check check (octet_length(html) between 1 and 2000000);

-- Size caps per document, read only by save_version and add_translation (security definer).
create table if not exists public.doc_limits (
  doc text primary key check (doc ~ '^[a-z0-9-]{1,40}$'),
  max_bytes integer not null check (max_bytes between 1 and 1500000),
  max_ko_bytes integer not null check (max_ko_bytes between 1 and 2000000)
);
insert into public.doc_limits (doc, max_bytes, max_ko_bytes)
values ('proposal', 300000, 400000), ('interim', 400000, 600000), ('final-report', 1500000, 2000000)
on conflict (doc) do nothing;

-- Daily byte budget over all documents (versions and translations of the last 24 hours), so that anonymous saves
-- cannot fill the project's storage quota, which the app's shared mode uses too: 60 MB a day. Seeds and 'claude'
-- translations loaded by the team through the owner connection do not go through the functions below.
create index if not exists doc_versions_time_idx on public.doc_versions (created_at);
create index if not exists doc_translations_time_idx on public.doc_translations (created_at);
create or replace function public.doc_bytes_today()
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce((select sum(octet_length(v.html)) from public.doc_versions v where v.created_at > now() - interval '1 day'), 0)
       + coalesce((select sum(octet_length(t.html)) from public.doc_translations t where t.created_at > now() - interval '1 day'), 0);
$$;
revoke execute on function public.doc_bytes_today() from public, anon, authenticated;

alter table public.doc_versions enable row level security;
alter table public.doc_heads enable row level security;
alter table public.doc_translations enable row level security;
alter table public.doc_limits enable row level security;

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
  v_max integer;
begin
  p_author := btrim(coalesce(p_author, ''));
  if char_length(p_author) not between 1 and 40 then raise exception 'AUTHOR_REQUIRED'; end if;
  if p_html is null or p_html = '' then raise exception 'INVALID_HTML'; end if;
  v_max := coalesce((select l.max_bytes from public.doc_limits l where l.doc = p_doc), 300000);
  if octet_length(p_html) > v_max then
    raise exception '본문이 이 문서의 저장 한도(% kB)를 넘었습니다. (TOO_LARGE)', v_max / 1000;
  end if;

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
  if public.doc_bytes_today() + octet_length(p_html) > 60000000 then
    raise exception '오늘 저장할 수 있는 전체 용량(60 MB)을 넘었습니다. 내일 다시 저장하세요. (DAILY_BYTES)';
  end if;

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
-- No per-document size check: it copies a body of the same document (v.doc = p_doc) that passed the cap when it was
-- saved or seeded; the html check constraint remains the ceiling. The daily byte budget applies.
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
  if public.doc_bytes_today() + octet_length(v_src.html) > 60000000 then
    raise exception '오늘 저장할 수 있는 전체 용량(60 MB)을 넘었습니다. 내일 다시 저장하세요. (DAILY_BYTES)';
  end if;

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
declare
  v_max integer;
begin
  if p_lang is distinct from 'ko' then raise exception 'UNSUPPORTED_LANG'; end if;
  if p_html is null or p_html = '' then raise exception 'INVALID_HTML'; end if;
  select coalesce(l.max_ko_bytes, 400000) into v_max
  from public.doc_versions v left join public.doc_limits l on l.doc = v.doc
  where v.id = p_version_id;
  if not found then raise exception 'UNKNOWN_VERSION'; end if;
  if octet_length(p_html) > v_max then
    raise exception '번역이 이 문서의 저장 한도(% kB)를 넘었습니다. (TOO_LARGE)', v_max / 1000;
  end if;
  if public.doc_bytes_today() + octet_length(p_html) > 60000000 then
    raise exception '오늘 저장할 수 있는 전체 용량(60 MB)을 넘었습니다. 내일 다시 저장하세요. (DAILY_BYTES)';
  end if;
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

-- Least privilege: the API roles only read these tables (default grants in the public schema would allow more)
-- and have no access to doc_limits (no grant, no policy).
revoke insert, update, delete, truncate, references, trigger on public.doc_versions, public.doc_heads, public.doc_translations from anon, authenticated;
revoke all on public.doc_limits from anon, authenticated;
