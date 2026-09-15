import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { buildPlanningAdvice, type PlanningRecommendation } from './engine/planningAdvisor'
import type { Decisions, Depositor, ForecastRow, JornadaAtiva, Tariffs } from './engine/simulation'
import './planner-copilot.css'

type DbDepositor=Depositor&{id:string;ativo:boolean}
type ChatMessage={role:'assistant'|'user';text:string}

const emptyTariffs:Tariffs={diaUtil:0,sabado:0,domingoFeriado:0,noturno:0}
const fmt=(value:number)=>Math.round(value).toLocaleString('pt-BR')
const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const fmtDate=(value:string)=>new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')

function normalizeHeader(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}

function excelDate(value:unknown){
  if(value instanceof Date)return value.toISOString().slice(0,10)
  if(typeof value==='number'){
    const parsed=XLSX.SSF.parse_date_code(value)
    if(parsed)return`${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`
  }
  const raw=String(value??'').trim()
  if(/^\d{4}-\d{2}-\d{2}/.test(raw))return raw.slice(0,10)
  const br=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if(br)return`${br[3]}-${br[2].padStart(2,'0')}-${br[1].padStart(2,'0')}`
  return''
}

function numberValue(value:unknown){
  if(typeof value==='number')return Number.isFinite(value)?value:0
  const raw=String(value??'').trim()
  if(!raw)return 0
  const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw
  const parsed=Number(normalized)
  return Number.isFinite(parsed)?parsed:0
}

function detectForecast(headers:string[],row:Record<string,unknown>){
  const normalized=headers.map(header=>({header,key:normalizeHeader(header)}))
  const direct=normalized.find(item=>['forecast','forecast total pedido normal','demanda','demanda total','pedidos','volume','volumetria'].includes(item.key))
  if(direct)return numberValue(row[direct.header])

  const demandaDia=normalized.filter(item=>item.key.includes('demanda do dia'))
  if(demandaDia.length){
    const withTikTok=demandaDia.find(item=>item.key.includes('tiktok')&&!item.key.includes('sem tiktok'))
    const withoutTikTok=demandaDia.find(item=>item.key.includes('sem tiktok')||item.key.includes('sem tik tok'))
    if(withTikTok&&withoutTikTok)return numberValue(row[withTikTok.header])+numberValue(row[withoutTikTok.header])
    return demandaDia.reduce((sum,item)=>sum+numberValue(row[item.header]),0)
  }

  const forecastLike=normalized.filter(item=>item.key.includes('forecast')||item.key.includes('demanda'))
  return forecastLike.length===1?numberValue(row[forecastLike[0].header]):0
}

