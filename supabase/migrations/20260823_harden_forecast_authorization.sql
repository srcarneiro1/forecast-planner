create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter table public.profiles
  add column if not exists ativo boolean not null default false;

-- Usuários provisionados antes deste hardening já eram os usuários autorizados do app.
update public.profiles set ativo = true;

create or replace function private.is_forecast_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.ativo = true
  );
$$;

create or replace function private.is_forecast_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.ativo = true
      and p.perfil = 'admin'
  );
$$;

revoke all on function private.is_forecast_active_user() from public, anon;
revoke all on function private.is_forecast_admin() from public, anon;
grant execute on function private.is_forecast_active_user() to authenticated;
grant execute on function private.is_forecast_admin() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nome, perfil, ativo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(coalesce(new.email,''), '@', 1)),
    'usuario',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- O cliente não pode provisionar ou promover o próprio perfil.
drop policy if exists profiles_insert_own on public.profiles;
revoke insert, update, delete on table public.profiles from authenticated;
revoke all on table public.profiles from anon;
grant select on table public.profiles to authenticated;

-- Dados mestres: autenticação isolada não concede acesso; é necessário perfil ativo.
drop policy if exists depositantes_read_authenticated on public.depositantes;
create policy depositantes_read_active_user
  on public.depositantes for select to authenticated
  using ((select private.is_forecast_active_user()));

drop policy if exists tarifas_read_authenticated on public.tarifas;
create policy tarifas_read_active_user
  on public.tarifas for select to authenticated
  using ((select private.is_forecast_active_user()));

drop policy if exists feriados_read_authenticated on public.feriados;
create policy feriados_read_active_user
  on public.feriados for select to authenticated
  using ((select private.is_forecast_active_user()));

drop policy if exists acoes_read_authenticated on public.acoes_operacionais;
create policy acoes_read_active_user
  on public.acoes_operacionais for select to authenticated
  using ((select private.is_forecast_active_user()));

-- Escritas administrativas exigem perfil ativo e admin.
drop policy if exists depositantes_admin_insert on public.depositantes;
drop policy if exists depositantes_admin_update on public.depositantes;
drop policy if exists depositantes_admin_delete on public.depositantes;
create policy depositantes_admin_insert on public.depositantes for insert to authenticated with check ((select private.is_forecast_admin()));
create policy depositantes_admin_update on public.depositantes for update to authenticated using ((select private.is_forecast_admin())) with check ((select private.is_forecast_admin()));
create policy depositantes_admin_delete on public.depositantes for delete to authenticated using ((select private.is_forecast_admin()));

drop policy if exists tarifas_admin_insert on public.tarifas;
drop policy if exists tarifas_admin_update on public.tarifas;
drop policy if exists tarifas_admin_delete on public.tarifas;
create policy tarifas_admin_insert on public.tarifas for insert to authenticated with check ((select private.is_forecast_admin()));
create policy tarifas_admin_update on public.tarifas for update to authenticated using ((select private.is_forecast_admin())) with check ((select private.is_forecast_admin()));
create policy tarifas_admin_delete on public.tarifas for delete to authenticated using ((select private.is_forecast_admin()));

drop policy if exists feriados_admin_insert on public.feriados;
drop policy if exists feriados_admin_update on public.feriados;
drop policy if exists feriados_admin_delete on public.feriados;
create policy feriados_admin_insert on public.feriados for insert to authenticated with check ((select private.is_forecast_admin()));
create policy feriados_admin_update on public.feriados for update to authenticated using ((select private.is_forecast_admin())) with check ((select private.is_forecast_admin()));
create policy feriados_admin_delete on public.feriados for delete to authenticated using ((select private.is_forecast_admin()));

drop policy if exists acoes_admin_insert on public.acoes_operacionais;
drop policy if exists acoes_admin_update on public.acoes_operacionais;
drop policy if exists acoes_admin_delete on public.acoes_operacionais;
create policy acoes_admin_insert on public.acoes_operacionais for insert to authenticated with check ((select private.is_forecast_admin()));
create policy acoes_admin_update on public.acoes_operacionais for update to authenticated using ((select private.is_forecast_admin())) with check ((select private.is_forecast_admin()));
create policy acoes_admin_delete on public.acoes_operacionais for delete to authenticated using ((select private.is_forecast_admin()));

-- Dados de planejamento continuam owner-only e passam a exigir perfil ativo.
drop policy if exists simulacoes_select_own on public.simulacoes;
drop policy if exists simulacoes_insert_own on public.simulacoes;
drop policy if exists simulacoes_update_own on public.simulacoes;
drop policy if exists simulacoes_delete_own on public.simulacoes;
create policy simulacoes_select_own on public.simulacoes for select to authenticated using ((select private.is_forecast_active_user()) and (select auth.uid()) = usuario_id);
create policy simulacoes_insert_own on public.simulacoes for insert to authenticated with check ((select private.is_forecast_active_user()) and (select auth.uid()) = usuario_id);
create policy simulacoes_update_own on public.simulacoes for update to authenticated using ((select private.is_forecast_active_user()) and (select auth.uid()) = usuario_id) with check ((select private.is_forecast_active_user()) and (select auth.uid()) = usuario_id);
create policy simulacoes_delete_own on public.simulacoes for delete to authenticated using ((select private.is_forecast_active_user()) and (select auth.uid()) = usuario_id);

drop policy if exists simulacoes_diarias_select_own on public.simulacoes_diarias;
drop policy if exists simulacoes_diarias_insert_own on public.simulacoes_diarias;
drop policy if exists simulacoes_diarias_update_own on public.simulacoes_diarias;
drop policy if exists simulacoes_diarias_delete_own on public.simulacoes_diarias;
create policy simulacoes_diarias_select_own on public.simulacoes_diarias for select to authenticated using ((select private.is_forecast_active_user()) and exists (select 1 from public.simulacoes s where s.id = simulacoes_diarias.simulacao_id and s.usuario_id = (select auth.uid())));
create policy simulacoes_diarias_insert_own on public.simulacoes_diarias for insert to authenticated with check ((select private.is_forecast_active_user()) and exists (select 1 from public.simulacoes s where s.id = simulacoes_diarias.simulacao_id and s.usuario_id = (select auth.uid())));
create policy simulacoes_diarias_update_own on public.simulacoes_diarias for update to authenticated using ((select private.is_forecast_active_user()) and exists (select 1 from public.simulacoes s where s.id = simulacoes_diarias.simulacao_id and s.usuario_id = (select auth.uid()))) with check ((select private.is_forecast_active_user()) and exists (select 1 from public.simulacoes s where s.id = simulacoes_diarias.simulacao_id and s.usuario_id = (select auth.uid())));
create policy simulacoes_diarias_delete_own on public.simulacoes_diarias for delete to authenticated using ((select private.is_forecast_active_user()) and exists (select 1 from public.simulacoes s where s.id = simulacoes_diarias.simulacao_id and s.usuario_id = (select auth.uid())));

revoke all on table public.depositantes, public.tarifas, public.feriados, public.acoes_operacionais, public.simulacoes, public.simulacoes_diarias from anon;
