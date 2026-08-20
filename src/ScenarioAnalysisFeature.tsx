import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { analyzeScenario, defaultScenarioOperatingDays, type ScenarioOperatingDays } from './engine/scenario'
import type { Depositor, ForecastRow, JornadaAtiva } from './engine/simulation'
import './scenario-analysis.css'

type DbDepositor=Depositor&{id:string;ativo:boolean}

const number=(v:number)=>v.toLocaleString('pt-BR')
const date=(v:string)=>new Date(v+'T12:00:00').toLocaleDateString('pt-BR')

function parseForecastFile(file:File){
  return file.arrayBuffer().then(buffer=>{
    const wb=XLSX.read(buffer,{type:'array',cellDates:true})
    const ws=wb.Sheets[wb.SheetNames[0]]
    const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(ws,{defval:null})
    return raw.map(item=>{
      const rawDate=item['Data']
      const data=rawDate instanceof Date?rawDate.toISOString().slice(0,10):String(rawDate??'').slice(0,10)
      const forecast=Number(item['Forecast']??item['Forecast Total Pedido Normal']??0)
      const skuRaw=item['Média SKU / Pedido']??item['Media SKU / Pedido']
      const mediaSkuPedido=skuRaw==null||skuRaw===''?undefined:Number(skuRaw)
      return{data,forecast,mediaSkuPedido:Number.isFinite(mediaSkuPedido)?mediaSkuPedido:undefined} as ForecastRow
    }).filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.data)&&Number.isFinite(row.forecast)&&row.forecast>=0)
  })
}

