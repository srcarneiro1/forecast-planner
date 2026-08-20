import { dayType, isScheduled, type Depositor, type ForecastRow } from './simulation'

export type ScenarioStatus='Atende'|'Reforço dentro do limite'|'Expansão estrutural'|'Não opera no cenário'|'Sem demanda'
export type ScenarioOperatingDays={sabado:boolean;domingo:boolean;feriado:boolean}

export type ScenarioDay=ForecastRow&{
  tipoDia:string
  dentroEscala:boolean
  operacaoPlanejada:boolean
  backlogAsIsAnterior:number
  necessidadeAsIs:number
  capacidadeAtual:number
  producaoAsIs:number
  backlogAsIs:number
  utilizacaoAtual:number|null
  checkoutsAtuais:number
  backlogToBeAnterior:number
  necessidadeToBe:number
  checkoutsNecessarios:number
  gapCheckouts:number
  capacidadeNecessaria:number
  gapCapacidade:number
  producaoToBe:number
  backlogToBe:number
  hcAtual:number
  hcNecessario:number
  gapHC:number
  limiteCheckouts:number
  acimaLimiteConfigurado:boolean
  status:ScenarioStatus
}

export type ScenarioSummary={
  currentCheckouts:number
  currentCapacity:number
  currentHC:number
  peakForecast:number
  peakDate:string
  requiredCheckouts:number
  requiredCapacity:number
  requiredHC:number
  gapCheckouts:number
  gapCapacity:number
  gapHC:number
  configuredLimitAtPeak:number
  daysAboveCurrent:number
  daysWithoutOperation:number
  daysAboveConfiguredLimit:number
  maxUtilization:number
  finalBacklogAsIs:number
  peakBacklogAsIs:number
  finalBacklogToBe:number
  peakBacklogToBe:number
}

function supportHC(p:Depositor,checkouts:number){
  if(checkouts<=0)return 0
  const replenishment=p.tipo_colmeia==='Móvel'?0:p.pessoas_ressuprindo
  const supports=p.pessoas_separando+p.pessoas_embalando+p.pessoas_embalagem_caixa+p.pessoas_roteirizando+replenishment
  return p.dimensionamento_apoios==='Por checkout'?supports*checkouts:supports
}

function checkoutHC(p:Depositor,checkouts:number){
  return Math.max(0,checkouts)*Math.max(0,p.pessoas_por_checkout)
}

function totalHC(p:Depositor,checkouts:number){
  return checkoutHC(p,checkouts)+supportHC(p,checkouts)
}

function configuredLimit(tipo:string,p:Depositor){
  return tipo==='Sábado'||tipo==='Domingo'||tipo==='Feriado'?p.checkouts_maximos_fim_semana:p.checkouts_maximos
}

function shouldOperate(data:string,tipo:string,p:Depositor,holidays:Set<string>,operatingDays:ScenarioOperatingDays){
  if(tipo==='Feriado')return operatingDays.feriado
  if(tipo==='Sábado')return operatingDays.sabado
  if(tipo==='Domingo')return operatingDays.domingo
  return isScheduled(data,p,holidays)
}

export function defaultScenarioOperatingDays(p:Depositor):ScenarioOperatingDays{
  const active=p.jornadas_ativas?.length?p.jornadas_ativas:[p.jornada]
  return{
    sabado:active.includes('QUA a SÁB'),
    domingo:active.includes('DOM a QUA'),
    feriado:false,
  }
}

