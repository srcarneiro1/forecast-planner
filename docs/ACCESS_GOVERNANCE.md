# Governança de acesso — Forecast Planner

## Papéis

A governança é separada do campo legado `profiles.perfil`.

- `OWNER`: autoridade máxima e única. Não pode ser rebaixado ou removido por outro usuário.
- `ADMIN`: papel delegado pelo Owner. Pode operar recursos administrativos do Forecast, mas não gerencia a governança.
- `USER`: usuário autorizado sem privilégios administrativos.

A fonte de verdade é `public.app_governance`. O campo `profiles.perfil` permanece apenas para compatibilidade com a UI existente e é sincronizado pela RPC owner-only ao conceder ou revogar Admin.

## Owner

O Owner é provisionado por identidade de conta no Supabase durante a migration, sem depender do nome exibido. O índice parcial `app_governance_single_owner_idx` garante apenas um Owner.

## Administração delegada

Somente o Owner pode executar `public.set_forecast_admin_role`. A função:

- bloqueia alteração do Owner;
- concede/remove `ADMIN` em `app_governance`;
- sincroniza o campo legado `profiles.perfil` para manter a UI compatível;
- grava `GRANT_ADMIN` ou `REVOKE_ADMIN` em `access_governance_audit`.

As policies administrativas existentes continuam chamando `private.is_forecast_admin()`, mas essa função agora consulta `app_governance` + `profiles.ativo`.

## Interface

`ForecastAccessGovernance` é montado como módulo independente para não aumentar a dívida do `App.tsx` monolítico. Para o Owner, ele adiciona `Acessos` à navegação lateral e abre um diálogo para promover/revogar administradores.

O cadastro público antigo fica oculto no login. A segurança não depende dessa ocultação: signup deve permanecer desabilitado no Supabase Auth, e novos profiles continuam inativos por padrão.

## MFA

Este bloco não exige AAL2 ainda. MFA/TOTP será implementado e validado antes de alterar as policies administrativas para exigir `aal2`, evitando lockout do Owner.
