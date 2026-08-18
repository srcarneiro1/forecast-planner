export type Depositor = {
  nome: string; escala: '5x2'|'4x3'; jornada: 'SEG a SEX'|'DOM a QUA'|'QUA a SÁB';
  horas_trabalhadas_dia:number; capacidade_checkout_dia:number; pessoas_por_checkout:number;
  pessoas_separando:number; pessoas_embalando:number; pessoas_embalagem_caixa:number; pessoas_roteirizando:number; pessoas_ressuprindo:number;
  checkouts_atuais:number; checkouts_maximos:number; checkouts_minimos_dia_util:number; checkouts_maximos_fim_semana:number;
  hc_maximo:number; turnos_maximos:number; tipo_colmeia:'Fixa'|'Móvel'|'Não se aplica';
  dimensionamento_apoios:'Fixo por turno'|'Por checkout'; horas_extra_max_dia_util:number;
  horas_operacao_extra_sabado:number; horas_operacao_extra_dom_feriado:number;
}

export type Tariffs={diaUtil:number;sabado:number;domingoFeriado:number;noturno:number}
export type ForecastRow={data:string;forecast:number;mediaSkuPedido?:number}
export type Decision='accepted'|'rejected'
export type Decisions=Record<string,Decision>
export type DecisionStatus='base'|'pending'|'accepted'|'rejected'

export type DayResult=ForecastRow&{
  tipoDia:string; dentroEscala:boolean; backlogAnterior:number; producaoNecessaria:number;
  capacidadeBase:number; checkoutsBase:number;
  acaoSugerida:string; acaoAplicada:string; decisao:DecisionStatus;
  checkouts:number; capacidade:number; producao:number; backlogFinal:number;
  hcCheckout:number; hcApoio:number; hcTotal:number;
  horasBase:number; horasAdicionais:number; turnos:number;
  tarifaAplicada:number; custoAcao:number;
}

const zeroTariffs:Tariffs={diaUtil:0,sabado:0,domingoFeriado:0,noturno:0}
const dow=(d:string)=>new Date(`${d}T12:00:00`).getDay()

export function isScheduled(d:string,p:Depositor,holidays:Set<string>){
  if(holidays.has(d)) return false
  const w=dow(d)
  if(p.jornada==='SEG a SEX') return w>=1&&w<=5
  if(p.jornada==='DOM a QUA') return [0,1,2,3].includes(w)
  return [3,4,5,6].includes(w)
}

export function dayType(d:string,holidays:Set<string>){
  if(holidays.has(d)) return 'Feriado'
  const w=dow(d)
  return w===0?'Domingo':w===6?'Sábado':'Dia útil'
}

function supportHC(p:Depositor,checkouts:number){
  const res=p.tipo_colmeia==='Móvel'?0:p.pessoas_ressuprindo
  const supports=p.pessoas_separando+p.pessoas_embalando+p.pessoas_embalagem_caixa+p.pessoas_roteirizando+res
  return p.dimensionamento_apoios==='Por checkout'?supports*checkouts:supports
}
function checkoutHC(p:Depositor,checkouts:number){ return checkouts*p.pessoas_por_checkout }
function totalHC(p:Depositor,checkouts:number){ return Math.min(p.hc_maximo,checkoutHC(p,checkouts)+supportHC(p,checkouts)) }

function maxCheckoutsByHC(p:Depositor){
  if(p.pessoas_por_checkout<=0 && p.dimensionamento_apoios!=='Por checkout') return p.checkouts_maximos
  if(p.dimensionamento_apoios==='Por checkout'){
    const res=p.tipo_colmeia==='Móvel'?0:p.pessoas_ressuprindo
    const per=p.pessoas_por_checkout+p.pessoas_separando+p.pessoas_embalando+p.pessoas_embalagem_caixa+p.pessoas_roteirizando+res
    return per>0?Math.max(0,Math.floor(p.hc_maximo/per)):p.checkouts_maximos
  }
  const fixed=supportHC(p,1)
  return p.pessoas_por_checkout>0?Math.max(0,Math.floor((p.hc_maximo-fixed)/p.pessoas_por_checkout)):p.checkouts_maximos
}
function clampCheckouts(p:Depositor,wanted:number,configuredMax:number){ return Math.max(0,Math.min(wanted,configuredMax,maxCheckoutsByHC(p))) }

function baseScenario(need:number,scheduled:boolean,tipo:string,p:Depositor){
  if(need<=0) return {checkouts:0,capacity:0,turns:1,extraHours:0,action:'Base / sem ação'}
  if(!scheduled) return {checkouts:0,capacity:0,turns:1,extraHours:0,action:'Base / sem operação'}
  const min=tipo==='Dia útil'?p.checkouts_minimos_dia_util:1
  const wanted=Math.max(min,Math.ceil(need/Math.max(p.capacidade_checkout_dia,1)))
  const checkouts=clampCheckouts(p,wanted,p.checkouts_maximos)
  return {checkouts,capacity:checkouts*p.capacidade_checkout_dia,turns:1,extraHours:0,action:'Base / sem ação'}
}

