begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('public', 'session_content', 'session_content table exists');
select col_not_null('public', 'session_content', 'session_id', 'session_id is required');
select col_not_null('public', 'session_content', 'visibility', 'visibility is required');
select col_not_null('public', 'session_content', 'created_at', 'created_at is required');
select col_not_null('public', 'session_content', 'updated_at', 'updated_at is required');
select col_is_null('public', 'session_content', 'notes', 'notes may be omitted');
select col_is_null('public', 'session_content', 'video_url', 'video_url may be omitted');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.session_content'::regclass),
  'session_content has RLS enabled'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'session_content'
      and policyname = 'admin_all_session_content'
      and roles = array['authenticated']::name[]
  ),
  'admin policy targets authenticated and does not open anon'
);
select ok(not has_table_privilege('anon', 'public.session_content', 'SELECT'), 'anonymous cannot read session_content');
select ok(not has_table_privilege('anon', 'public.session_content', 'INSERT'), 'anonymous cannot insert session_content');
select ok(not has_table_privilege('authenticated', 'public.session_content', 'SELECT'), 'authenticated cannot read session_content without GRANT');
select ok(not has_table_privilege('authenticated', 'public.session_content', 'INSERT'), 'authenticated cannot insert session_content without GRANT');
select ok(not has_table_privilege('authenticated', 'public.session_content', 'UPDATE'), 'authenticated cannot update session_content without GRANT');
select ok(not has_table_privilege('authenticated', 'public.session_content', 'DELETE'), 'authenticated cannot delete session_content without GRANT');
select ok(has_table_privilege('service_role', 'public.session_content', 'SELECT'), 'service_role can read session_content');
select ok(has_table_privilege('service_role', 'public.session_content', 'INSERT'), 'service_role can insert session_content');
select ok(has_table_privilege('service_role', 'public.session_content', 'UPDATE'), 'service_role can update session_content');
select ok(has_table_privilege('service_role', 'public.session_content', 'DELETE'), 'service_role can delete session_content');

insert into public.sessions (id, starts_at, ends_at, session_label)
values
  ('a3000000-0000-4000-8000-000000000001', '2026-11-10T00:00:00Z', '2026-11-10T01:30:00Z', 'Class 1'),
  ('a3000000-0000-4000-8000-000000000002', '2026-11-17T00:00:00Z', '2026-11-17T01:30:00Z', 'Class 1');

select lives_ok(
  $$insert into public.session_content (session_id, notes)
    values ('a3000000-0000-4000-8000-000000000001', 'Bring a towel')$$,
  'content inserts with notes and no video'
);

select is(
  (select visibility from public.session_content where session_id = 'a3000000-0000-4000-8000-000000000001'),
  'staff',
  'visibility defaults to staff'
);

select lives_ok(
  $$insert into public.session_content (session_id, video_url, visibility)
    values (
      'a3000000-0000-4000-8000-000000000002',
      'https://videos.example.com/class-1',
      'public'
    )$$,
  'https video and public visibility insert'
);

select lives_ok(
  $$update public.session_content
      set visibility = 'members', video_url = 'HTTPS://videos.example.com/members'
    where session_id = 'a3000000-0000-4000-8000-000000000002'$$,
  'members visibility is stored and https scheme is case-insensitive'
);

select throws_ok(
  $$update public.session_content
      set video_url = 'http://videos.example.com/a'
    where session_id = 'a3000000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'http video URLs are rejected'
);

select throws_ok(
  $$update public.session_content
      set video_url = 'javascript:alert(1)'
    where session_id = 'a3000000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'non-https video URLs are rejected'
);

select throws_ok(
  $$update public.session_content
      set video_url = 'https://user:pass@videos.example.com/a'
    where session_id = 'a3000000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'video URLs with credentials are rejected'
);

select throws_ok(
  $$update public.session_content
      set visibility = 'guests'
    where session_id = 'a3000000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'visibility must be staff, members, or public'
);

select throws_ok(
  $$update public.session_content
      set notes = repeat('a', 8001)
    where session_id = 'a3000000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'notes cannot exceed 8000 characters'
);

select throws_ok(
  $$insert into public.session_content (session_id, notes)
    values ('a3000000-0000-4000-8000-000000000002', 'second')$$,
  '23505',
  NULL,
  'one content row per session'
);

select throws_ok(
  $$insert into public.session_content (session_id, notes)
    values ('a3000000-0000-4000-8000-000000000099', 'missing session')$$,
  '23503',
  NULL,
  'content requires a session'
);

select throws_ok(
  $$update public.session_content
      set notes = '   '
    where session_id = 'a3000000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'blank notes are rejected'
);

select lives_ok(
  $$delete from public.sessions where id = 'a3000000-0000-4000-8000-000000000001'$$,
  'session delete cascades'
);

select is(
  (select count(*) from public.session_content where session_id = 'a3000000-0000-4000-8000-000000000001'),
  0::bigint,
  'session_content is removed with its session'
);

select * from finish();
rollback;
