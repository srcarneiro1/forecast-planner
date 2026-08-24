alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email::text
from auth.users u
where u.id = p.id
  and (p.email is null or p.email is distinct from u.email::text);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nome, perfil, ativo, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(coalesce(new.email,''), '@', 1)),
    'usuario',
    false,
    new.email
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_self_or_owner
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id or (select private.is_forecast_owner()));

grant update(perfil) on public.profiles to authenticated;

drop policy if exists profiles_owner_update_admin_compat on public.profiles;
create policy profiles_owner_update_admin_compat
  on public.profiles for update to authenticated
  using (
    (select private.is_forecast_owner())
    and not exists (
      select 1 from public.app_governance g
      where g.user_id = profiles.id and g.governance_role = 'OWNER'
    )
  )
  with check (
    (select private.is_forecast_owner())
    and perfil in ('admin','usuario')
    and not exists (
      select 1 from public.app_governance g
      where g.user_id = profiles.id and g.governance_role = 'OWNER'
    )
  );

grant insert, update, delete on public.app_governance to authenticated;

drop policy if exists app_governance_owner_insert_admin on public.app_governance;
create policy app_governance_owner_insert_admin
  on public.app_governance for insert to authenticated
  with check (
    (select private.is_forecast_owner())
    and governance_role = 'ADMIN'
    and user_id <> (select auth.uid())
  );

drop policy if exists app_governance_owner_update_admin on public.app_governance;
create policy app_governance_owner_update_admin
  on public.app_governance for update to authenticated
  using ((select private.is_forecast_owner()) and governance_role = 'ADMIN')
  with check ((select private.is_forecast_owner()) and governance_role = 'ADMIN');

drop policy if exists app_governance_owner_delete_admin on public.app_governance;
create policy app_governance_owner_delete_admin
  on public.app_governance for delete to authenticated
  using ((select private.is_forecast_owner()) and governance_role = 'ADMIN');

grant insert on public.access_governance_audit to authenticated;

drop policy if exists access_governance_audit_owner_insert on public.access_governance_audit;
create policy access_governance_audit_owner_insert
  on public.access_governance_audit for insert to authenticated
  with check ((select private.is_forecast_owner()) and actor_id = (select auth.uid()));

create or replace function public.list_forecast_access_users()
returns table (
  user_id uuid,
  email text,
  nome text,
  ativo boolean,
  perfil_funcional text,
  governance_role text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.email,
    p.nome,
    p.ativo,
    p.perfil,
    coalesce(g.governance_role, 'USER')
  from public.profiles p
  left join public.app_governance g on g.user_id = p.id
  where (select private.is_forecast_owner())
  order by case coalesce(g.governance_role,'USER') when 'OWNER' then 0 when 'ADMIN' then 1 else 2 end, p.nome;
$$;

revoke all on function public.list_forecast_access_users() from public, anon;
grant execute on function public.list_forecast_access_users() to authenticated;

create or replace function public.set_forecast_admin_role(p_target_id uuid, p_make_admin boolean)
returns void
language plpgsql
security invoker
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

  v_actor_email := coalesce(auth.jwt() ->> 'email', '');

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

    update public.profiles
    set perfil = 'admin'
    where id = p_target_id;
  else
    delete from public.app_governance
    where user_id = p_target_id and governance_role = 'ADMIN';

    update public.profiles
    set perfil = 'usuario'
    where id = p_target_id;
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