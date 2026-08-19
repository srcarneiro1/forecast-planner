import { dayType, isScheduled, type Depositor, type ForecastRow } from './simulation'

export type ScenarioStatus='Atende'|'Reforço dentro do limite'|'Expansão estrutural'|'Fora da escala'|'Sem demanda'

export type ScenarioDay=ForecastRow&{
  tipoDia:string
  dentroEscala:boolean
  capacidadeAtual:number
  utilizacaoAtual:number|null
  checkoutsAtuais:number
  checkoutsNecessarios:number
  gapCheckouts:number
  capacidadeNecessaria:number
  gapCapacidade:number
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
  daysOutsideSchedule:number
  daysAboveConfiguredLimit:number
  maxUtilization:number
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

export function analyzeScenario(rows:ForecastRow[],p:Depositor,holidays=new Set<string>()){
  const capPerCheckout=Math.max(0,p.capacidade_checkout_dia)
  const currentCheckouts=Math.max(0,p.checkouts_atuais)
  const currentCapacity=currentCheckouts*capPerCheckout
  const currentHC=totalHC(p,currentCheckouts)

  const days:ScenarioDay[]=[...rows]
    .sort((a,b)=>a.data.localeCompare(b.data))
    .map(row=>{
      const tipo=dayType(row.data,holidays)
      const scheduled=isScheduled(row.data,p,holidays)
      const forecast=Math.max(0,row.forecast)
      const required=forecast<=0?0:Math.ceil(forecast/Math.max(capPerCheckout,1))
      const requiredCapacity=required*capPerCheckout
      const requiredHC=totalHC(p,required)
      const limit=Math.max(0,configuredLimit(tipo,p))
      const aboveCurrent=required>currentCheckouts
      const aboveLimit=required>limit
      const status:ScenarioStatus=forecast<=0?'Sem demanda':!scheduled?'Fora da escala':!aboveCurrent?'Atende':aboveLimit?'Expansão estrutural':'Reforço dentro do limite'
      return{
        ...row,
        forecast,
        tipoDia:tipo,
        dentroEscala:scheduled,
        capacidadeAtual:currentCapacity,
        utilizacaoAtual:currentCapacity>0?forecast/currentCapacity*100:null,
        checkoutsAtuais:currentCheckouts,
        checkoutsNecessarios:required,
        gapCheckouts:Math.max(0,required-currentCheckouts),
        capacidadeNecessaria:requiredCapacity,
        gapCapacidade:Math.max(0,requiredCapacity-currentCapacity),
        hcAtual:currentHC,
        hcNecessario:requiredHC,
        gapHC:Math.max(0,requiredHC-currentHC),
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
    currentCapacity,
    currentHC,
    peakForecast:peak?.forecast??0,
    peakDate:peak?.data??'',
    requiredCheckouts:maxRequired,
    requiredCapacity,
    requiredHC,
    gapCheckouts:Math.max(0,maxRequired-currentCheckouts),
    gapCapacity:Math.max(0,requiredCapacity-currentCapacity),
    gapHC:Math.max(0,requiredHC-currentHC),
    configuredLimitAtPeak:peakRow?.limiteCheckouts??p.checkouts_maximos,
    daysAboveCurrent:days.filter(row=>row.checkoutsNecessarios>currentCheckouts).length,
    daysOutsideSchedule:days.filter(row=>row.forecast>0&&!row.dentroEscala).length,
    daysAboveConfiguredLimit:days.filter(row=>row.acimaLimiteConfigurado).length,
    maxUtilization:days.reduce((m,row)=>Math.max(m,row.utilizacaoAtual??0),0),
  }

  return{days,summary}
}
