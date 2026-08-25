create or replace function private.is_forecast_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from public.app_governance g
      join public.profiles p on p.id = g.user_id
      where g.user_id = (select auth.uid())
        and g.governance_role = 'OWNER'
        and p.ativo = true
    );
$function$;

create or replace function private.is_forecast_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from public.app_governance g
      join public.profiles p on p.id = g.user_id
      where g.user_id = (select auth.uid())
        and g.governance_role in ('OWNER','ADMIN')
        and p.ativo = true
    );
$function$;
