# Forecast Planner — Segurança de acesso

## Princípio

Autenticação e autorização são controles distintos. Uma sessão Supabase válida identifica o usuário, mas não concede acesso ao Forecast Planner por si só.

## Modelo de acesso

- O frontend usa apenas URL + publishable key do Supabase. Chaves secret/service-role nunca podem ser publicadas no cliente.
- Toda tabela de aplicação em `public` deve ter RLS habilitado.
- `anon` não recebe privilégios de tabela da aplicação.
- Usuários autenticados precisam de `public.profiles.ativo = true` para ler dados mestres ou seus planejamentos.
- Novos usuários de Auth nascem com `perfil = 'usuario'` e `ativo = false`.
- O cliente não pode inserir, atualizar ou promover o próprio profile.
- Escritas administrativas exigem simultaneamente `ativo = true` e `perfil = 'admin'`.
- Simulações e linhas diárias continuam owner-only e exigem profile ativo.
- `TRUNCATE`, `REFERENCES` e `TRIGGER` não são concedidos aos roles de aplicação.
- Novos objetos criados por migrations do papel `postgres` seguem deny-by-default; grants precisam ser explícitos e acompanhados da RLS correspondente.

## Configuração obrigatória no Supabase Auth

No projeto de produção:

1. Desabilitar criação pública de novos usuários (`Allow new users to sign up`).
2. Manter apenas os providers de autenticação realmente utilizados.
3. Configurar senha forte (mínimo recomendado: 12 caracteres).
4. Ativar proteção contra senhas vazadas quando o plano permitir.
5. Revisar Site URL e Redirect URLs; não permitir curingas/desenvolvimento em produção sem necessidade.
6. Próxima camada: MFA/TOTP e enforcement de AAL2, inicialmente para administradores.

## Provisionamento

Novos acessos devem ser criados/provisionados administrativamente. Criar uma conta em `auth.users` não é suficiente: o profile precisa ser explicitamente ativado e receber o perfil correto por uma operação administrativa confiável.

## Regra de desenvolvimento

Nunca criar uma policy `TO authenticated USING (true)` para dados internos apenas porque a tela possui login. A autorização deve representar o vínculo real do usuário com a aplicação.
