revoke truncate, references, trigger on table
  public.profiles,
  public.depositantes,
  public.tarifas,
  public.feriados,
  public.acoes_operacionais,
  public.simulacoes,
  public.simulacoes_diarias
from authenticated;

revoke insert, update, delete on table public.profiles from authenticated;
