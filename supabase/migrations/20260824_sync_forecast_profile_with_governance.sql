create or replace function public.set_forecast_admin_role(p_target_id uuid, p_make_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_previous_role text;
  v_target_exists boolean;
begin
  if not (select private.is_forecast_owner()) then
    raise exception 'OWNER_REQUIRED';
  end if;

  select email::text into v_actor_email from auth.users where id = (select auth.uid());
  select exists(select 1 from public.profiles where id = p_target_id) into v_target_exists;
  if not v_target_exists then
    raise exception 'TARGET_NOT_FOUND';
  end if;

  select governance_role into v_previous_role
  from public.app_governance
  where user_id = p_target_id;

  if v_previous_role = 'OWNER' then
    raise exception 'OWNER_IMMUTABLE';
  end if;

  if p_make_admin then
    insert into public.app_governance(user_id, governance_role, created_by, updated_at)
    values (p_target_id, 'ADMIN', (select auth.uid()), now())
    on conflict (user_id) do update
      set governance_role = 'ADMIN', updated_at = now();
    update public.profiles set perfil='admin', updated_at=now() where id=p_target_id;
  else
    delete from public.app_governance
    where user_id = p_target_id and governance_role = 'ADMIN';
    update public.profiles set perfil='usuario', updated_at=now() where id=p_target_id;
  end if;

  insert into public.access_governance_audit(
    actor_id, actor_email, target_id, action, previous_role, new_role
  ) values (
    (select auth.uid()),
    v_actor_email,
    p_target_id,
    case when p_make_admin then 'GRANT_ADMIN' else 'REVOKE_ADMIN' end,
    coalesce(v_previous_role,'USER'),
    case when p_make_admin then 'ADMIN' else 'USER' end
  );
end;
$$;

revoke all on function public.set_forecast_admin_role(uuid, boolean) from public, anon;
grant execute on function public.set_forecast_admin_role(uuid, boolean) to authenticated;
