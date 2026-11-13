begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_column('public', 'classes', 'description', 'classes.description exists');
select col_is_null('public', 'classes', 'description', 'description may be omitted');
select col_not_null('public', 'classes', 'name', 'name stays required');
select col_not_null('public', 'classes', 'instructor', 'instructor stays required');
select col_not_null('public', 'classes', 'capacity', 'capacity stays required');
select col_not_null('public', 'classes', 'duration_minutes', 'duration_minutes stays the default duration');
select col_not_null('public', 'classes', 'is_active', 'is_active stays required');
select col_not_null('public', 'classes', 'created_at', 'created_at stays required');
select col_not_null('public', 'classes', 'updated_at', 'updated_at stays required');

select has_column('public', 'sessions', 'class_id', 'sessions.class_id exists');
select col_is_null('public', 'sessions', 'class_id', 'sessions.class_id may be omitted');
select col_is_fk('public', 'sessions', 'class_id', 'sessions.class_id is a foreign key');
select fk_ok(
  'public',
  'sessions',
  'class_id',
  'public',
  'classes',
  'id',
  'sessions.class_id references classes.id'
);
select has_index(
  'public',
  'sessions',
  'idx_sessions_class_id',
  'sessions.class_id has a partial index'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.classes'::regclass),
  'classes has RLS enabled'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'classes'
      and policyname = 'admin_all_classes'
      and roles = array['authenticated']::name[]
  ),
  'admin policy targets authenticated and does not open anon'
);
select ok(not has_table_privilege('anon', 'public.classes', 'SELECT'), 'anonymous cannot read classes');
select ok(not has_table_privilege('anon', 'public.classes', 'INSERT'), 'anonymous cannot insert classes');
select ok(not has_table_privilege('authenticated', 'public.classes', 'SELECT'), 'authenticated cannot read classes without GRANT');
select ok(not has_table_privilege('authenticated', 'public.classes', 'INSERT'), 'authenticated cannot insert classes without GRANT');
select ok(not has_table_privilege('authenticated', 'public.classes', 'UPDATE'), 'authenticated cannot update classes without GRANT');
select ok(not has_table_privilege('authenticated', 'public.classes', 'DELETE'), 'authenticated cannot delete classes without GRANT');
select ok(has_table_privilege('service_role', 'public.classes', 'SELECT'), 'service_role can read classes');
select ok(has_table_privilege('service_role', 'public.classes', 'INSERT'), 'service_role can insert classes');
select ok(has_table_privilege('service_role', 'public.classes', 'UPDATE'), 'service_role can update classes');
select ok(has_table_privilege('service_role', 'public.classes', 'DELETE'), 'service_role can delete classes');

select lives_ok(
  $$insert into public.classes (name, instructor, day_of_week, start_time, duration_minutes, capacity)
    values ('No description', 'Alex', 1, '19:00', 90, 16)$$,
  'a class inserts without description'
);

select lives_ok(
  $$insert into public.classes (
      id, name, description, instructor, day_of_week, start_time, duration_minutes, capacity
    ) values (
      'a4000000-0000-4000-8000-000000000001',
      'Class 1',
      'Bring a towel',
      'Alex',
      1,
      '19:00',
      90,
      16
    )$$,
  'a class inserts with a description'
);

select throws_ok(
  $$insert into public.classes (name, description, instructor, day_of_week, start_time, duration_minutes, capacity)
    values ('Padded', ' padded ', 'Alex', 1, '19:00', 90, 16)$$,
  '23514',
  null,
  'description must already be trimmed'
);

select throws_ok(
  $$insert into public.classes (name, description, instructor, day_of_week, start_time, duration_minutes, capacity)
    values ('Too long', repeat('a', 2001), 'Alex', 1, '19:00', 90, 16)$$,
  '23514',
  null,
  'description cannot exceed 2000 characters'
);

select lives_ok(
  $$insert into public.sessions (id, starts_at, ends_at, session_label)
    values (
      'a4000000-0000-4000-8000-000000000010',
      '2026-11-10T00:00:00Z',
      '2026-11-10T01:30:00Z',
      'Unlinked'
    )$$,
  'a session inserts with no class'
);

select is(
  (select class_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000010'),
  null,
  'omitted class_id is null'
);

select lives_ok(
  $$insert into public.sessions (id, starts_at, ends_at, session_label, class_id)
    values (
      'a4000000-0000-4000-8000-000000000011',
      '2026-11-10T00:00:00Z',
      '2026-11-10T01:30:00Z',
      'Class 1',
      'a4000000-0000-4000-8000-000000000001'
    )$$,
  'a session can reference a class'
);

insert into public.classes (
  id, name, instructor, day_of_week, start_time, duration_minutes, capacity, is_active
) values (
  'a4000000-0000-4000-8000-000000000002',
  'Class 2',
  'Jordan',
  2,
  '18:00',
  60,
  12,
  false
);

select lives_ok(
  $$update public.sessions
    set cancelled_at = '2026-11-10T02:00:00Z'
    where id = 'a4000000-0000-4000-8000-000000000011'$$,
  'linked session can be cancelled'
);

select lives_ok(
  $$update public.sessions
    set class_id = 'a4000000-0000-4000-8000-000000000002',
        cancelled_at = '2026-11-11T02:00:00Z'
    where id = 'a4000000-0000-4000-8000-000000000011'$$,
  'class_id edit on a cancelled session is not dropped'
);

select is(
  (select class_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000011'),
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'cancelled session keeps the new class link'
);

select is(
  (select cancelled_at from public.sessions where id = 'a4000000-0000-4000-8000-000000000011'),
  timestamptz '2026-11-10 02:00:00+00',
  'class_id edit does not move cancelled_at'
);

select lives_ok(
  $$delete from public.classes where id = 'a4000000-0000-4000-8000-000000000002'$$,
  'deleting a class does not delete its sessions'
);

select is(
  (select class_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000011'),
  null,
  'deleting a class clears sessions.class_id'
);

select is(
  (select count(*) from public.sessions where id = 'a4000000-0000-4000-8000-000000000011'),
  1::bigint,
  'the session row remains after the class is deleted'
);

select * from finish();
rollback;
