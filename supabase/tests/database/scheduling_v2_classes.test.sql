begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('public', 'classes', 'classes table exists');
select col_not_null('public', 'classes', 'name');
select col_not_null('public', 'classes', 'instructor');
select col_not_null('public', 'classes', 'day_of_week');
select col_not_null('public', 'classes', 'recurrence');
select col_not_null('public', 'classes', 'start_time');
select col_not_null('public', 'classes', 'duration_minutes');
select col_not_null('public', 'classes', 'capacity');
select col_not_null('public', 'classes', 'is_active');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.classes'::regclass),
  'classes has RLS enabled'
);
select ok(not has_table_privilege('anon', 'public.classes', 'SELECT'), 'anonymous cannot read classes');
select ok(not has_table_privilege('anon', 'public.classes', 'INSERT'), 'anonymous cannot insert classes');
select ok(not has_table_privilege('authenticated', 'public.classes', 'INSERT'), 'authenticated cannot insert classes without GRANT');
select ok(has_table_privilege('service_role', 'public.classes', 'SELECT'), 'service_role can read classes');
select ok(has_table_privilege('service_role', 'public.classes', 'INSERT'), 'service_role can insert classes');
select ok(has_table_privilege('service_role', 'public.classes', 'UPDATE'), 'service_role can update classes');
select ok(has_table_privilege('service_role', 'public.classes', 'DELETE'), 'service_role can delete classes');

select lives_ok(
  $$insert into public.classes (name, instructor, day_of_week, start_time, duration_minutes, capacity)
    values ('Class 1', 'Alex', 1, '19:00', 90, 16)$$,
  'valid weekly class inserts'
);

select is(
  (select recurrence from public.classes where name = 'Class 1'),
  'weekly',
  'recurrence defaults to weekly'
);

select throws_ok(
  $$insert into public.classes (name, instructor, day_of_week, start_time, duration_minutes, capacity)
    values ('Bad weekday', 'Alex', 0, '19:00', 90, 16)$$,
  '23514',
  NULL,
  'weekday must be ISO 1-7'
);

select throws_ok(
  $$insert into public.classes (name, instructor, day_of_week, recurrence, start_time, duration_minutes, capacity)
    values ('Daily', 'Alex', 1, 'daily', '19:00', 90, 16)$$,
  '23514',
  NULL,
  'only weekly recurrence is allowed'
);

select throws_ok(
  $$insert into public.classes (name, instructor, day_of_week, start_time, duration_minutes, capacity)
    values ('Overfull', 'Alex', 1, '19:00', 90, 0)$$,
  '23514',
  NULL,
  'capacity must be at least 1'
);

select throws_ok(
  $$insert into public.classes (name, instructor, day_of_week, start_time, duration_minutes, capacity)
    values ('Too long', 'Alex', 1, '19:00', 1441, 16)$$,
  '23514',
  NULL,
  'duration cannot exceed 24 hours'
);

select * from finish();
rollback;
