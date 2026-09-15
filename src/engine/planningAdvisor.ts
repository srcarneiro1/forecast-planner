import { simulate, type DayResult, type Decisions, type Depositor, type ForecastRow, type Tariffs } from './simulation'

export type RecommendationKind='weekend'|'holiday'|'overtime'|'checkout'|'other'

export type PlanningRecommendation={
  data:string
  tipoDia:string
  kind:RecommendationKind
  action:string
  necessidade:number
  capacidade:number
  producao:number
  backlogFinal:number
  custo:number
  rationale:string
}

export type PlanningSummary={
  totalForecast:number
  peakForecast:number
  peakDate:string
  baseFinalBacklog:number
  basePeakBacklog:number
  projectedFinalBacklog:number
  projectedPeakBacklog:number
  projectedCost:number
  recommendationCount:number
  weekendCount:number
  holidayCount:number
  overtimeCount:number
}

function actionKind(day:DayResult):RecommendationKind{
  if(day.tipoDia==='Feriado')return'holiday'
  if(day.tipoDia==='Sábado'||day.tipoDia==='Domingo')return'weekend'
  if(day.acaoSugerida.startsWith('Atuar com +'))return'overtime'
  if(day.acaoSugerida==='Aumentar checkouts')return'checkout'
  return'other'
}

function rejectAllSuggested(rows:ForecastRow[],p:Depositor,holidays:Set<string>,tariffs:Tariffs){
  const decisions:Decisions={}
  let result:DayResult[]=[]
  for(let pass=0;pass<20;pass+=1){
    result=simulate(rows,p,holidays,decisions,tariffs)
    const pending=result.filter(day=>day.decisao==='pending'&&decisions[day.data]!=='rejected')
    if(!pending.length)break
    pending.forEach(day=>{decisions[day.data]='rejected'})
  }
  return result
}

function rationale(day:DayResult){
  const need=Math.round(day.producaoNecessaria).toLocaleString('pt-BR')
  const capacity=Math.round(day.capacidade).toLocaleString('pt-BR')
  const backlog=Math.round(day.backlogFinal).toLocaleString('pt-BR')
  if(day.tipoDia==='Sábado')return`Abrir sábado para absorver ${need} pedidos; capacidade projetada ${capacity} e backlog após o dia ${backlog}.`
  if(day.tipoDia==='Domingo')return`Abrir domingo para evitar carregar ${need} pedidos para a semana seguinte; backlog projetado após o dia ${backlog}.`
  if(day.tipoDia==='Feriado')return`Operação extraordinária no feriado para absorver ${need} pedidos e reduzir pressão nos dias seguintes.`
  if(day.acaoSugerida.startsWith('Atuar com +'))return`A capacidade-base não absorve ${need} pedidos. A extensão de jornada eleva a capacidade projetada para ${capacity}.`
  if(day.acaoSugerida==='Aumentar checkouts')return`A demanda de ${need} pedidos supera a configuração-base, mas cabe no limite cadastrado com aumento de checkouts.`
  return`Ação sugerida para atender ${need} pedidos com backlog projetado de ${backlog}.`
}

export function buildPlanningAdvice(rows:ForecastRow[],p:Depositor,holidays=new Set<string>(),tariffs:Tariffs,decisions:Decisions={}){
  const projected=simulate(rows,p,holidays,decisions,tariffs)
  const base=rejectAllSuggested(rows,p,holidays,tariffs)
  const recommendations:PlanningRecommendation[]=projected
    .filter(day=>day.decisao==='pending')
    .map(day=>({
      data:day.data,
      tipoDia:day.tipoDia,
      kind:actionKind(day),
      action:day.acaoSugerida,
      necessidade:day.producaoNecessaria,
      capacidade:day.capacidade,
      producao:day.producao,
      backlogFinal:day.backlogFinal,
      custo:day.custoAcao,
      rationale:rationale(day),
    }))

  const peak=projected.length?projected.reduce((best,day)=>day.forecast>best.forecast?day:best):null
  const summary:PlanningSummary={
    totalForecast:projected.reduce((sum,day)=>sum+day.forecast,0),
    peakForecast:peak?.forecast??0,
    peakDate:peak?.data??'',
    baseFinalBacklog:base.at(-1)?.backlogFinal??0,
    basePeakBacklog:base.reduce((max,day)=>Math.max(max,day.backlogFinal),0),
    projectedFinalBacklog:projected.at(-1)?.backlogFinal??0,
    projectedPeakBacklog:projected.reduce((max,day)=>Math.max(max,day.backlogFinal),0),
    projectedCost:projected.reduce((sum,day)=>sum+day.custoAcao,0),
    recommendationCount:recommendations.length,
    weekendCount:recommendations.filter(item=>item.kind==='weekend').length,
    holidayCount:recommendations.filter(item=>item.kind==='holiday').length,
    overtimeCount:recommendations.filter(item=>item.kind==='overtime').length,
  }

  return{days:projected,baseDays:base,recommendations,summary}
}
