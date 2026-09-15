import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'
import { parsePlanningForecastFile, normalizePlanningHeader } from './engine/forecastImport'
import { buildPlanningAdvice, defaultPlanningConstraints, type PlanningConstraints, type PlanningRecommendation } from './engine/planningAdvisor'
import type { Decisions, Depositor, ForecastRow, JornadaAtiva, Tariffs } from './engine/simulation'
import './planner-copilot.css'

type DbDepositor=Depositor&{id:string;ativo:boolean}
type ChatMessage={role:'assistant'|'user';text:string}

const emptyTariffs:Tariffs={diaUtil:0,sabado:0,domingoFeriado:0,noturno:0}
const fmt=(value:number)=>Math.round(value).toLocaleString('pt-BR')
const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const fmtDate=(value:string)=>new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')

function recommendationLabel(item:PlanningRecommendation){
  return`${fmtDate(item.data)} · ${item.action} · ${fmt(item.necessidade)} pedidos · ${money(item.custo)}`
}

export default function PlannerCopilotFeature(){
  const[open,setOpen]=useState(false)
  const[navTarget,setNavTarget]=useState<Element|null>(null)
  const[workspaceTarget,setWorkspaceTarget]=useState<Element|null>(null)
  const[depositors,setDepositors]=useState<DbDepositor[]>([])
  const[selectedId,setSelectedId]=useState('')
  const[holidays,setHolidays]=useState<Set<string>>(new Set())
  const[tariffs,setTariffs]=useState<Tariffs>(emptyTariffs)
  const[rows,setRows]=useState<ForecastRow[]>([])
  const[fileName,setFileName]=useState('')
  const[sourceRule,setSourceRule]=useState('')
  const[decisions,setDecisions]=useState<Decisions>({})
  const[constraints,setConstraints]=useState<PlanningConstraints>({...defaultPlanningConstraints})
  const[chat,setChat]=useState<ChatMessage[]>([{role:'assistant',text:'Suba um forecast. Eu vou analisar capacidade, backlog e ações extraordinárias e montar uma primeira recomendação operacional.'}])
  const[input,setInput]=useState('')
  const[message,setMessage]=useState('')
  const chatEnd=useRef<HTMLDivElement|null>(null)

  useEffect(()=>{
    const resolve=()=>{setNavTarget(document.querySelector('.sidebar-nav'));setWorkspaceTarget(document.querySelector('.workspace'))}
    resolve()
    const observer=new MutationObserver(resolve)
    observer.observe(document.body,{childList:true,subtree:true})
    return()=>observer.disconnect()
  },[])

  useEffect(()=>{
    document.body.classList.toggle('planner-copilot-open',open)
    return()=>document.body.classList.remove('planner-copilot-open')
  },[open])

  useEffect(()=>{
    const nav=document.querySelector('.sidebar-nav')
    if(!nav)return
    const handler=(event:Event)=>{
      const target=event.target as HTMLElement|null
      if(!target?.closest('[data-planner-copilot="true"]'))setOpen(false)
    }
    nav.addEventListener('click',handler)
    return()=>nav.removeEventListener('click',handler)
  },[navTarget])

  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:'smooth'})},[chat])

  useEffect(()=>{
    if(!open||!supabase)return
    let cancelled=false
    Promise.all([
      supabase.from('depositantes').select('*').order('nome'),
      supabase.from('feriados').select('data').eq('feriado_operacional',true).order('data'),
      supabase.from('tarifas').select('tipo,valor_hora').order('tipo'),
    ]).then(([depsResult,holidaysResult,tariffResult])=>{
      if(cancelled)return
      if(depsResult.error){setMessage(depsResult.error.message);return}
      const numeric=['horas_trabalhadas_dia','capacidade_checkout_dia','horas_extra_max_dia_util','horas_operacao_extra_sabado','horas_operacao_extra_dom_feriado','pessoas_por_checkout','pessoas_separando','pessoas_embalando','pessoas_embalagem_caixa','pessoas_roteirizando','pessoas_ressuprindo','checkouts_atuais','checkouts_maximos','checkouts_minimos_dia_util','checkouts_maximos_fim_semana','hc_maximo','turnos_maximos']
      const clean=(depsResult.data??[]).map((d:any)=>{
        const item:any={...d}
        numeric.forEach(key=>item[key]=Number(item[key]))
        const fallback=(item.jornada??'SEG a SEX') as JornadaAtiva
        item.jornadas_ativas=Array.isArray(item.jornadas_ativas)&&item.jornadas_ativas.length?item.jornadas_ativas:[fallback]
        return item
      }) as DbDepositor[]
      setDepositors(clean)
      const topbarValue=(document.querySelector('.topbar-select select') as HTMLSelectElement|null)?.value
      setSelectedId(current=>clean.some(d=>d.id===current)?current:clean.find(d=>d.id===topbarValue)?.id??clean.find(d=>d.ativo)?.id??clean[0]?.id??'')
      if(!holidaysResult.error)setHolidays(new Set((holidaysResult.data??[]).map((item:any)=>String(item.data).slice(0,10))))
      const next={...emptyTariffs}
      ;(tariffResult.data??[]).forEach((item:any)=>{const value=Number(item.valor_hora);if(item.tipo==='Dia útil')next.diaUtil=value;if(item.tipo==='Sábado')next.sabado=value;if(item.tipo==='Domingo/Feriado')next.domingoFeriado=value;if(item.tipo==='Noturno')next.noturno=value})
      setTariffs(next)
    })
    return()=>{cancelled=true}
  },[open])

  const depositor=depositors.find(item=>item.id===selectedId)
  const advice=useMemo(()=>depositor&&rows.length?buildPlanningAdvice(rows,depositor,holidays,tariffs,decisions,constraints):null,[rows,depositor,holidays,tariffs,decisions,constraints])

  async function onFile(file:File){
    setMessage('')
    try{
      const parsed=await parsePlanningForecastFile(file)
      setRows(parsed.rows)
      setFileName(file.name)
      setSourceRule(`${parsed.sheet} · cabeçalho na linha ${parsed.headerRow} · ${parsed.rule}`)
      setDecisions({})
      setConstraints({...defaultPlanningConstraints})
      setChat([{role:'assistant',text:`Arquivo ${file.name} carregado com ${parsed.rows.length} dias válidos. Fonte identificada: ${parsed.sheet}. Regra de demanda: ${parsed.rule}`}])
    }catch(error){
      setRows([]);setFileName('');setSourceRule('');setMessage(error instanceof Error?error.message:'Não foi possível ler o arquivo.')
    }
  }

  useEffect(()=>{
    if(!advice||!rows.length)return
    const {summary,recommendations}=advice
    const first=recommendations.slice(0,4).map(item=>recommendationLabel(item)).join('\n')
    const diagnosis=`Diagnóstico: forecast total de ${fmt(summary.totalForecast)} pedidos, pico de ${fmt(summary.peakForecast)} em ${summary.peakDate?fmtDate(summary.peakDate):'—'}. Sem ações extraordinárias, o pico de backlog chega a ${fmt(summary.basePeakBacklog)} e o backlog final fica em ${fmt(summary.baseFinalBacklog)}. O plano provisório atual tem ${summary.recommendationCount} ações pendentes (${summary.weekendCount} em fim de semana, ${summary.holidayCount} em feriado e ${summary.overtimeCount} com HE), custo adicional estimado de ${money(summary.projectedCost)} e backlog final de ${fmt(summary.projectedFinalBacklog)}.${first?`\n\nPrimeiros candidatos:\n${first}`:''}`
    setChat(current=>current.some(item=>item.role==='assistant'&&item.text.startsWith('Diagnóstico:'))?current:[...current,{role:'assistant',text:diagnosis}])
  },[advice?.summary.totalForecast,selectedId,fileName])

  function rejectBy(predicate:(item:PlanningRecommendation)=>boolean){
    if(!advice)return 0
    const affected=advice.recommendations.filter(predicate)
    if(!affected.length)return 0
    setDecisions(prev=>{const next={...prev};affected.forEach(item=>{next[item.data]='rejected'});return next})
    return affected.length
  }

  function acceptBy(predicate:(item:PlanningRecommendation)=>boolean){
    if(!advice)return 0
    const affected=advice.recommendations.filter(predicate)
    if(!affected.length)return 0
    setDecisions(prev=>{const next={...prev};affected.forEach(item=>{next[item.data]='accepted'});return next})
    return affected.length
  }

  function setConstraint(key:keyof PlanningConstraints,value:boolean){
    setConstraints(prev=>({...prev,[key]:value}))
  }

  function respond(raw:string){
    const text=raw.trim()
    if(!text||!advice)return
    setChat(current=>[...current,{role:'user',text}])
    const normalized=normalizePlanningHeader(text)
    let response='Não alterei o cenário. Tente “não quero domingo”, “sem feriado”, “sem HE”, “aceite tudo”, “rejeite 15/10” ou “resumo”.'

    const dateMatch=text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
    if(dateMatch){
      const yearRaw=dateMatch[3]
      const year=yearRaw?Number(yearRaw.length===2?`20${yearRaw}`:yearRaw):new Date(`${advice.days[0]?.data??new Date().toISOString().slice(0,10)}T12:00:00`).getFullYear()
      const iso=`${year}-${dateMatch[2].padStart(2,'0')}-${dateMatch[1].padStart(2,'0')}`
      const item=advice.recommendations.find(rec=>rec.data===iso)
      if(item){
        const reject=normalized.includes('rejeit')||normalized.includes('nao quero')||normalized.includes('sem ')
        setDecisions(prev=>({...prev,[iso]:reject?'rejected':'accepted'}))
        response=`${reject?'Rejeitei':'Aceitei'} a ação de ${fmtDate(iso)} (${item.action}). O backlog dos dias seguintes será recalculado.`
      }else response=`Não há ação pendente em ${fmtDate(iso)} no cenário atual.`
    }else if(normalized.includes('aceite tudo')||normalized.includes('aceitar tudo')){
      const count=acceptBy(()=>true);response=`Aceitei ${count} ações pendentes do cenário atual.`
    }else if(normalized.includes('nao quero domingo')||normalized.includes('sem domingo')){
      setConstraint('allowSunday',false);response='Domingos bloqueados para este planejamento. Qualquer recomendação de domingo será rejeitada automaticamente e o backlog seguirá para os próximos dias.'
    }else if(normalized.includes('nao quero sabado')||normalized.includes('sem sabado')){
      setConstraint('allowSaturday',false);response='Sábados bloqueados para este planejamento. Vou recalcular usando os demais recursos disponíveis.'
    }else if(normalized.includes('sem feriado')||normalized.includes('nao quero feriado')){
      setConstraint('allowHoliday',false);response='Feriados bloqueados para este planejamento. As demandas desses dias serão carregadas para a sequência.'
    }else if(normalized.includes('sem he')||normalized.includes('nao quero he')||normalized.includes('sem hora extra')){
      setConstraint('allowOvertime',false);response='Hora extra bloqueada. O motor vai preservar capacidade-base e carregar o volume residual.'
    }else if(normalized.includes('com sabado')||normalized.includes('permitir sabado')){
      setConstraint('allowSaturday',true);response='Sábados liberados novamente como opção de cenário.'
    }else if(normalized.includes('com domingo')||normalized.includes('permitir domingo')){
      setConstraint('allowSunday',true);response='Domingos liberados novamente como opção de cenário.'
    }else if(normalized.includes('com feriado')||normalized.includes('permitir feriado')){
      setConstraint('allowHoliday',true);response='Feriados liberados novamente como opção de cenário.'
    }else if(normalized.includes('com he')||normalized.includes('permitir he')){
      setConstraint('allowOvertime',true);response='Hora extra liberada novamente como opção de cenário.'
    }else if(normalized.includes('rejeitar fim de semana')||normalized.includes('sem fim de semana')){
      setConstraint('allowSaturday',false);setConstraint('allowSunday',false);response='Sábados e domingos bloqueados. Vou concentrar o plano em dias úteis e feriados permitidos.'
    }else if(normalized.includes('resumo')||normalized.includes('como ficou')||normalized.includes('resultado')){
      const s=advice.summary
      response=`Cenário atual: backlog final ${fmt(s.projectedFinalBacklog)}, pico de backlog ${fmt(s.projectedPeakBacklog)}, custo adicional ${money(s.projectedCost)}, ${s.recommendationCount} ações ainda pendentes e ${s.rejectedByConstraint} ações automaticamente bloqueadas pelas suas restrições.`
    }
    setTimeout(()=>setChat(current=>[...current,{role:'assistant',text:response}]),0)
    setInput('')
  }

  function resetPlan(){
    setDecisions({})
    setConstraints({...defaultPlanningConstraints})
    setChat([{role:'assistant',text:'Cenário reiniciado. As ações e restrições voltaram ao estado inicial.'}])
  }

  const nav=navTarget?createPortal(
    <button type="button" data-planner-copilot="true" className={open?'active planner-copilot-nav':'planner-copilot-nav'} onClick={()=>setOpen(true)} title="Novo planejamento" aria-current={open?'page':undefined}>
      <span className="material-symbols-rounded material-icon">auto_awesome</span><span>Novo planejamento</span>
    </button>,navTarget
  ):null

  const page=open&&workspaceTarget?createPortal(<div className="planner-copilot-page">
    <header className="page-header copilot-header"><div><h1>Novo planejamento</h1><p>Suba o forecast, receba um diagnóstico e refine o plano operacional conversando com o Planner.</p></div><button className="secondary-action" onClick={resetPlan} disabled={!rows.length}>Reiniciar cenário</button></header>

    <section className="copilot-top-grid">
      <article className="section-panel copilot-input-card">
        <div className="section-heading"><div><h2>1. Forecast e operação</h2><p>O arquivo é normalizado antes da simulação. O Planner procura o cabeçalho e identifica a demanda diária automaticamente.</p></div></div>
        <label><span>Depositante</span><select value={selectedId} onChange={e=>{setSelectedId(e.target.value);setDecisions({});setConstraints({...defaultPlanningConstraints})}}>{depositors.filter(item=>item.ativo).map(item=><option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
        <label className={`copilot-dropzone ${fileName?'has-file':''}`}><input type="file" accept=".xlsx,.xls,.csv" onChange={e=>e.target.files?.[0]&&onFile(e.target.files[0])}/><span className="material-symbols-rounded material-icon">upload_file</span><div><b>{fileName||'Subir forecast'}</b><small>{fileName?`${rows.length} dias · ${sourceRule}`:'Excel ou CSV com data e demanda diária'}</small></div></label>
        {message?<div className="copilot-error">{message}</div>:null}
        {rows.length?<div className="constraint-strip"><span>Restrições</span><button className={constraints.allowSaturday?'':'blocked'} onClick={()=>setConstraint('allowSaturday',!constraints.allowSaturday)}>Sábado</button><button className={constraints.allowSunday?'':'blocked'} onClick={()=>setConstraint('allowSunday',!constraints.allowSunday)}>Domingo</button><button className={constraints.allowHoliday?'':'blocked'} onClick={()=>setConstraint('allowHoliday',!constraints.allowHoliday)}>Feriado</button><button className={constraints.allowOvertime?'':'blocked'} onClick={()=>setConstraint('allowOvertime',!constraints.allowOvertime)}>HE</button></div>:null}
      </article>

      <article className="section-panel copilot-summary-card">
        <div className="section-heading"><div><h2>2. Diagnóstico</h2><p>Comparação entre a operação-base e o plano provisório sugerido.</p></div></div>
        {advice?<div className="copilot-kpis"><div><span>Forecast</span><strong>{fmt(advice.summary.totalForecast)}</strong></div><div><span>Pico backlog sem ações</span><strong>{fmt(advice.summary.basePeakBacklog)}</strong></div><div><span>Ações pendentes</span><strong>{advice.summary.recommendationCount}</strong></div><div><span>Custo projetado</span><strong>{money(advice.summary.projectedCost)}</strong></div><div><span>Backlog final projetado</span><strong>{fmt(advice.summary.projectedFinalBacklog)}</strong></div><div><span>Pico forecast</span><strong>{fmt(advice.summary.peakForecast)}</strong><small>{advice.summary.peakDate?fmtDate(advice.summary.peakDate):'—'}</small></div></div>:<div className="copilot-empty">Aguardando forecast.</div>}
      </article>
    </section>

    <section className="copilot-work-grid">
      <article className="section-panel copilot-recommendations">
        <div className="section-heading"><div><h2>3. Candidatos de ação</h2><p>O motor calcula os impactos. Nesta primeira versão, você confirma ou elimina as alternativas até fechar o plano.</p></div></div>
        {advice?.recommendations.length?<div className="recommendation-list">{advice.recommendations.map(item=><div className="recommendation-row" key={item.data}><div><b>{fmtDate(item.data)} · {item.tipoDia}</b><span>{item.action}</span><small>{item.rationale}</small></div><div className="recommendation-meta"><strong>{fmt(item.necessidade)}</strong><small>pedidos necessários</small><em>{money(item.custo)}</em></div><div className="recommendation-actions"><button onClick={()=>setDecisions(prev=>({...prev,[item.data]:'accepted'}))}>Aceitar</button><button className="danger-lite" onClick={()=>setDecisions(prev=>({...prev,[item.data]:'rejected'}))}>Rejeitar</button></div></div>)}</div>:<div className="copilot-empty">{rows.length?'Nenhuma ação extraordinária pendente no cenário atual.':'As recomendações aparecerão após o upload.'}</div>}
      </article>

      <article className="section-panel copilot-chat-card">
        <div className="section-heading"><div><h2>Planner</h2><p>Refine o cenário em linguagem natural.</p></div></div>
        <div className="copilot-chat">{chat.map((item,index)=><div key={index} className={`chat-bubble ${item.role}`}>{item.text.split('\n').map((line,i)=><span key={i}>{line}</span>)}</div>)}<div ref={chatEnd}/></div>
        <form className="copilot-composer" onSubmit={e=>{e.preventDefault();respond(input)}}><input value={input} onChange={e=>setInput(e.target.value)} placeholder={rows.length?'Ex.: não quero domingo':'Suba um forecast para começar'} disabled={!rows.length}/><button type="submit" disabled={!rows.length||!input.trim()}><span className="material-symbols-rounded material-icon">send</span></button></form>
        <div className="copilot-suggestions"><button onClick={()=>respond('não quero domingo')} disabled={!rows.length}>Sem domingo</button><button onClick={()=>respond('sem HE')} disabled={!rows.length}>Sem HE</button><button onClick={()=>respond('aceite tudo')} disabled={!rows.length}>Aceitar tudo</button><button onClick={()=>respond('resumo')} disabled={!rows.length}>Resumo</button></div>
      </article>
    </section>
  </div>,workspaceTarget):null

  return<>{nav}{page}</>
}
