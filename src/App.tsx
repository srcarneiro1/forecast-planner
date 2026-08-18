import { FormEvent, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { simulate, type Depositor, type ForecastRow } from './engine/simulation'
import { supabase, supabaseConfigured } from './lib/supabase'
import './styles.css'

type Page = 'dashboard' | 'simulation' | 'history' | 'parameters'
type DbDepositor = Depositor & { id: string; ativo: boolean }
type Profile = { nome: string | null; perfil: string }
type IconName =
  | 'analytics'
  | 'upload_file'
  | 'history'
  | 'tune'
  | 'menu'
  | 'menu_open'
  | 'close'
  | 'logout'
  | 'login'
  | 'download'
  | 'add'
  | 'save'
  | 'delete'
  | 'warehouse'
  | 'inventory_2'
  | 'groups'
  | 'monitoring'
  | 'check_circle'
  | 'warning'
  | 'arrow_forward'
  | 'table_chart'
  | 'database'
  | 'settings'
  | 'expand_more'

const fallbackDemo: Depositor = {
  nome: 'MARCA DEMO', escala: '5x2', jornada: 'SEG a SEX', horas_trabalhadas_dia: 9,
  capacidade_checkout_dia: 500, pessoas_por_checkout: 1, pessoas_separando: 7,
  pessoas_embalando: 9, pessoas_embalagem_caixa: 4, pessoas_roteirizando: 0,
  pessoas_ressuprindo: 0, checkouts_atuais: 7, checkouts_maximos: 9, tipo_colmeia: 'Fixa',
  dimensionamento_apoios: 'Fixo por turno', horas_extra_max_dia_util: 2,
  horas_operacao_extra_sabado: 10, horas_operacao_extra_dom_feriado: 10,
}

const blankDepositor: Omit<DbDepositor, 'id'> = { ...fallbackDemo, nome: '', ativo: true }

function MaterialIcon({ name, size = 20, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return <span className="material-symbols-rounded material-icon" style={{ fontSize: size, fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 500, 'GRAD' 0, 'opsz' ${size}` }} aria-hidden="true">{name}</span>
}

const pageMeta: Record<Page, { eyebrow: string; title: string; description: string }> = {
  dashboard: { eyebrow: 'VISÃO GERAL', title: 'Dashboard', description: 'Resumo executivo do cenário operacional carregado.' },
  simulation: { eyebrow: 'PLANEJAMENTO OPERACIONAL', title: 'Nova Simulação', description: 'Importe o forecast e valide capacidade, headcount e backlog diário.' },
  history: { eyebrow: 'PLANEJAMENTO OPERACIONAL', title: 'Histórico', description: 'Consulte os cenários salvos e acompanhe a evolução do planejamento.' },
  parameters: { eyebrow: 'CONFIGURAÇÃO OPERACIONAL', title: 'Parâmetros', description: 'Premissas utilizadas pelo motor de capacidade e dimensionamento.' },
}

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [rows, setRows] = useState<ForecastRow[]>([])
  const [file, setFile] = useState('')
  const [depositors, setDepositors] = useState<DbDepositor[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState<Omit<DbDepositor, 'id'>>(blankDepositor)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [dataMessage, setDataMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const selectedDepositor = depositors.find(d => d.id === selectedId)
  const activeDepositor: Depositor = selectedDepositor ?? depositors[0] ?? fallbackDemo
  const results = useMemo(() => simulate(rows, activeDepositor), [rows, activeDepositor])
  const total = results.reduce((s, r) => s + r.forecast, 0)
  const totalCapacity = results.reduce((s, r) => s + r.capacidade, 0)
  const backlog = results.at(-1)?.backlogFinal ?? 0
  const peakHC = results.reduce((max, r) => Math.max(max, r.hcTotal), 0)
  const peakCheckouts = results.reduce((max, r) => Math.max(max, r.checkouts), 0)
  const backlogDays = results.filter(r => r.backlogFinal > 0).length
  const utilization = totalCapacity > 0 ? Math.min(100, Math.round((total / totalCapacity) * 100)) : 0
  const isAdmin = profile?.perfil === 'admin'
  const meta = pageMeta[page]

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) loadUserData(data.user.id)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) loadUserData(session.user.id)
      else {
        setProfile(null)
        setDepositors([])
        setSelectedId('')
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (selectedDepositor) {
      const { id: _id, ...rest } = selectedDepositor
      setForm(rest)
    }
  }, [selectedId, depositors])

  async function loadUserData(userId: string) {
    if (!supabase) return
    const [{ data: p }, { data: deps, error }] = await Promise.all([
      supabase.from('profiles').select('nome,perfil').eq('id', userId).maybeSingle(),
      supabase.from('depositantes').select('*').order('nome'),
    ])
    if (p) setProfile(p as Profile)
    if (error) setDataMessage(error.message)
    else {
      const clean = (deps ?? []).map((d: any) => ({
        ...d,
        horas_trabalhadas_dia: Number(d.horas_trabalhadas_dia),
        capacidade_checkout_dia: Number(d.capacidade_checkout_dia),
        horas_extra_max_dia_util: Number(d.horas_extra_max_dia_util),
        horas_operacao_extra_sabado: Number(d.horas_operacao_extra_sabado),
        horas_operacao_extra_dom_feriado: Number(d.horas_operacao_extra_dom_feriado),
      })) as DbDepositor[]
      setDepositors(clean)
      if (clean.length && !selectedId) setSelectedId(clean[0].id)
    }
  }

  async function authSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setLoading(true); setAuthMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthMessage(error.message)
    setLoading(false)
  }

  async function signUp() {
    if (!supabase) return
    setLoading(true); setAuthMessage('')
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { nome: email.split('@')[0] } } })
    setAuthMessage(error ? error.message : 'Cadastro criado. Se a confirmação de e-mail estiver ativa, confirme o e-mail antes de entrar.')
    setLoading(false)
  }

  async function signOut() {
    await supabase?.auth.signOut()
    setProfile(null)
  }

  async function onFile(f: File) {
    const b = await f.arrayBuffer()
    const wb = XLSX.read(b, { type: 'array', cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
    const parsed = data.map(x => {
      const raw = x['Data']
      const d = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw ?? '').slice(0, 10)
      const fc = Number(x['Forecast'] ?? 0)
      return { data: d, forecast: fc }
    }).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.data) && Number.isFinite(x.forecast) && x.forecast >= 0)
    setRows(parsed); setFile(f.name)
  }

  function downloadTemplate() {
    const sample = [
      { Data: '2026-11-23', Forecast: 3200, 'Média SKU / Pedido': 3.2, Observação: '' },
      { Data: '2026-11-24', Forecast: 4100, 'Média SKU / Pedido': 3.2, Observação: '' },
      { Data: '2026-11-25', Forecast: 5200, 'Média SKU / Pedido': 3.4, Observação: '' },
      { Data: '2026-11-26', Forecast: 6100, 'Média SKU / Pedido': 3.6, Observação: '' },
      { Data: '2026-11-27', Forecast: 7200, 'Média SKU / Pedido': 3.8, Observação: 'Pico promocional' },
    ]
    const ws = XLSX.utils.json_to_sheet(sample)
    ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 28 }]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Forecast')
    XLSX.writeFile(wb, 'MODELO_FORECAST.xlsx')
  }

  function numberField<K extends keyof typeof form>(key: K, value: string) {
    setForm(prev => ({ ...prev, [key]: Number(value) }))
  }

  async function saveDepositor() {
    if (!supabase || !isAdmin) return
    setLoading(true); setDataMessage('')
    const payload = { ...form, updated_at: new Date().toISOString() } as any
    let error
    if (selectedId) ({ error } = await supabase.from('depositantes').update(payload).eq('id', selectedId))
    else ({ error } = await supabase.from('depositantes').insert(payload))
    setDataMessage(error ? error.message : 'Parâmetros salvos com sucesso.')
    const { data: { user } } = await supabase.auth.getUser()
    if (!error && user) await loadUserData(user.id)
    setLoading(false)
  }

  async function deleteDepositor() {
    if (!supabase || !isAdmin || !selectedId) return
    if (!confirm('Excluir este depositante?')) return
    const { error } = await supabase.from('depositantes').delete().eq('id', selectedId)
    setDataMessage(error ? error.message : 'Depositante excluído.')
    if (!error) { setSelectedId(''); setForm(blankDepositor) }
    const { data: { user } } = await supabase.auth.getUser()
    if (user) await loadUserData(user.id)
  }

  function navigate(nextPage: Page) {
    setPage(nextPage)
    setMobileMenuOpen(false)
  }

  const setText = (key: keyof typeof form, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value } as any))

  if (!supabaseConfigured) return <div className="setup-screen"><div className="panel setup-panel"><div className="setup-icon"><MaterialIcon name="settings" size={28}/></div><h1>Forecast Planner</h1><p>O aplicativo está publicado, mas as variáveis do Supabase ainda não foram configuradas no Cloudflare.</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code></div></div>

  return <div className={`shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileMenuOpen ? 'mobile-menu-open' : ''}`}>
    <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />
    <aside className="sidebar">
      <div className="sidebar-head">
        <button className="brand" onClick={() => navigate('dashboard')} aria-label="Ir para dashboard">
          <span className="brand-mark"><MaterialIcon name="monitoring" size={22} filled/></span>
          <span className="brand-copy"><b>Forecast</b><small>Planner</small></span>
        </button>
        <button className="icon-button collapse-button" onClick={() => setSidebarCollapsed(v => !v)} aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}>
          <MaterialIcon name={sidebarCollapsed ? 'menu' : 'menu_open'} size={21}/>
        </button>
        <button className="icon-button mobile-close" onClick={() => setMobileMenuOpen(false)} aria-label="Fechar menu"><MaterialIcon name="close" size={22}/></button>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <span className="nav-label">Visão geral</span>
          <button className={page === 'dashboard' ? 'active' : ''} onClick={() => navigate('dashboard')} title="Dashboard"><MaterialIcon name="analytics"/><span>Dashboard</span></button>
        </div>
        <div className="nav-section">
          <span className="nav-label">Planejamento</span>
          <button className={page === 'simulation' ? 'active' : ''} onClick={() => navigate('simulation')} title="Nova Simulação"><MaterialIcon name="upload_file"/><span>Nova Simulação</span></button>
          <button className={page === 'history' ? 'active' : ''} onClick={() => navigate('history')} title="Histórico"><MaterialIcon name="history"/><span>Histórico</span></button>
        </div>
        <div className="nav-section">
          <span className="nav-label">Gestão</span>
          <button className={page === 'parameters' ? 'active' : ''} onClick={() => navigate('parameters')} title="Parâmetros"><MaterialIcon name="tune"/><span>Parâmetros</span></button>
        </div>
      </nav>

      {profile ? <div className="user-card">
        <div className="user-avatar">{(profile.nome ?? 'U').slice(0, 1).toUpperCase()}</div>
        <div className="user-copy"><span>{profile.nome ?? 'Usuário'}</span><small>{profile.perfil}</small></div>
        <button className="icon-button signout-button" onClick={signOut} title="Sair" aria-label="Sair"><MaterialIcon name="logout" size={19}/></button>
      </div> : <div className="sidebar-status"><span className="status-dot"/><span>Supabase conectado</span></div>}
    </aside>

    <div className="workspace">
      <div className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-menu-button" onClick={() => setMobileMenuOpen(true)} aria-label="Abrir menu"><MaterialIcon name="menu" size={23}/></button>
          <div className="breadcrumb"><span>Forecast Planner</span><MaterialIcon name="arrow_forward" size={15}/><b>{meta.title}</b></div>
        </div>
        <div className="topbar-right">
          {depositors.length > 0 && <label className="topbar-select"><span>Depositante</span><select value={selectedId} onChange={e => setSelectedId(e.target.value)}>{depositors.filter(d => d.ativo).map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}</select><MaterialIcon name="expand_more" size={18}/></label>}
          {profile && <div className="profile-chip"><div className="mini-avatar">{(profile.nome ?? 'U').slice(0, 1).toUpperCase()}</div><div><span>{profile.nome ?? 'Usuário'}</span><small>{isAdmin ? 'Administrador' : 'Usuário'}</small></div></div>}
        </div>
      </div>

      <main>
        {!profile && <section className="auth-banner">
          <div className="auth-copy"><span className="auth-icon"><MaterialIcon name="login" size={22}/></span><div><h2>Acessar dados operacionais</h2><p>Entre para carregar depositantes e administrar os parâmetros.</p></div></div>
          <form onSubmit={authSubmit} className="auth-form"><input type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} required/><input type="password" placeholder="Senha" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required/><button className="primary-action" disabled={loading}><MaterialIcon name="login" size={18}/>Entrar</button><button type="button" className="secondary-action" onClick={signUp} disabled={loading}>Criar conta</button></form>
          {authMessage && <div className="message auth-message">{authMessage}</div>}
        </section>}

        <header className="page-header">
          <div><span className="eyebrow">{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.description}</p></div>
          {page === 'simulation' && <button className="secondary-action header-action" onClick={downloadTemplate}><MaterialIcon name="download" size={18}/>Baixar modelo</button>}
        </header>

        {page === 'dashboard' && <>
          <section className="hero-panel">
            <div className="hero-copy"><span className="hero-kicker">CENÁRIO ATUAL</span><h2>{activeDepositor.nome}</h2><p>{results.length > 0 ? `Cenário calculado a partir de ${results.length} dias de forecast.` : 'Carregue um forecast para transformar as premissas operacionais em um cenário de capacidade.'}</p><button className="primary-action" onClick={() => navigate('simulation')}><MaterialIcon name="upload_file" size={18}/>{results.length > 0 ? 'Revisar simulação' : 'Criar simulação'}</button></div>
            <div className="hero-capacity"><span>Capacidade por checkout</span><strong>{activeDepositor.capacidade_checkout_dia.toLocaleString('pt-BR')}</strong><small>{activeDepositor.horas_trabalhadas_dia}h de jornada base</small><div className="capacity-track"><span style={{ width: `${results.length ? utilization : Math.min(100, Math.round((activeDepositor.checkouts_atuais / Math.max(activeDepositor.checkouts_maximos, 1)) * 100))}%` }}/></div><div className="capacity-caption"><span>{activeDepositor.checkouts_atuais} atuais</span><span>{activeDepositor.checkouts_maximos} máximos</span></div></div>
          </section>

          <section className="metric-grid">
            <article className="metric-card"><span className="metric-icon purple"><MaterialIcon name="inventory_2"/></span><div><span>Forecast total</span><strong>{total.toLocaleString('pt-BR')}</strong><small>{results.length ? `${results.length} dias carregados` : 'Aguardando arquivo'}</small></div></article>
            <article className={`metric-card ${backlog > 0 ? 'attention' : ''}`}><span className="metric-icon amber"><MaterialIcon name={backlog > 0 ? 'warning' : 'check_circle'}/></span><div><span>Backlog final</span><strong>{backlog.toLocaleString('pt-BR')}</strong><small>{backlogDays > 0 ? `${backlogDays} dias com saldo` : results.length ? 'Cenário sem backlog final' : 'Aguardando simulação'}</small></div></article>
            <article className="metric-card"><span className="metric-icon blue"><MaterialIcon name="groups"/></span><div><span>Pico de HC</span><strong>{peakHC || '—'}</strong><small>{results.length ? `Até ${peakCheckouts} checkouts` : 'Será calculado por dia'}</small></div></article>
            <article className="metric-card"><span className="metric-icon green"><MaterialIcon name="monitoring"/></span><div><span>Ocupação estimada</span><strong>{results.length ? `${utilization}%` : '—'}</strong><small>{results.length ? `${totalCapacity.toLocaleString('pt-BR')} de capacidade somada` : 'Forecast x capacidade'}</small></div></article>
          </section>

          <section className="dashboard-grid">
            <article className="panel overview-panel"><div className="panel-heading"><div><span className="section-kicker">OPERAÇÃO</span><h2>Premissas ativas</h2></div><button className="text-action" onClick={() => navigate('parameters')}>Ver parâmetros <MaterialIcon name="arrow_forward" size={16}/></button></div><div className="overview-list"><div><span>Escala</span><b>{activeDepositor.escala} · {activeDepositor.jornada}</b></div><div><span>Checkouts</span><b>{activeDepositor.checkouts_atuais} atuais / {activeDepositor.checkouts_maximos} máx.</b></div><div><span>Colmeia</span><b>{activeDepositor.tipo_colmeia}</b></div><div><span>Dimensionamento</span><b>{activeDepositor.dimensionamento_apoios}</b></div></div></article>
            <article className="panel next-step-panel"><span className="section-kicker">PRÓXIMO PASSO</span><div className="next-step-icon"><MaterialIcon name={results.length ? 'table_chart' : 'upload_file'} size={26}/></div><h2>{results.length ? 'Planejamento disponível' : 'Importe o forecast'}</h2><p>{results.length ? 'Revise dias críticos, ações sugeridas, checkouts e headcount antes de salvar o cenário.' : 'Use o modelo padronizado para carregar Data e Forecast. O cálculo é feito imediatamente no navegador.'}</p><button className="secondary-action" onClick={() => navigate('simulation')}>{results.length ? 'Abrir planejamento' : 'Ir para simulação'}<MaterialIcon name="arrow_forward" size={17}/></button></article>
          </section>
        </>}

        {page === 'simulation' && <>
          <section className="stepper" aria-label="Etapas da simulação">
            <div className="step complete"><span>1</span><div><b>Depositante</b><small>{activeDepositor.nome}</small></div></div>
            <div className={`step ${file ? 'complete' : 'active'}`}><span>2</span><div><b>Forecast</b><small>{file ? 'Arquivo validado' : 'Importar arquivo'}</small></div></div>
            <div className={`step ${results.length ? 'active' : ''}`}><span>3</span><div><b>Planejamento</b><small>{results.length ? `${results.length} dias calculados` : 'Aguardando forecast'}</small></div></div>
          </section>

          <section className="metric-grid simulation-metrics">
            <article className="metric-card compact"><span className="metric-icon purple"><MaterialIcon name="warehouse"/></span><div><span>Depositante</span><strong className="text-value">{activeDepositor.nome}</strong><small>{activeDepositor.escala} · {activeDepositor.jornada}</small></div></article>
            <article className="metric-card compact"><span className="metric-icon blue"><MaterialIcon name="inventory_2"/></span><div><span>Forecast total</span><strong>{total.toLocaleString('pt-BR')}</strong><small>{results.length ? `${results.length} dias` : 'Sem arquivo'}</small></div></article>
            <article className={`metric-card compact ${backlog > 0 ? 'attention' : ''}`}><span className="metric-icon amber"><MaterialIcon name={backlog > 0 ? 'warning' : 'check_circle'}/></span><div><span>Backlog final</span><strong>{backlog.toLocaleString('pt-BR')}</strong><small>{backlogDays ? `${backlogDays} dias com saldo` : 'Sem saldo final'}</small></div></article>
            <article className="metric-card compact"><span className="metric-icon green"><MaterialIcon name="groups"/></span><div><span>Pico de HC</span><strong>{peakHC || '—'}</strong><small>{peakCheckouts ? `${peakCheckouts} checkouts no pico` : 'Aguardando cálculo'}</small></div></article>
          </section>

          <section className="panel upload-panel">
            <div className="panel-heading upload-heading"><div><span className="section-kicker">ENTRADA DE DADOS</span><h2>Arquivo de Forecast</h2><p>Use o modelo padronizado com as colunas <b>Data</b> e <b>Forecast</b>.</p></div><button className="secondary-action desktop-template" onClick={downloadTemplate}><MaterialIcon name="download" size={18}/>Baixar modelo</button></div>
            <label className={`dropzone ${file ? 'has-file' : ''}`}>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}/>
              <span className="dropzone-icon"><MaterialIcon name={file ? 'check_circle' : 'upload_file'} size={30}/></span>
              <div><b>{file ? file : 'Selecione o arquivo aqui'}</b><small>{file ? `${rows.length} registros válidos identificados` : 'Excel ou CSV · processamento local no navegador'}</small></div>
              <span className="secondary-action fake-button">{file ? 'Trocar arquivo' : 'Selecionar arquivo'}</span>
            </label>
          </section>

          {results.length > 0 ? <section className="panel table-panel"><div className="panel-heading"><div><span className="section-kicker">RESULTADO</span><h2>Planejamento diário</h2><p>Capacidade, headcount e ação recomendada por dia.</p></div><div className={`result-status ${backlog > 0 ? 'warning' : 'success'}`}><MaterialIcon name={backlog > 0 ? 'warning' : 'check_circle'} size={18}/><span>{backlog > 0 ? 'Requer atenção' : 'Capacidade atende'}</span></div></div><div className="table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Forecast</th><th>Backlog ant.</th><th>Ação</th><th>Checkouts</th><th>Capacidade</th><th>HC</th><th>Backlog final</th></tr></thead><tbody>{results.map(r => <tr key={r.data} className={r.backlogFinal > 0 ? 'row-attention' : ''}><td className="date-cell">{new Date(r.data + 'T12:00:00').toLocaleDateString('pt-BR')}</td><td><span className={'pill ' + (r.dentroEscala ? 'ok' : 'warn')}>{r.tipoDia}</span></td><td>{r.forecast.toLocaleString('pt-BR')}</td><td>{r.backlogAnterior.toLocaleString('pt-BR')}</td><td><span className="action-chip">{r.acao}</span></td><td>{r.checkouts}</td><td>{r.capacidade.toLocaleString('pt-BR')}</td><td>{r.hcTotal}</td><td className={r.backlogFinal > 0 ? 'backlog-value' : ''}>{r.backlogFinal.toLocaleString('pt-BR')}</td></tr>)}</tbody></table></div></section> : <section className="panel simulation-empty"><span><MaterialIcon name="table_chart" size={30}/></span><div><h2>Planejamento ainda não calculado</h2><p>Importe o forecast acima. A tabela diária será gerada automaticamente.</p></div></section>}
        </>}

        {page === 'history' && <section className="panel empty-state"><span className="empty-icon"><MaterialIcon name="database" size={32}/></span><h2>Nenhuma simulação salva</h2><p>O histórico será conectado quando a persistência das simulações for implementada.</p><button className="secondary-action" onClick={() => navigate('simulation')}><MaterialIcon name="upload_file" size={18}/>Criar nova simulação</button></section>}

        {page === 'parameters' && <>
          {!profile ? <section className="panel empty-state"><span className="empty-icon"><MaterialIcon name="login" size={32}/></span><h2>Faça login para carregar os parâmetros</h2><p>Os depositantes e suas premissas são carregados do Supabase.</p></section> : <>
            <section className="parameter-toolbar"><div><span className="section-kicker">DEPOSITANTE</span><label className="parameter-select"><select value={selectedId} onChange={e => setSelectedId(e.target.value)}><option value="">Novo depositante</option>{depositors.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}</select><MaterialIcon name="expand_more" size={19}/></label></div>{isAdmin && <button className="secondary-action" onClick={() => { setSelectedId(''); setForm(blankDepositor) }}><MaterialIcon name="add" size={18}/>Novo depositante</button>}</section>

            <section className="parameter-grid">
              <div className="panel form-panel"><div className="form-panel-heading"><span className="form-icon"><MaterialIcon name="warehouse" size={20}/></span><div><h2>Identificação e escala</h2><p>Estrutura base da jornada operacional.</p></div></div><div className="form-grid"><label>Nome<input value={form.nome} disabled={!isAdmin} onChange={e => setText('nome', e.target.value)}/></label><label>Escala<select value={form.escala} disabled={!isAdmin} onChange={e => setText('escala', e.target.value)}><option>5x2</option><option>4x3</option></select></label><label>Jornada<select value={form.jornada} disabled={!isAdmin} onChange={e => setText('jornada', e.target.value)}><option>SEG a SEX</option><option>DOM a QUA</option><option>QUA a SÁB</option></select></label><label>Tipo de colmeia<select value={form.tipo_colmeia} disabled={!isAdmin} onChange={e => setText('tipo_colmeia', e.target.value)}><option>Fixa</option><option>Móvel</option><option>Não se aplica</option></select></label><label className="checkbox"><input type="checkbox" checked={form.ativo} disabled={!isAdmin} onChange={e => setText('ativo', e.target.checked)}/><span>Depositante ativo</span></label></div></div>

              <div className="panel form-panel"><div className="form-panel-heading"><span className="form-icon"><MaterialIcon name="monitoring" size={20}/></span><div><h2>Capacidade</h2><p>Produtividade, checkouts e jornadas extraordinárias.</p></div></div><div className="form-grid"><label>Horas base<input type="number" step="0.5" value={form.horas_trabalhadas_dia} disabled={!isAdmin} onChange={e => numberField('horas_trabalhadas_dia', e.target.value)}/></label><label>Capacidade / checkout<input type="number" value={form.capacidade_checkout_dia} disabled={!isAdmin} onChange={e => numberField('capacidade_checkout_dia', e.target.value)}/></label><label>Checkouts atuais<input type="number" value={form.checkouts_atuais} disabled={!isAdmin} onChange={e => numberField('checkouts_atuais', e.target.value)}/></label><label>Checkouts máximos<input type="number" value={form.checkouts_maximos} disabled={!isAdmin} onChange={e => numberField('checkouts_maximos', e.target.value)}/></label><label>HE máx. dia útil<input type="number" step="0.5" value={form.horas_extra_max_dia_util} disabled={!isAdmin} onChange={e => numberField('horas_extra_max_dia_util', e.target.value)}/></label><label>Horas operação sábado<input type="number" step="0.5" value={form.horas_operacao_extra_sabado} disabled={!isAdmin} onChange={e => numberField('horas_operacao_extra_sabado', e.target.value)}/></label><label>Horas operação dom./feriado<input type="number" step="0.5" value={form.horas_operacao_extra_dom_feriado} disabled={!isAdmin} onChange={e => numberField('horas_operacao_extra_dom_feriado', e.target.value)}/></label></div></div>

              <div className="panel form-panel full-span"><div className="form-panel-heading"><span className="form-icon"><MaterialIcon name="groups" size={20}/></span><div><h2>Headcount</h2><p>Composição do HC por checkout e estruturas de apoio.</p></div></div><div className="form-grid headcount-grid"><label>Pessoas / checkout<input type="number" value={form.pessoas_por_checkout} disabled={!isAdmin} onChange={e => numberField('pessoas_por_checkout', e.target.value)}/></label><label>Separando<input type="number" value={form.pessoas_separando} disabled={!isAdmin} onChange={e => numberField('pessoas_separando', e.target.value)}/></label><label>Embalando<input type="number" value={form.pessoas_embalando} disabled={!isAdmin} onChange={e => numberField('pessoas_embalando', e.target.value)}/></label><label>Embalagem / caixa<input type="number" value={form.pessoas_embalagem_caixa} disabled={!isAdmin} onChange={e => numberField('pessoas_embalagem_caixa', e.target.value)}/></label><label>Roteirizando<input type="number" value={form.pessoas_roteirizando} disabled={!isAdmin} onChange={e => numberField('pessoas_roteirizando', e.target.value)}/></label><label>Ressuprindo<input type="number" value={form.pessoas_ressuprindo} disabled={!isAdmin} onChange={e => numberField('pessoas_ressuprindo', e.target.value)}/></label><label>Dimensionamento<select value={form.dimensionamento_apoios} disabled={!isAdmin} onChange={e => setText('dimensionamento_apoios', e.target.value)}><option>Fixo por turno</option><option>Por checkout</option></select></label></div></div>
            </section>

            <div className="sticky-actions">{isAdmin ? <><div className="save-copy"><span>Alterações de parâmetros</span><small>Revise os valores antes de salvar.</small></div><div className="actions"><button className="primary-action" onClick={saveDepositor} disabled={loading || !form.nome}><MaterialIcon name="save" size={18}/>Salvar parâmetros</button>{selectedId && <button className="danger-action" onClick={deleteDepositor}><MaterialIcon name="delete" size={18}/>Excluir</button>}</div></> : <span className="readonly-note">Perfil somente leitura. Um administrador pode alterar os parâmetros.</span>}</div>
            {dataMessage && <div className="message">{dataMessage}</div>}
          </>}
        </>}
      </main>
    </div>
  </div>
}