function suggestedScenario(need:number,scheduled:boolean,tipo:string,p:Depositor,base:{checkouts:number;capacity:number;turns:number;extraHours:number;action:string}){
  if(!scheduled){
    if(need<=0) return {...base,suggested:false}
    const weekend=tipo!=='Dia útil'
    const maxConfigured=weekend?p.checkouts_maximos_fim_semana:p.checkouts_maximos
    const hours=tipo==='Sábado'?p.horas_operacao_extra_sabado:tipo==='Domingo'||tipo==='Feriado'?p.horas_operacao_extra_dom_feriado:p.horas_trabalhadas_dia
    const capPer=(p.capacidade_checkout_dia/Math.max(p.horas_trabalhadas_dia,1))*hours
    const wanted=Math.max(1,Math.ceil(need/Math.max(capPer,1)))
    const checkouts=clampCheckouts(p,wanted,maxConfigured)
    const action=weekend?'Operar no fim de semana / feriado':'Operar fora da escala'
    return {checkouts,capacity:checkouts*capPer,turns:1,extraHours:hours,action,suggested:true}
  }
  if(need<=base.capacity) return {...base,suggested:false}
  if(tipo==='Dia útil'&&p.horas_extra_max_dia_util>0){
    const hours=p.horas_trabalhadas_dia+p.horas_extra_max_dia_util
    const capPer=(p.capacidade_checkout_dia/Math.max(p.horas_trabalhadas_dia,1))*hours
    const wanted=Math.max(p.checkouts_minimos_dia_util,Math.ceil(need/Math.max(capPer,1)))
    const checkouts=clampCheckouts(p,wanted,p.checkouts_maximos)
    return {checkouts,capacity:checkouts*capPer,turns:1,extraHours:p.horas_extra_max_dia_util,action:`Atuar com Mão de Obra terceira + ${p.horas_extra_max_dia_util}hrs`,suggested:true}
  }
  return {...base,suggested:false}
}

function tariffFor(action:string,tipo:string,t:Tariffs){
  if(action.startsWith('Atuar com Mão de Obra terceira +')||action==='Operar fora da escala') return t.diaUtil
  if(action==='Operar no fim de semana / feriado') return tipo==='Sábado'?t.sabado:t.domingoFeriado
  return 0
}

export function simulate(rows:ForecastRow[],p:Depositor,holidays=new Set<string>(),decisions:Decisions={},tariffs:Tariffs=zeroTariffs):DayResult[]{
  let backlog=0
  return [...rows].sort((a,b)=>a.data.localeCompare(b.data)).map(r=>{
    const scheduled=isScheduled(r.data,p,holidays)
    const tipo=dayType(r.data,holidays)
    const need=r.forecast+backlog
    const base=baseScenario(need,scheduled,tipo,p)
    const suggested=suggestedScenario(need,scheduled,tipo,p,base)
    const decision=decisions[r.data]
    const hasSuggestion=suggested.suggested===true
    const rejected=hasSuggestion&&decision==='rejected'
    const applied=rejected?base:suggested
    const decisao:DecisionStatus=!hasSuggestion?'base':decision==='accepted'?'accepted':decision==='rejected'?'rejected':'pending'
    const production=Math.min(need,applied.capacity)
    const final=Math.max(0,need-production)
    const hcCheckout=checkoutHC(p,applied.checkouts)
    const hcApoio=supportHC(p,applied.checkouts)
    const hcTotal=totalHC(p,applied.checkouts)
    const tarifaAplicada=tariffFor(applied.action,tipo,tariffs)
    const custoAcao=applied.action.startsWith('Base /')?0:hcTotal*applied.extraHours*tarifaAplicada
    const result:DayResult={
      ...r,tipoDia:tipo,dentroEscala:scheduled,backlogAnterior:Math.round(backlog),producaoNecessaria:Math.round(need),
      capacidadeBase:Math.round(base.capacity),checkoutsBase:base.checkouts,acaoSugerida:hasSuggestion?suggested.action:'Base / sem ação',
      acaoAplicada:applied.action,decisao,checkouts:applied.checkouts,capacidade:Math.round(applied.capacity),producao:Math.round(production),
      backlogFinal:Math.round(final),hcCheckout,hcApoio,hcTotal,horasBase:scheduled?p.horas_trabalhadas_dia:0,
      horasAdicionais:applied.extraHours,turnos:1,tarifaAplicada,custoAcao:Math.round(custoAcao*100)/100,
    }
    backlog=final
    return result
  })
}