async function parseForecastFile(file:File){
  const buffer=await file.arrayBuffer()
  const wb=XLSX.read(buffer,{type:'array',cellDates:true})
  let best:{rows:ForecastRow[];sheet:string;rule:string}|null=null

  for(const sheet of wb.SheetNames){
    const ws=wb.Sheets[sheet]
    const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(ws,{defval:null,raw:true})
    if(!raw.length)continue
    const headers=Object.keys(raw[0]??{})
    const dateHeader=headers.find(header=>['data','date','dia'].includes(normalizeHeader(header)))
    if(!dateHeader)continue
    const demandaHeaders=headers.filter(header=>normalizeHeader(header).includes('demanda do dia'))
    const rule=demandaHeaders.length>=2?'Demanda do Dia: soma automática das colunas identificadas (incluindo com/sem TikTok).':'Forecast/demanda diária identificada automaticamente.'
    const rows=raw.map(item=>({data:excelDate(item[dateHeader]),forecast:detectForecast(headers,item)})).filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.data)&&Number.isFinite(row.forecast)&&row.forecast>=0)
    if(rows.length&&(!best||rows.length>best.rows.length))best={rows,sheet,rule}
  }

  if(!best)throw new Error('Não encontrei uma tabela diária válida. O arquivo precisa ter uma coluna de data e uma coluna de forecast/demanda.')
  return best
}

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
  const advice=useMemo(()=>depositor&&rows.length?buildPlanningAdvice(rows,depositor,holidays,tariffs,decisions):null,[rows,depositor,holidays,tariffs,decisions])

  async function onFile(file:File){
    setMessage('')
    try{
      const parsed=await parseForecastFile(file)
      setRows(parsed.rows)
      setFileName(file.name)
      setSourceRule(`${parsed.sheet} · ${parsed.rule}`)
      setDecisions({})
      setChat([{role:'assistant',text:`Arquivo ${file.name} carregado com ${parsed.rows.length} dias válidos. Estou usando: ${parsed.rule}`}])
    }catch(error){
      setRows([]);setFileName('');setSourceRule('');setMessage(error instanceof Error?error.message:'Não foi possível ler o arquivo.')
    }
  }

  useEffect(()=>{
    if(!advice||!rows.length)return
    const {summary,recommendations}=advice
    const first=recommendations.slice(0,4).map(item=>recommendationLabel(item)).join('\n')
    const diagnosis=`Diagnóstico: forecast total de ${fmt(summary.totalForecast)} pedidos, pico de ${fmt(summary.peakForecast)} em ${summary.peakDate?fmtDate(summary.peakDate):'—'}. Sem aceitar ações extraordinárias, o pico de backlog chega a ${fmt(summary.basePeakBacklog)} e o backlog final fica em ${fmt(summary.baseFinalBacklog)}. Minha projeção atual tem ${summary.recommendationCount} ações pendentes (${summary.weekendCount} em fim de semana, ${summary.holidayCount} em feriado e ${summary.overtimeCount} com HE), custo adicional estimado de ${money(summary.projectedCost)} e backlog final de ${fmt(summary.projectedFinalBacklog)}.${first?`\n\nPrimeiras recomendações:\n${first}`:''}`
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

  function respond(raw:string){
    const text=raw.trim()
    if(!text||!advice)return
    setChat(current=>[...current,{role:'user',text}])
    const normalized=normalizeHeader(text)
    let response='Não alterei o cenário. Tente algo como “não quero domingo”, “sem feriado”, “sem HE”, “aceite tudo”, “rejeite 15/10” ou “resumo”.'

    const dateMatch=text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
    if(dateMatch){
      const yearRaw=dateMatch[3]
      const year=yearRaw?Number(yearRaw.length===2?`20${yearRaw}`:yearRaw):new Date(`${advice.days[0]?.data??new Date().toISOString().slice(0,10)}T12:00:00`).getFullYear()
      const iso=`${year}-${dateMatch[2].padStart(2,'0')}-${dateMatch[1].padStart(2,'0')}`
      const item=advice.recommendations.find(rec=>rec.data===iso)
      if(item){
        const reject=normalized.includes('rejeit')||normalized.includes('nao quero')||normalized.includes('sem ')
        setDecisions(prev=>({...prev,[iso]:reject?'rejected':'accepted'}))
        response=`${reject?'Rejeitei':'Aceitei'} a ação de ${fmtDate(iso)} (${item.action}). Vou recalcular o backlog dos dias seguintes.`
      }else response=`Não há ação pendente em ${fmtDate(iso)} no cenário atual.`
    }else if(normalized.includes('aceite tudo')||normalized.includes('aceitar tudo')){
      const count=acceptBy(()=>true);response=`Aceitei ${count} ações pendentes do cenário atual. Vou manter o recálculo sequencial.`
    }else if(normalized.includes('nao quero domingo')||normalized.includes('sem domingo')){
      const count=rejectBy(item=>item.tipoDia==='Domingo');response=`Rejeitei ${count} recomendações de domingo. O volume residual será carregado como backlog e redistribuído pelos dias seguintes.`
    }else if(normalized.includes('nao quero sabado')||normalized.includes('sem sabado')){
      const count=rejectBy(item=>item.tipoDia==='Sábado');response=`Rejeitei ${count} recomendações de sábado. Vou recalcular o impacto no backlog.`
    }else if(normalized.includes('sem feriado')||normalized.includes('nao quero feriado')){
      const count=rejectBy(item=>item.tipoDia==='Feriado');response=`Rejeitei ${count} recomendações em feriados e recalculei a sequência.`
    }else if(normalized.includes('sem he')||normalized.includes('nao quero he')||normalized.includes('sem hora extra')){
      const count=rejectBy(item=>item.kind==='overtime');response=`Rejeitei ${count} recomendações de hora extra. O motor vai carregar o volume não absorvido para frente.`
    }else if(normalized.includes('com sabado')||normalized.includes('aceitar sabado')){
      const count=acceptBy(item=>item.tipoDia==='Sábado');response=`Aceitei ${count} recomendações de sábado.`
    }else if(normalized.includes('com domingo')||normalized.includes('aceitar domingo')){
      const count=acceptBy(item=>item.tipoDia==='Domingo');response=`Aceitei ${count} recomendações de domingo.`
    }else if(normalized.includes('resumo')||normalized.includes('como ficou')||normalized.includes('resultado')){
      const s=advice.summary
      response=`Cenário atual: backlog final ${fmt(s.projectedFinalBacklog)}, pico de backlog ${fmt(s.projectedPeakBacklog)}, custo adicional ${money(s.projectedCost)} e ${s.recommendationCount} ações ainda pendentes.`
    }
    setTimeout(()=>setChat(current=>[...current,{role:'assistant',text:response}]),0)
    setInput('')
  }

  function resetPlan(){setDecisions({});setChat([{role:'assistant',text:'Cenário reiniciado. As recomendações voltaram ao estado pendente.'}])}

  const nav=navTarget?createPortal(<button type="button" data-planner-copilot="true" className={open?'active planner-copilot-nav':'planner-copilot-nav'} onClick={()=>setOpen(true)}><span className="material-symbols-rounded material-icon">auto_awesome</span><span>Novo planejamento</span></button>,navTarget):null

  const page=open&&workspaceTarget?createPortal(<div className="planner-copilot-page">
    <header className="page-header copilot-header"><div><h1>Novo planejamento</h1><p>Suba o forecast, receba um diagnóstico e refine o plano operacional conversando com o Planner.</p></div><button className="secondary-action" onClick={resetPlan} disabled={!rows.length}>Reiniciar cenário</button></header>

    <section className="copilot-top-grid">
      <article className="section-panel copilot-input-card">
        <div className="section-heading"><div><h2>1. Forecast e operação</h2><p>O arquivo é normalizado antes da simulação. Datas e colunas de demanda são detectadas automaticamente.</p></div></div>
        <label><span>Depositante</span><select value={selectedId} onChange={e=>{setSelectedId(e.target.value);setDecisions({})}}>{depositors.filter(item=>item.ativo).map(item=><option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
        <label className={`copilot-dropzone ${fileName?'has-file':''}`}><input type="file" accept=".xlsx,.xls,.csv" onChange={e=>e.target.files?.[0]&&onFile(e.target.files[0])}/><span className="material-symbols-rounded material-icon">upload_file</span><div><b>{fileName||'Subir forecast'}</b><small>{fileName?`${rows.length} dias · ${sourceRule}`:'Excel ou CSV com data e demanda diária'}</small></div></label>
        {message?<div className="copilot-error">{message}</div>:null}
      </article>

      <article className="section-panel copilot-summary-card">
        <div className="section-heading"><div><h2>2. Diagnóstico</h2><p>Comparação entre a operação-base e o plano provisório sugerido.</p></div></div>
        {advice?<div className="copilot-kpis"><div><span>Forecast</span><strong>{fmt(advice.summary.totalForecast)}</strong></div><div><span>Pico backlog sem ações</span><strong>{fmt(advice.summary.basePeakBacklog)}</strong></div><div><span>Ações pendentes</span><strong>{advice.summary.recommendationCount}</strong></div><div><span>Custo projetado</span><strong>{money(advice.summary.projectedCost)}</strong></div><div><span>Backlog final projetado</span><strong>{fmt(advice.summary.projectedFinalBacklog)}</strong></div><div><span>Pico forecast</span><strong>{fmt(advice.summary.peakForecast)}</strong><small>{advice.summary.peakDate?fmtDate(advice.summary.peakDate):'—'}</small></div></div>:<div className="copilot-empty">Aguardando forecast.</div>}
      </article>
    </section>

    <section className="copilot-work-grid">
      <article className="section-panel copilot-recommendations">
        <div className="section-heading"><div><h2>3. Recomendações</h2><p>As ações ficam provisoriamente aplicadas até você aceitar ou rejeitar.</p></div></div>
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