export function analyzeScenario(rows:ForecastRow[],p:Depositor,holidays=new Set<string>(),operatingDays:ScenarioOperatingDays=defaultScenarioOperatingDays(p)){
  const capPerCheckout=Math.max(0,p.capacidade_checkout_dia)
  const currentCheckouts=Math.max(0,p.checkouts_atuais)
  const structuralCurrentCapacity=currentCheckouts*capPerCheckout
  const structuralCurrentHC=totalHC(p,currentCheckouts)
  let backlogAsIs=0
  let backlogToBe=0

  const days:ScenarioDay[]=[...rows]
    .sort((a,b)=>a.data.localeCompare(b.data))
    .map(row=>{
      const tipo=dayType(row.data,holidays)
      const scheduled=isScheduled(row.data,p,holidays)
      const operation=shouldOperate(row.data,tipo,p,holidays,operatingDays)
      const forecast=Math.max(0,row.forecast)
      const backlogAsIsAnterior=backlogAsIs
      const necessidadeAsIs=forecast+backlogAsIsAnterior
      const dailyCurrentCapacity=operation?structuralCurrentCapacity:0
      const producaoAsIs=Math.min(necessidadeAsIs,dailyCurrentCapacity)
      backlogAsIs=Math.max(0,necessidadeAsIs-producaoAsIs)

      const backlogToBeAnterior=backlogToBe
      const necessidadeToBe=forecast+backlogToBeAnterior
      const required=operation&&necessidadeToBe>0&&capPerCheckout>0?Math.ceil(necessidadeToBe/capPerCheckout):0
      const requiredCapacity=required*capPerCheckout
      const producaoToBe=operation?Math.min(necessidadeToBe,requiredCapacity):0
      backlogToBe=Math.max(0,necessidadeToBe-producaoToBe)
      const requiredHC=totalHC(p,required)
      const limit=Math.max(0,configuredLimit(tipo,p))
      const aboveCurrent=required>currentCheckouts
      const aboveLimit=required>limit
      const hasNeed=necessidadeToBe>0
      const status:ScenarioStatus=!hasNeed?'Sem demanda':!operation?'Não opera no cenário':!aboveCurrent?'Atende':aboveLimit?'Expansão estrutural':'Reforço dentro do limite'

      return{
        ...row,
        forecast,
        tipoDia:tipo,
        dentroEscala:scheduled,
        operacaoPlanejada:operation,
        backlogAsIsAnterior:Math.round(backlogAsIsAnterior),
        necessidadeAsIs:Math.round(necessidadeAsIs),
        capacidadeAtual:Math.round(dailyCurrentCapacity),
        producaoAsIs:Math.round(producaoAsIs),
        backlogAsIs:Math.round(backlogAsIs),
        utilizacaoAtual:dailyCurrentCapacity>0?necessidadeAsIs/dailyCurrentCapacity*100:null,
        checkoutsAtuais:operation?currentCheckouts:0,
        backlogToBeAnterior:Math.round(backlogToBeAnterior),
        necessidadeToBe:Math.round(necessidadeToBe),
        checkoutsNecessarios:required,
        gapCheckouts:Math.max(0,required-currentCheckouts),
        capacidadeNecessaria:Math.round(requiredCapacity),
        gapCapacidade:Math.max(0,Math.round(requiredCapacity-structuralCurrentCapacity)),
        producaoToBe:Math.round(producaoToBe),
        backlogToBe:Math.round(backlogToBe),
        hcAtual:operation?structuralCurrentHC:0,
        hcNecessario:requiredHC,
        gapHC:Math.max(0,requiredHC-structuralCurrentHC),
        limiteCheckouts:limit,
        acimaLimiteConfigurado:aboveLimit,
        status,
      }
    })

  const peak=days.length?days.reduce((best,row)=>row.forecast>best.forecast?row:best):null
  const maxRequired=days.reduce((m,row)=>Math.max(m,row.checkoutsNecessarios),0)
  const requiredCapacity=maxRequired*capPerCheckout
  const requiredHC=totalHC(p,maxRequired)
  const peakRow=days.find(row=>row.checkoutsNecessarios===maxRequired)??peak
  const summary:ScenarioSummary={
    currentCheckouts,
    currentCapacity:structuralCurrentCapacity,
    currentHC:structuralCurrentHC,
    peakForecast:peak?.forecast??0,
    peakDate:peak?.data??'',
    requiredCheckouts:maxRequired,
    requiredCapacity,
    requiredHC,
    gapCheckouts:Math.max(0,maxRequired-currentCheckouts),
    gapCapacity:Math.max(0,requiredCapacity-structuralCurrentCapacity),
    gapHC:Math.max(0,requiredHC-structuralCurrentHC),
    configuredLimitAtPeak:peakRow?.limiteCheckouts??p.checkouts_maximos,
    daysAboveCurrent:days.filter(row=>row.checkoutsNecessarios>currentCheckouts).length,
    daysWithoutOperation:days.filter(row=>row.necessidadeToBe>0&&!row.operacaoPlanejada).length,
    daysAboveConfiguredLimit:days.filter(row=>row.acimaLimiteConfigurado).length,
    maxUtilization:days.reduce((m,row)=>Math.max(m,row.utilizacaoAtual??0),0),
    finalBacklogAsIs:days.at(-1)?.backlogAsIs??0,
    peakBacklogAsIs:days.reduce((m,row)=>Math.max(m,row.backlogAsIs),0),
    finalBacklogToBe:days.at(-1)?.backlogToBe??0,
    peakBacklogToBe:days.reduce((m,row)=>Math.max(m,row.backlogToBe),0),
  }

  return{days,summary}
}
