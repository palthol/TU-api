-- Placeholder participants and enrollment-only create RPC.
-- In-repo only. Do not apply to a live Supabase project from this change
-- (production jhxzecxkccqlgyazhsnb is paused and out of bounds).
-- Version 20261124120000 is after 20261113190000.
--
-- Adds:
--   participants.is_placeholder / placeholder_reason
--   participants.dob_is_placeholder / dob_placeholder_reason
--   nullable participants.email (name-only members)
--   service_role-only RPC create_placeholder_participant
--
-- Unknown date of birth uses the documented stand-in date 1900-01-01
-- (public.placeholder_date_of_birth()) when dob_is_placeholder is true and
-- no real date is supplied. Real waivers still require a real DOB.
--
-- Rollback (do not ship as a follow-up without -- waiver-guard:allow-destructive-change):
--   drop function if exists public.create_placeholder_participant(
--     text, text, text, text, text, date, boolean, text, uuid, text, uuid, date, text
--   );
--   drop function if exists public.placeholder_date_of_birth();
--   alter table public.participants
--     drop constraint if exists participants_placeholder_reason_check;
--   alter table public.participants
--     drop constraint if exists participants_dob_placeholder_reason_check;
--   drop index if exists public.idx_participants_is_placeholder;
--   drop index if exists public.idx_participants_full_name_lower_active;
--   -- drop column is forbidden on participants without the waiver-guard marker:
--   -- alter table public.participants drop column if exists is_placeholder;
--   -- alter table public.participants drop column if exists placeholder_reason;
--   -- alter table public.participants drop column if exists dob_is_placeholder;
--   -- alter table public.participants drop column if exists dob_placeholder_reason;
--   -- alter table public.participants alter column email set not null;
--     -- only after no null emails remain.

create or replace function public.placeholder_date_of_birth()
returns date
language sql
immutable
set search_path = public
as $$
  select date '1900-01-01';
$$;

comment on function public.placeholder_date_of_birth() is
  'Documented stand-in date of birth for unknown DOB. Store with dob_is_placeholder = true. Not a real birthday.';

revoke all on function public.placeholder_date_of_birth() from public;
revoke all on function public.placeholder_date_of_birth() from anon;
revoke all on function public.placeholder_date_of_birth() from authenticated;
grant execute on function public.placeholder_date_of_birth() to service_role;

alter table public.participants
  add column if not exists is_placeholder boolean not null default false;

alter table public.participants
  add column if not exists placeholder_reason text;

alter table public.participants
  add column if not exists dob_is_placeholder boolean not null default false;

alter table public.participants
  add column if not exists dob_placeholder_reason text;

alter table public.participants
  alter column email drop not null;

alter table public.participants
  drop constraint if exists participants_placeholder_reason_check;
alter table public.participants
  add constraint participants_placeholder_reason_check check (
    (is_placeholder = false and placeholder_reason is null)
    or (
      is_placeholder = true
      and placeholder_reason is not null
      and char_length(btrim(placeholder_reason)) between 1 and 500
    )
  );

alter table public.participants
  drop constraint if exists participants_dob_placeholder_reason_check;
alter table public.participants
  add constraint participants_dob_placeholder_reason_check check (
    (dob_is_placeholder = false and dob_placeholder_reason is null)
    or (
      dob_is_placeholder = true
      and dob_placeholder_reason is not null
      and char_length(btrim(dob_placeholder_reason)) between 1 and 500
    )
  );

comment on column public.participants.is_placeholder is
  'True when staff created this person by name before a signed waiver. Placeholders may book and check in.';

comment on column public.participants.placeholder_reason is
  'Required, trimmed, non-empty when is_placeholder is true. Null otherwise.';

comment on column public.participants.dob_is_placeholder is
  'True when date_of_birth is unknown or a documented stand-in (1900-01-01 via placeholder_date_of_birth()).';

comment on column public.participants.dob_placeholder_reason is
  'Required, trimmed, non-empty when dob_is_placeholder is true. Null otherwise.';

comment on column public.participants.email is
  'Contact email. Null is allowed for name-only placeholder members; waiver submit still requires email.';

create index if not exists idx_participants_is_placeholder
  on public.participants (id)
  where is_placeholder;

create index if not exists idx_participants_full_name_lower_active
  on public.participants (lower(full_name))
  where merged_into_participant_id is null;