export default function ScenarioAnalysisFeature(){
  const[open,setOpen]=useState(false)
  const[navTarget,setNavTarget]=useState<Element|null>(null)
  const[workspaceTarget,setWorkspaceTarget]=useState<Element|null>(null)
  const[depositors,setDepositors]=useState<DbDepositor[]>([])
  const[selectedId,setSelectedId]=useState('')
  const[holidays,setHolidays]=useState<Set<string>>(new Set())
  const[rows,setRows]=useState<ForecastRow[]>([])
  const[fileName,setFileName]=useState('')
  const[message,setMessage]=useState('')
  const[operatingDays,setOperatingDays]=useState<ScenarioOperatingDays>({sabado:false,domingo:false,feriado:false})

  useEffect(()=>{
    const resolveTargets=()=>{
      setNavTarget(document.querySelector('.sidebar-nav'))
      setWorkspaceTarget(document.querySelector('.workspace'))
    }
    resolveTargets()
    const observer=new MutationObserver(resolveTargets)
    observer.observe(document.body,{childList:true,subtree:true})
    return()=>observer.disconnect()
  },[])

  useEffect(()=>{
    const nav=document.querySelector('.sidebar-nav')
    if(!nav)return
    const handler=(event:Event)=>{
      const target=event.target as HTMLElement|null
      if(!target?.closest('[data-scenario-nav="true"]'))setOpen(false)
    }
    nav.addEventListener('click',handler)
    return()=>nav.removeEventListener('click',handler)
  },[navTarget])

  useEffect(()=>{
    document.body.classList.toggle('scenario-analysis-open',open)
    const navButtons=Array.from(document.querySelectorAll('.sidebar-nav button')) as HTMLButtonElement[]
    if(open){
      navButtons.forEach(button=>{
        if(!button.matches('[data-scenario-nav="true"]')&&button.classList.contains('active')){
          button.dataset.scenarioWasActive='true'
          button.classList.remove('active')
        }
      })
    }else{
      navButtons.forEach(button=>{
        if(button.dataset.scenarioWasActive==='true'){
          button.classList.add('active')
          delete button.dataset.scenarioWasActive
        }
      })
    }
    return()=>document.body.classList.remove('scenario-analysis-open')
  },[open])

  useEffect(()=>{
    if(!open||!supabase)return
    let cancelled=false
    Promise.all([
      supabase.from('depositantes').select('*').order('nome'),
      supabase.from('feriados').select('data').eq('feriado_operacional',true).order('data'),
    ]).then(([depsResult,holidaysResult])=>{
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
      const preferred=clean.find(d=>d.id===topbarValue)?.id??clean.find(d=>d.ativo)?.id??clean[0]?.id??''
      setSelectedId(current=>clean.some(d=>d.id===current)?current:preferred)
      if(holidaysResult.error)setMessage(holidaysResult.error.message)
      else setHolidays(new Set((holidaysResult.data??[]).map((row:any)=>String(row.data).slice(0,10))))
    })
    return()=>{cancelled=true}
  },[open])

  useEffect(()=>{
    if(!open)return
    const select=document.querySelector('.topbar-select select') as HTMLSelectElement|null
    if(!select)return
    const sync=()=>{if(depositors.some(d=>d.id===select.value))setSelectedId(select.value)}
    select.addEventListener('change',sync)
    return()=>select.removeEventListener('change',sync)
  },[open,depositors])

  const activeDepositor=depositors.find(d=>d.id===selectedId)

  useEffect(()=>{
    if(activeDepositor)setOperatingDays(defaultScenarioOperatingDays(activeDepositor))
  },[selectedId])

  const analysis=useMemo(()=>activeDepositor?analyzeScenario(rows,activeDepositor,holidays,operatingDays):null,[rows,activeDepositor,holidays,operatingDays])
  const days=analysis?.days??[]
  const summary=analysis?.summary

  async function onFile(file:File){
    setMessage('')
    try{
      const parsed=await parseForecastFile(file)
      setRows(parsed)
      setFileName(file.name)
      if(!parsed.length)setMessage('Nenhuma linha válida encontrada. Use as colunas Data e Forecast.')
    }catch(error){
      setRows([])
      setFileName('')
      setMessage(error instanceof Error?error.message:'Não foi possível ler o arquivo.')
    }
  }

  function toggleOperatingDay(key:keyof ScenarioOperatingDays){
    setOperatingDays(prev=>({...prev,[key]:!prev[key]}))
  }

  function exportAnalysis(){
    if(!summary||!activeDepositor||!days.length)return
    const summaryRows=[
      {Indicador:'Depositante',Valor:activeDepositor.nome},
      {Indicador:'Arquivo',Valor:fileName||'—'},
      {Indicador:'Operar sábado',Valor:operatingDays.sabado?'Sim':'Não'},
      {Indicador:'Operar domingo',Valor:operatingDays.domingo?'Sim':'Não'},
      {Indicador:'Operar feriado',Valor:operatingDays.feriado?'Sim':'Não'},
      {Indicador:'Checkouts atuais',Valor:summary.currentCheckouts},
      {Indicador:'Capacidade atual/dia',Valor:summary.currentCapacity},
      {Indicador:'HC atual',Valor:summary.currentHC},
      {Indicador:'Backlog final AS IS',Valor:summary.finalBacklogAsIs},
      {Indicador:'Pico backlog AS IS',Valor:summary.peakBacklogAsIs},
      {Indicador:'Checkouts necessários no pico',Valor:summary.requiredCheckouts},
      {Indicador:'Capacidade necessária no pico',Valor:summary.requiredCapacity},
      {Indicador:'HC necessário no pico',Valor:summary.requiredHC},
      {Indicador:'Backlog final TO BE',Valor:summary.finalBacklogToBe},
      {Indicador:'Pico backlog TO BE',Valor:summary.peakBacklogToBe},
      {Indicador:'Gap checkouts',Valor:summary.gapCheckouts},
      {Indicador:'Gap capacidade',Valor:summary.gapCapacity},
      {Indicador:'Gap HC',Valor:summary.gapHC},
    ]
    const daily=days.map(row=>({
      Data:date(row.data),'Tipo do dia':row.tipoDia,'Opera no cenário':row.operacaoPlanejada?'Sim':'Não',Forecast:row.forecast,
      'Backlog anterior AS IS':row.backlogAsIsAnterior,'Necessidade AS IS':row.necessidadeAsIs,'Capacidade atual':row.capacidadeAtual,'Produção AS IS':row.producaoAsIs,'Backlog AS IS':row.backlogAsIs,
      'Backlog anterior TO BE':row.backlogToBeAnterior,'Necessidade TO BE':row.necessidadeToBe,'Cap. necessária':row.capacidadeNecessaria,'Produção TO BE':row.producaoToBe,'Backlog TO BE':row.backlogToBe,
      'Checkouts atuais':row.checkoutsAtuais,'Checkouts necessários':row.checkoutsNecessarios,'Gap checkouts':row.gapCheckouts,'HC atual':row.hcAtual,'HC necessário':row.hcNecessario,'Gap HC':row.gapHC,'Limite cadastrado':row.limiteCheckouts,Leitura:row.status,
    }))
    const wb=XLSX.utils.book_new()
    const wsSummary=XLSX.utils.json_to_sheet(summaryRows)
    wsSummary['!cols']=[{wch:30},{wch:24}]
    const wsDaily=XLSX.utils.json_to_sheet(daily)
    wsDaily['!cols']=Array.from({length:22},()=>({wch:18}))
    XLSX.utils.book_append_sheet(wb,wsSummary,'Resumo')
    XLSX.utils.book_append_sheet(wb,wsDaily,'Análise diária')
    const safeName=activeDepositor.nome.replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,'_')
    XLSX.writeFile(wb,`ANALISE_CENARIO_${safeName}.xlsx`)
  }

  const navButton=navTarget?createPortal(
    <button data-scenario-nav="true" className={open?'active scenario-nav-button':'scenario-nav-button'} onClick={()=>setOpen(true)} title="Análise de cenário">
      <span className="material-symbols-rounded material-icon" aria-hidden="true">monitoring</span>
      <span>Análise de cenário</span>
    </button>,navTarget
  ):null

  const page=open&&workspaceTarget?createPortal(
    <div className="scenario-analysis-page">
      <header className="page-header scenario-page-header">
        <div><h1>Análise de cenário</h1><p>Compare a estrutura instalada com a estrutura necessária para absorver o forecast informado.</p></div>
        <div className="header-actions"><button className="secondary-action" onClick={exportAnalysis} disabled={!days.length}><span className="material-symbols-rounded material-icon">download</span>Exportar Excel</button></div>
      </header>

      <section className="scenario-control-bar">
        <label><span>Depositante</span><select value={selectedId} onChange={e=>setSelectedId(e.target.value)}>{depositors.filter(d=>d.ativo).map(d=><option key={d.id} value={d.id}>{d.nome}</option>)}</select></label>
        <div className="scenario-current-context"><span>Estrutura cadastrada</span><b>{activeDepositor?`${activeDepositor.checkouts_atuais} checkouts · ${number(activeDepositor.capacidade_checkout_dia)} pedidos/checkout`:'—'}</b></div>
      </section>

      <section className="section-panel scenario-operating-panel">
        <div className="section-heading"><div><h2>Dias de operação do cenário</h2><p>Defina se a operação funcionará em sábado, domingo e feriados. Dias não operados acumulam demanda para o backlog.</p></div></div>
        <div className="scenario-day-options">
          <label className={operatingDays.sabado?'selected':''}><input type="checkbox" checked={operatingDays.sabado} onChange={()=>toggleOperatingDay('sabado')}/><span><b>Sábado</b><small>Operar aos sábados</small></span></label>
          <label className={operatingDays.domingo?'selected':''}><input type="checkbox" checked={operatingDays.domingo} onChange={()=>toggleOperatingDay('domingo')}/><span><b>Domingo</b><small>Operar aos domingos</small></span></label>
          <label className={operatingDays.feriado?'selected':''}><input type="checkbox" checked={operatingDays.feriado} onChange={()=>toggleOperatingDay('feriado')}/><span><b>Feriados</b><small>Operar em feriados cadastrados</small></span></label>
        </div>
      </section>

      <section className="section-panel scenario-upload-panel">
        <div className="section-heading"><div><h2>Forecast para dimensionamento</h2><p>Este arquivo é independente da Nova simulação. A análise usa a demanda diária para dimensionar a estrutura necessária.</p></div></div>
        <label className={`dropzone ${fileName?'has-file':''}`}>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={e=>e.target.files?.[0]&&onFile(e.target.files[0])}/>
          <span className="material-symbols-rounded material-icon">{fileName?'check_circle':'upload_file'}</span>
          <div><b>{fileName||'Selecionar arquivo de forecast'}</b><small>{fileName?`${rows.length} registros válidos`:'Excel ou CSV · colunas Data e Forecast'}</small></div>
          <span className="secondary-action fake-button">{fileName?'Trocar':'Procurar'}</span>
        </label>
      </section>

      {summary&&rows.length>0?<>
        <section className="scenario-compare-grid">
          <article className="scenario-side-card current"><div className="scenario-card-label">AS IS · Estrutura atual</div><div className="scenario-metric"><span>Checkouts</span><strong>{summary.currentCheckouts}</strong></div><div className="scenario-metric"><span>Capacidade/dia</span><strong>{number(summary.currentCapacity)}</strong></div><div className="scenario-metric"><span>HC estimado</span><strong>{summary.currentHC}</strong></div><div className="scenario-metric backlog"><span>Backlog final</span><strong>{number(summary.finalBacklogAsIs)}</strong><small>Pico: {number(summary.peakBacklogAsIs)}</small></div></article>
          <article className="scenario-gap-card"><span>Gap para o pico</span><strong>{summary.gapCheckouts>0?`+${summary.gapCheckouts} checkouts`:'Sem gap estrutural'}</strong><small>{summary.gapHC>0?`+${summary.gapHC} HC estimados · +${number(summary.gapCapacity)} pedidos/dia de capacidade`:'A estrutura atual absorve o pico quando existe operação.'}</small></article>
          <article className="scenario-side-card needed"><div className="scenario-card-label">TO BE · Necessário</div><div className="scenario-metric"><span>Checkouts necessários</span><strong>{summary.requiredCheckouts}</strong></div><div className="scenario-metric"><span>Cap. necessária</span><strong>{number(summary.requiredCapacity)}</strong></div><div className="scenario-metric"><span>HC necessário</span><strong>{summary.requiredHC}</strong></div><div className="scenario-metric backlog"><span>Backlog final</span><strong>{number(summary.finalBacklogToBe)}</strong><small>Pico: {number(summary.peakBacklogToBe)}</small></div></article>
        </section>

        <section className="scenario-kpis">
          <div><span>Pico do forecast</span><strong>{number(summary.peakForecast)}</strong><small>{summary.peakDate?date(summary.peakDate):'—'}</small></div>
          <div><span>Utilização máxima atual</span><strong>{summary.maxUtilization.toLocaleString('pt-BR',{maximumFractionDigits:1})}%</strong><small>necessidade ÷ capacidade instalada</small></div>
          <div><span>Dias acima da estrutura atual</span><strong>{summary.daysAboveCurrent}</strong><small>{rows.length} dias analisados</small></div>
          <div><span>Dias acima do limite cadastrado</span><strong>{summary.daysAboveConfiguredLimit}</strong><small>indicam expansão estrutural</small></div>
          <div><span>Dias sem operação</span><strong>{summary.daysWithoutOperation}</strong><small>com necessidade acumulada</small></div>
        </section>

        <section className="section-panel table-panel scenario-table-panel">
          <div className="section-heading table-heading"><div><h2>Dimensionamento diário</h2><p>AS IS mostra o saldo com a estrutura atual. TO BE dimensiona a capacidade necessária para zerar a necessidade nos dias marcados para operação.</p></div></div>
          <div className="table-wrap"><table className="scenario-table"><thead><tr><th>Data</th><th>Forecast</th><th>Opera?</th><th>Backlog AS IS</th><th>Cap. atual</th><th>Checkouts atuais</th><th>Backlog TO BE</th><th>Cap. necessária</th><th>Checkouts necessários</th><th>Gap checkouts</th><th>HC atual</th><th>HC necessário</th><th>Gap HC</th><th>Limite</th><th>Leitura</th></tr></thead><tbody>{days.map(row=><tr key={row.data} className={row.status==='Expansão estrutural'?'scenario-critical':row.gapCheckouts>0?'scenario-attention':''}><td className="date-cell">{date(row.data)}<small>{row.tipoDia}</small></td><td>{number(row.forecast)}</td><td>{row.operacaoPlanejada?'Sim':'Não'}</td><td className={row.backlogAsIs>0?'scenario-gap-value':''}>{number(row.backlogAsIs)}</td><td>{number(row.capacidadeAtual)}</td><td>{row.checkoutsAtuais}</td><td className={row.backlogToBe>0?'scenario-gap-value':''}>{number(row.backlogToBe)}</td><td><b>{number(row.capacidadeNecessaria)}</b></td><td><b>{row.checkoutsNecessarios}</b></td><td className={row.gapCheckouts>0?'scenario-gap-value':''}>{row.gapCheckouts>0?`+${row.gapCheckouts}`:'—'}</td><td>{row.hcAtual}</td><td>{row.hcNecessario}</td><td className={row.gapHC>0?'scenario-gap-value':''}>{row.gapHC>0?`+${row.gapHC}`:'—'}</td><td>{row.limiteCheckouts}</td><td><span className={`scenario-status ${row.status.toLowerCase().replaceAll(' ','-').normalize('NFD').replace(/[\u0300-\u036f]/g,'')}`}>{row.status}</span></td></tr>)}</tbody></table></div>
        </section>
      </>:<section className="empty-panel scenario-empty"><span className="material-symbols-rounded material-icon">query_stats</span><div><h2>Importe o forecast para comparar os cenários</h2><p>A estrutura atual será comparada com a necessidade de checkouts, capacidade, headcount e backlog de cada dia.</p></div></section>}
      {message&&<div className="message">{message}</div>}
    </div>,workspaceTarget
  ):null

  return<>{navButton}{page}</>
}
