-- Scheduling v2 lane A3.
-- One session_content row per sessions row: staff notes, an optional HTTPS
-- video link, and visibility (staff | members | public, default staff).
-- Table privileges are service_role only, matching public.classes. The
-- authenticated admin policy matches other scheduling tables and does not
-- grant anon or authenticated access.
-- members visibility is stored here and is not served until member auth (A4).
-- Version 20261101101000 is the reserved A3 timestamp. Do not apply remotely
-- from this change; operators apply it before deploying the API that reads
-- session_content.

create table if not exists public.session_content (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  notes text,
  video_url text,
  visibility text not null default 'staff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_content_session_id_key unique (session_id),
  constraint session_content_visibility_check check (visibility in ('staff', 'members', 'public')),
  constraint session_content_notes_check check (
    notes is null
    or (
      char_length(notes) between 1 and 8000
      and notes = btrim(notes)
    )
  ),
  constraint session_content_video_url_https check (
    video_url is null
    or (
      char_length(video_url) between 1 and 2048
      and video_url ~* '^https://[^[:space:]/?#@]+'
      and video_url !~ '[[:space:]]'
      and video_url !~* '^https://[^/?#]*@'
      and video_url !~ '\\'
    )
  )
);

create index if not exists idx_session_content_public
  on public.session_content (session_id)
  where visibility = 'public';

comment on table public.session_content is
  'Scheduling v2 notes and HTTPS video link for one session. visibility defaults to staff. members is stored until member auth (A4). Public calendar may show visibility = public only.';

comment on column public.session_content.notes is
  'Staff-authored notes. Distinct from sessions.notes. Null when unset. Trimmed, 1–8000 characters.';

comment on column public.session_content.video_url is
  'Optional absolute https URL. http and other schemes are rejected.';

comment on column public.session_content.visibility is
  'staff (default), members, or public. Public calendar reads public only.';

drop trigger if exists update_session_content_updated_at on public.session_content;
create trigger update_session_content_updated_at
  before update on public.session_content
  for each row execute function public.update_updated_at_column();

alter table public.session_content enable row level security;

revoke all on public.session_content from public, anon, authenticated;

drop policy if exists admin_all_session_content on public.session_content;
create policy "admin_all_session_content" on public.session_content
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select, insert, update, delete on public.session_content to service_role;
