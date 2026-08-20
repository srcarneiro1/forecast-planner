import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'
import { headcountForCheckouts, type Depositor, type JornadaAtiva } from './engine/simulation'

type HistoryItem={id:string;depositante_id:string;arquivo_nome:string|null;periodo_inicio:string;periodo_fim:string;forecast_total:number;pico_backlog:number;pico_hc:number;custo_total:number;created_at:string}
type Daily={data:string;tipo_dia:string;dentro_escala:boolean;forecast:number;backlog_final:number;checkouts_operacionais:number;capacidade_planejada:number;hc_total:number}
type DbDepositor=Depositor&{id:string;ativo:boolean}

const number=(v:number)=>Number(v||0).toLocaleString('pt-BR')
const currency=(v:number)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const date=(v:string)=>new Date(v+'T12:00:00').toLocaleDateString('pt-BR')

export default function DashboardHistoryFeature(){
  const[workspace,setWorkspace]=useState<Element|null>(null)
  const[active,setActive]=useState(false)
  const[depositanteId,setDepositanteId]=useState('')
  const[depositante,setDepositante]=useState<DbDepositor|null>(null)
  const[history,setHistory]=useState<HistoryItem[]>([])
  const[selectedPlanningId,setSelectedPlanningId]=useState('')
  const[rows,setRows]=useState<Daily[]>([])

  useEffect(()=>{
    const sync=()=>{
      setWorkspace(document.querySelector('.workspace'))
      const dashboardButton=[...document.querySelectorAll('.sidebar-nav button')].find(el=>el.textContent?.trim()==='Dashboard')
      const scenarioOpen=Boolean(document.querySelector('.scenario-nav-button.active'))
      setActive(Boolean(dashboardButton?.classList.contains('active'))&&!scenarioOpen)
      const topbar=document.querySelector('.topbar-select select') as HTMLSelectElement|null
      if(topbar?.value)setDepositanteId(topbar.value)
    }
    sync()
    const observer=new MutationObserver(sync)
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']})
    document.addEventListener('change',sync,true)
    document.addEventListener('click',sync,true)
    return()=>{observer.disconnect();document.removeEventListener('change',sync,true);document.removeEventListener('click',sync,true)}
  },[])

  useEffect(()=>{
    document.body.classList.toggle('dashboard-history-open',active)
    return()=>document.body.classList.remove('dashboard-history-open')
  },[active])

  useEffect(()=>{
    if(!active||!supabase||!depositanteId){setHistory([]);setRows([]);setDepositante(null);return}
    let cancelled=false
    Promise.all([
      supabase.from('depositantes').select('*').eq('id',depositanteId).maybeSingle(),
      supabase.from('simulacoes').select('id,depositante_id,arquivo_nome,periodo_inicio,periodo_fim,forecast_total,pico_backlog,pico_hc,custo_total,created_at').eq('depositante_id',depositanteId).order('created_at',{ascending:false}).limit(50),
    ]).then(([depResult,histResult])=>{
      if(cancelled)return
      if(depResult.data){
        const item:any={...depResult.data}
        const numeric=['horas_trabalhadas_dia','capacidade_checkout_dia','horas_extra_max_dia_util','horas_operacao_extra_sabado','horas_operacao_extra_dom_feriado','pessoas_por_checkout','pessoas_separando','pessoas_embalando','pessoas_embalagem_caixa','pessoas_roteirizando','pessoas_ressuprindo','checkouts_atuais','checkouts_maximos','checkouts_minimos_dia_util','checkouts_maximos_fim_semana','hc_maximo','turnos_maximos']
        numeric.forEach(k=>item[k]=Number(item[k]))
        const fallback=(item.jornada??'SEG a SEX') as JornadaAtiva
        item.jornadas_ativas=Array.isArray(item.jornadas_ativas)&&item.jornadas_ativas.length?item.jornadas_ativas:[fallback]
        setDepositante(item as DbDepositor)
      }
      const clean=(histResult.data??[]).map((h:any)=>({...h,forecast_total:Number(h.forecast_total),pico_backlog:Number(h.pico_backlog),pico_hc:Number(h.pico_hc),custo_total:Number(h.custo_total)})) as HistoryItem[]
      setHistory(clean)
      setSelectedPlanningId(current=>clean.some(h=>h.id===current)?current:(clean[0]?.id??''))
    })
    return()=>{cancelled=true}
  },[active,depositanteId])

  useEffect(()=>{
    if(!active||!supabase||!selectedPlanningId){setRows([]);return}
    let cancelled=false
    supabase.from('simulacoes_diarias').select('data,tipo_dia,dentro_escala,forecast,backlog_final,checkouts_operacionais,capacidade_planejada,hc_total').eq('simulacao_id',selectedPlanningId).order('data').then(({data})=>{
      if(cancelled)return
      setRows((data??[]).map((r:any)=>({...r,forecast:Number(r.forecast),backlog_final:Number(r.backlog_final),checkouts_operacionais:Number(r.checkouts_operacionais),capacidade_planejada:Number(r.capacidade_planejada),hc_total:Number(r.hc_total)})))
    })
    return()=>{cancelled=true}
  },[active,selectedPlanningId])

  const planning=history.find(h=>h.id===selectedPlanningId)??null
  const peakForecast=rows.length?rows.reduce((a,b)=>b.forecast>a.forecast?b:a):null
  const peakCheckouts=rows.reduce((m,r)=>Math.max(m,r.checkouts_operacionais),0)
  const peakCapacity=rows.reduce((m,r)=>Math.max(m,r.capacidade_planejada),0)
  const peakHC=rows.reduce((m,r)=>Math.max(m,r.hc_total),0)
  const finalBacklog=rows.at(-1)?.backlog_final??0
  const backlogDays=rows.filter(r=>r.backlog_final>0).length
  const outsideScaleDays=rows.filter(r=>r.forecast>0&&!r.dentro_escala).length
  const aboveLimitDays=useMemo(()=>{
    if(!depositante)return 0
    return rows.filter(r=>{
      const max=r.tipo_dia==='Sábado'||r.tipo_dia==='Domingo'||r.tipo_dia==='Feriado'?depositante.checkouts_maximos_fim_semana:depositante.checkouts_maximos
      return r.checkouts_operacionais>max
    }).length
  },[rows,depositante])
  const maxBacklog=rows.length?rows.reduce((a,b)=>b.backlog_final>a.backlog_final?b:a):null
  const currentCapacity=depositante?depositante.checkouts_atuais*depositante.capacidade_checkout_dia:0
  const currentHC=depositante?headcountForCheckouts(depositante,depositante.checkouts_atuais):0

  if(!active||!workspace)return null

  return createPortal(
    <div className="dashboard-history-page">
      <header className="page-header dashboard-history-header">
        <div><h1>Dashboard</h1><p>Visão gerencial da estrutura atual e do planejamento histórico selecionado.</p></div>
        {history.length>0&&<label className="dashboard-planning-select"><span>Planejamento</span><select value={selectedPlanningId} onChange={e=>setSelectedPlanningId(e.target.value)}>{history.map(h=><option key={h.id} value={h.id}>{date(h.periodo_inicio)} a {date(h.periodo_fim)} · {new Date(h.created_at).toLocaleDateString('pt-BR')}</option>)}</select></label>}
      </header>

      <section className="operation-summary"><div className="operation-title"><span>Operação atual</span><h2>{depositante?.nome??'—'}</h2></div>{depositante&&<div className="operation-facts"><div><span>Escala</span><b>{depositante.escala}</b></div><div><span>Jornadas</span><b>{depositante.jornadas_ativas?.join(' + ')||depositante.jornada}</b></div><div><span>Checkouts</span><b>{depositante.checkouts_atuais} / {depositante.checkouts_maximos}</b></div><div><span>Capacidade atual</span><b>{number(currentCapacity)}</b></div></div>}</section>

      {planning?<>
        <section className="dashboard-last-plan section-panel"><div className="section-heading"><div><h2>Planejamento selecionado</h2><p>{date(planning.periodo_inicio)} a {date(planning.periodo_fim)} · salvo em {new Date(planning.created_at).toLocaleString('pt-BR')}</p></div></div><div className="dashboard-plan-kpis"><div><span>Forecast total</span><strong>{number(planning.forecast_total)}</strong></div><div><span>Pico do forecast</span><strong>{peakForecast?number(peakForecast.forecast):'—'}</strong><small>{peakForecast?date(peakForecast.data):'—'}</small></div><div><span>Backlog final</span><strong>{number(finalBacklog)}</strong></div><div><span>Pico HC</span><strong>{peakHC||planning.pico_hc}</strong></div><div><span>Custo</span><strong>{currency(planning.custo_total)}</strong></div></div></section>
        <section className="dashboard-compare"><article className="section-panel"><div className="section-heading"><div><h2>Estrutura atual × planejamento</h2><p>Comparação com o pico do planejamento selecionado.</p></div></div><div className="compare-table"><div className="compare-head"><span>Indicador</span><span>Estrutura atual</span><span>Planejamento</span><span>Gap</span></div><div><span>Checkouts</span><b>{depositante?.checkouts_atuais??'—'}</b><b>{peakCheckouts||'—'}</b><b>{depositante&&peakCheckouts>depositante.checkouts_atuais?`+${peakCheckouts-depositante.checkouts_atuais}`:'—'}</b></div><div><span>Capacidade/dia</span><b>{number(currentCapacity)}</b><b>{peakCapacity?number(peakCapacity):'—'}</b><b>{peakCapacity>currentCapacity?`+${number(peakCapacity-currentCapacity)}`:'—'}</b></div><div><span>HC</span><b>{currentHC}</b><b>{peakHC||'—'}</b><b>{peakHC>currentHC?`+${peakHC-currentHC}`:'—'}</b></div></div></article><article className="section-panel"><div className="section-heading"><div><h2>Alertas do planejamento</h2><p>Pontos que merecem atenção no cenário selecionado.</p></div></div><div className="dashboard-alerts"><div className={backlogDays?'attention':''}><span>Dias com backlog</span><b>{backlogDays}</b></div><div className={outsideScaleDays?'attention':''}><span>Dias fora da escala</span><b>{outsideScaleDays}</b></div><div className={aboveLimitDays?'attention':''}><span>Dias acima do limite de checkout</span><b>{aboveLimitDays}</b></div><div className={Number(maxBacklog?.backlog_final)>0?'attention':''}><span>Maior backlog</span><b>{maxBacklog?number(maxBacklog.backlog_final):'0'}</b><small>{maxBacklog&&maxBacklog.backlog_final>0?date(maxBacklog.data):'Sem backlog'}</small></div></div></article></section>
      </>:<section className="empty-panel large"><span className="material-symbols-rounded material-icon">database</span><div><h2>Nenhum planejamento salvo para esta operação</h2><p>Quando existir histórico, ele poderá ser selecionado diretamente no Dashboard.</p></div></section>}
    </div>,workspace
  )
}