create or replace function public.create_placeholder_participant(
  p_first_name text,
  p_last_name text,
  p_placeholder_reason text,
  p_email text default null,
  p_phone text default null,
  p_date_of_birth date default null,
  p_dob_is_placeholder boolean default false,
  p_dob_placeholder_reason text default null,
  p_account_id uuid default null,
  p_account_name text default null,
  p_plan_id uuid default null,
  p_start_date date default null,
  p_created_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_reason text := nullif(btrim(coalesce(p_placeholder_reason, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_account_name text := nullif(btrim(coalesce(p_account_name, '')), '');
  v_dob_reason text := nullif(btrim(coalesce(p_dob_placeholder_reason, '')), '');
  v_created_by text := nullif(btrim(coalesce(p_created_by, '')), '');
  v_dob_is_placeholder boolean := coalesce(p_dob_is_placeholder, false);
  v_dob date;
  v_full_name text;
  v_existing uuid;
  v_participant_id uuid;
  v_account_id uuid;
  v_subscription jsonb;
  v_enroll jsonb;
begin
  if v_first is null or char_length(v_first) < 2 or char_length(v_first) > 80 then
    raise exception 'invalid_first_name' using errcode = 'P0001';
  end if;
  if v_last is null or char_length(v_last) < 2 or char_length(v_last) > 80 then
    raise exception 'invalid_last_name' using errcode = 'P0001';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'placeholder_reason_required' using errcode = 'P0001';
  end if;
  if p_account_id is not null and v_account_name is not null then
    raise exception 'account_id_xor_account_name' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;

  if v_dob_is_placeholder then
    if v_dob_reason is null or char_length(v_dob_reason) > 500 then
      raise exception 'dob_placeholder_reason_required' using errcode = 'P0001';
    end if;
    v_dob := coalesce(p_date_of_birth, public.placeholder_date_of_birth());
  else
    if p_date_of_birth is null then
      raise exception 'date_of_birth_required' using errcode = 'P0001';
    end if;
    if p_date_of_birth = public.placeholder_date_of_birth() then
      raise exception 'dob_is_placeholder_required' using errcode = 'P0001';
    end if;
    v_dob := p_date_of_birth;
    v_dob_reason := null;
  end if;

  v_full_name := v_first || ' ' || v_last;

  select p.id
    into v_existing
  from public.participants p
  where p.merged_into_participant_id is null
    and lower(p.full_name) = lower(v_full_name)
  order by p.created_at asc
  limit 1;

  if v_existing is not null then
    raise exception 'duplicate_name'
      using errcode = 'P0001',
            detail = jsonb_build_object('existing_participant_id', v_existing)::text;
  end if;

  insert into public.participants (
    full_name,
    date_of_birth,
    email,
    cell_phone,
    is_placeholder,
    placeholder_reason,
    dob_is_placeholder,
    dob_placeholder_reason
  ) values (
    v_full_name,
    v_dob,
    v_email,
    v_phone,
    true,
    v_reason,
    v_dob_is_placeholder,
    case when v_dob_is_placeholder then v_dob_reason else null end
  )
  returning id into v_participant_id;

  if p_account_id is not null then
    select a.id
      into v_account_id
    from public.accounts a
    where a.id = p_account_id
    for update;
    if v_account_id is null then
      raise exception 'account_not_found' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.accounts a
      where a.id = v_account_id and a.status = 'active'
    ) then
      raise exception 'account_not_found' using errcode = 'P0001';
    end if;
  else
    insert into public.accounts (
      status,
      primary_contact_name,
      primary_contact_phone,
      primary_contact_email,
      notes
    ) values (
      'active',
      coalesce(v_account_name, v_full_name),
      v_phone,
      v_email,
      concat_ws(
        ' | ',
        'placeholder_participant=true',
        case when v_created_by is not null then 'created_by=' || v_created_by else null end
      )
    )
    returning id into v_account_id;
  end if;

  insert into public.account_members (account_id, participant_id, role)
  values (v_account_id, v_participant_id, 'member');

  if p_plan_id is not null then
    v_enroll := public.create_subscription(
      v_participant_id,
      p_plan_id,
      coalesce(p_start_date, current_date),
      null,
      v_account_id,
      false,
      concat_ws(
        ' | ',
        'placeholder_enrollment=true',
        case when v_created_by is not null then 'created_by=' || v_created_by else null end
      ),
      coalesce(v_created_by, 'admin_api')
    );
    v_subscription := jsonb_build_object(
      'id', v_enroll->>'subscription_id',
      'plan_id', v_enroll->>'plan_definition_id',
      'status', 'active',
      'start_date', coalesce(p_start_date, current_date)::text
    );
  end if;

  return jsonb_build_object(
    'participant', jsonb_build_object(
      'id', v_participant_id,
      'first_name', v_first,
      'last_name', v_last,
      'is_placeholder', true,
      'placeholder_reason', v_reason,
      'dob_is_placeholder', v_dob_is_placeholder
    ),
    'account_id', v_account_id,
    'subscription', v_subscription
  );
end;
$$;

comment on function public.create_placeholder_participant(
  text, text, text, text, text, date, boolean, text, uuid, text, uuid, date, text
) is
  'Atomically create a name-only placeholder participant, account (new or existing), membership, and optional enrollment via create_subscription(create_initial_charge := false). Service-role only. Raises duplicate_name when an unmerged participant already has the same full_name.';

revoke all on function public.create_placeholder_participant(
  text, text, text, text, text, date, boolean, text, uuid, text, uuid, date, text
) from public;
revoke all on function public.create_placeholder_participant(
  text, text, text, text, text, date, boolean, text, uuid, text, uuid, date, text
) from anon;
revoke all on function public.create_placeholder_participant(
  text, text, text, text, text, date, boolean, text, uuid, text, uuid, date, text
) from authenticated;
grant execute on function public.create_placeholder_participant(
  text, text, text, text, text, date, boolean, text, uuid, text, uuid, date, text
) to service_role;
