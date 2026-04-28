-- Fix waiver submission failures caused by event-capture trigger calls into
-- private.* functions under roles that lacked schema/function access.
--
-- Error observed in production:
--   permission denied for schema private
--
-- participants INSERT fires trg_event_capture_participants, which calls
-- public.capture_event_ledger_phase1() and then private.event_capture_enabled()
-- / private.append_event(...). Ensure the runtime roles can access them.

grant usage on schema private to anon;
grant usage on schema private to authenticated;
grant usage on schema private to service_role;

grant execute on function private.is_admin() to service_role;
grant execute on function private.event_capture_enabled(text) to service_role;
grant execute on function private.append_event(
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb
) to service_role;
