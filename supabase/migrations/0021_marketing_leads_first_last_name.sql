-- Split marketing_leads.name into required first_name and last_name.

alter table public.marketing_leads
  add column if not exists first_name text,
  add column if not exists last_name text;

update public.marketing_leads
set
  first_name = coalesce(
    nullif(trim(split_part(trim(name), ' ', 1)), ''),
    'Unknown'
  ),
  last_name = case
    when position(' ' in trim(name)) > 0 then
      coalesce(nullif(trim(substring(trim(name) from position(' ' in trim(name)) + 1)), ''), 'Unknown')
    else
      'Unknown'
  end
where first_name is null
   or last_name is null;

alter table public.marketing_leads
  alter column first_name set not null,
  alter column last_name set not null;

alter table public.marketing_leads
  drop column if exists name;

comment on column public.marketing_leads.first_name is 'Lead given name from marketing contact form.';
comment on column public.marketing_leads.last_name is 'Lead family name from marketing contact form.';
