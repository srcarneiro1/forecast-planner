-- New application objects created by our postgres migrations must not become
-- accessible to anon/authenticated automatically. Grants are explicit and paired
-- with the intended RLS/policies.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
