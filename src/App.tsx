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
  | 'monitoring'
  | 'check_circle'
  | 'warning'
  | 'chevron_right'
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

function MaterialIcon({ name, size = 19 }: { name: IconName; size?: number }) {
  return <span className="material-symbols-rounded material-icon" style={{ fontSize: size, fontVariationSettings: `'FILL' 0, 'wght' 450, 'GRAD' 0, 'opsz' ${size}` }} aria-hidden="true">{name}</span>
}

const pageMeta: Record<Page, { title: string; description: string }> = {
  dashboard: { title: 'Dashboard', description: 'Visão consolidada do cenário operacional.' },
  simulation: { title: 'Nova simulação', description: 'Importe o forecast e valide capacidade, headcount e backlog.' },
  history: { title: 'Histórico', description: 'Consulte os cenários salvos anteriormente.' },
  parameters: { title: 'Parâmetros', description: 'Premissas utilizadas pelo motor de capacidade.' },
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
  const hasDepositor = Boolean(selectedDepositor ?? depositors[0])
  const activeDepositor: Depositor = selectedDepositor ?? depositors[0] ?? fallbackDemo
  const activeName = hasDepositor ? activeDepositor.nome : 'Nenhuma operação selecionada'
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

  if (!supabaseConfigured) return <div className="setup-screen"><div className="setup-panel"><MaterialIcon name="settings" size={26}/><h1>Forecast Planner</h1><p>As variáveis do Supabase ainda não foram configuradas no ambiente publicado.</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code></div></div>

  return <div className={`shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileMenuOpen ? 'mobile-menu-open' : ''}`}>
    <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />
    <aside className="sidebar">
      <div className="sidebar-head">
        <button className="brand" onClick={() => navigate('dashboard')} aria-label="Ir para dashboard">
          <span className="brand-mark"><MaterialIcon name="monitoring" size={20}/></span>
          <span className="brand-copy"><b>Forecast Planner</b><small>Planejamento operacional</small></span>
        </button>
        <button className="icon-button collapse-button" onClick={() => setSidebarCollapsed(v => !v)} aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}><MaterialIcon name={sidebarCollapsed ? 'menu' : 'menu_open'} size={20}/></button>
        <button className="icon-button mobile-close" onClick={() => setMobileMenuOpen(false)} aria-label="Fechar menu"><MaterialIcon name="close" size={20}/></button>
      </div>

      <nav className="sidebar-nav">
        <button className={page === 'dashboard' ? 'active' : ''} onClick={() => navigate('dashboard')} title="Dashboard"><MaterialIcon name="analytics"/><span>Dashboard</span></button>
        <button className={page === 'simulation' ? 'active' : ''} onClick={() => navigate('simulation')} title="Nova simulação"><MaterialIcon name="upload_file"/><span>Nova simulação</span></button>
        <button className={page === 'history' ? 'active' : ''} onClick={() => navigate('history')} title="Histórico"><MaterialIcon name="history"/><span>Histórico</span></button>
        <div className="nav-divider" />
        <button className={page === 'parameters' ? 'active' : ''} onClick={() => navigate('parameters')} title="Parâmetros"><MaterialIcon name="tune"/><span>Parâmetros</span></button>
      </nav>

      {profile && <div className="user-card">
        <div className="user-avatar">{(profile.nome ?? 'U').slice(0, 1).toUpperCase()}</div>
        <div className="user-copy"><span>{profile.nome ?? 'Usuário'}</span><small>{isAdmin ? 'Administrador' : 'Usuário'}</small></div>
        <button className="icon-button signout-button" onClick={signOut} title="Sair" aria-label="Sair"><MaterialIcon name="logout" size={18}/></button>
      </div>}
    </aside>

    <div className="workspace">
      <div className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-menu-button" onClick={() => setMobileMenuOpen(true)} aria-label="Abrir menu"><MaterialIcon name="menu" size={21}/></button>
          <span className="current-page">{meta.title}</span>
        </div>
        <div className="topbar-right">
          {profile && depositors.length > 0 && <label className="topbar-select"><select aria-label="Depositante" value={selectedId} onChange={e => setSelectedId(e.target.value)}>{depositors.filter(d => d.ativo).map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}</select><MaterialIcon name="expand_more" size={17}/></label>}
          {profile && <div className="profile-chip"><div className="mini-avatar">{(profile.nome ?? 'U').slice(0, 1).toUpperCase()}</div><span>{profile.nome ?? 'Usuário'}</span></div>}
        </div>
      </div>

      <main>
        {!profile ? <section className="login-layout">
          <div className="login-intro">
            <span className="product-label">Forecast Planner</span>
            <h1>Planejamento de capacidade operacional</h1>
            <p>Centralize premissas, importe o forecast e simule capacidade, headcount e backlog em um único fluxo.</p>
          </div>
          <div className="login-card">
            <div className="login-card-head"><h2>Acessar</h2><p>Entre com sua conta para continuar.</p></div>
            <form onSubmit={authSubmit} className="login-form">
              <label>E-mail<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"/></label>
              <label>Senha<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required autoComplete="current-password"/></label>
              <button className="primary-action full-button" disabled={loading}><MaterialIcon name="login" size={18}/>{loading ? 'Entrando...' : 'Entrar'}</button>
              <button type="button" className="link-action" onClick={signUp} disabled={loading}>Criar uma conta</button>
            </form>
            {authMessage && <div className="message">{authMessage}</div>}
          </div>
        </section> : <>
          <header className="page-header">
            <div><h1>{meta.title}</h1><p>{meta.description}</p></div>
            <div className="header-actions">
              {page === 'dashboard' && <button className="primary-action" onClick={() => navigate('simulation')}><MaterialIcon name="add" size={18}/>Nova simulação</button>}
              {page === 'simulation' && <button className="secondary-action" onClick={downloadTemplate}><MaterialIcon name="download" size={18}/>Baixar modelo</button>}
            </div>
          </header>

          {page === 'dashboard' && <>
            <section className="operation-summary">
              <div className="operation-title"><span>Operação atual</span><h2>{activeName}</h2></div>
              {hasDepositor ? <div className="operation-facts">
                <div><span>Escala</span><b>{activeDepositor.escala} · {activeDepositor.jornada}</b></div>
                <div><span>Checkouts</span><b>{activeDepositor.checkouts_atuais} / {activeDepositor.checkouts_maximos}</b></div>
                <div><span>Capacidade / checkout</span><b>{activeDepositor.capacidade_checkout_dia.toLocaleString('pt-BR')}</b></div>
                <div><span>Jornada base</span><b>{activeDepositor.horas_trabalhadas_dia}h</b></div>
              </div> : <button className="secondary-action" onClick={() => navigate('parameters')}>Cadastrar operação</button>}
            </section>

            <section className="kpi-strip">
              <div><span>Forecast total</span><strong>{results.length ? total.toLocaleString('pt-BR') : '—'}</strong><small>{results.length ? `${results.length} dias carregados` : 'Sem forecast carregado'}</small></div>
              <div className={backlog > 0 ? 'kpi-warning' : ''}><span>Backlog final</span><strong>{results.length ? backlog.toLocaleString('pt-BR') : '—'}</strong><small>{results.length ? (backlogDays ? `${backlogDays} dias com saldo` : 'Sem backlog final') : 'Sem simulação'}</small></div>
              <div><span>Pico de HC</span><strong>{results.length ? peakHC : '—'}</strong><small>{results.length ? `${peakCheckouts} checkouts no pico` : 'Sem simulação'}</small></div>
              <div><span>Utilização</span><strong>{results.length ? `${utilization}%` : '—'}</strong><small>{results.length ? `${totalCapacity.toLocaleString('pt-BR')} de capacidade` : 'Forecast x capacidade'}</small></div>
            </section>

            <section className="content-grid">
              <article className="section-panel">
                <div className="section-heading"><div><h2>Premissas operacionais</h2><p>Parâmetros atualmente utilizados no cálculo.</p></div><button className="link-action inline" onClick={() => navigate('parameters')}>Editar parâmetros <MaterialIcon name="chevron_right" size={17}/></button></div>
                <dl className="details-list">
                  <div><dt>Dimensionamento de apoio</dt><dd>{activeDepositor.dimensionamento_apoios}</dd></div>
                  <div><dt>Tipo de colmeia</dt><dd>{activeDepositor.tipo_colmeia}</dd></div>
                  <div><dt>HE máxima em dia útil</dt><dd>{activeDepositor.horas_extra_max_dia_util}h</dd></div>
                  <div><dt>Operação sábado</dt><dd>{activeDepositor.horas_operacao_extra_sabado}h</dd></div>
                  <div><dt>Operação domingo/feriado</dt><dd>{activeDepositor.horas_operacao_extra_dom_feriado}h</dd></div>
                </dl>
              </article>
              <article className="section-panel status-panel">
                <div className="section-heading"><div><h2>Status do planejamento</h2><p>Leitura rápida do cenário atual.</p></div></div>
                <div className="status-line"><span className={`status-indicator ${results.length ? 'ready' : ''}`}/><div><b>{results.length ? 'Forecast processado' : 'Aguardando forecast'}</b><small>{results.length ? `${results.length} dias disponíveis para análise.` : 'Importe um arquivo para gerar o planejamento diário.'}</small></div></div>
                {results.length > 0 && <div className="status-line"><span className={`status-indicator ${backlog > 0 ? 'alert' : 'ready'}`}/><div><b>{backlog > 0 ? 'Capacidade requer atenção' : 'Capacidade atende ao cenário'}</b><small>{backlog > 0 ? `Backlog final de ${backlog.toLocaleString('pt-BR')} pedidos.` : 'Nenhum backlog ao fim do período.'}</small></div></div>}
              </article>
            </section>
          </>}

          {page === 'simulation' && <>
            <section className="progress-row" aria-label="Etapas da simulação">
              <div className="progress-item done"><span>1</span><div><b>Operação</b><small>{activeName}</small></div></div>
              <div className={`progress-item ${file ? 'done' : 'current'}`}><span>2</span><div><b>Forecast</b><small>{file ? 'Arquivo validado' : 'Importar arquivo'}</small></div></div>
              <div className={`progress-item ${results.length ? 'current' : ''}`}><span>3</span><div><b>Planejamento</b><small>{results.length ? `${results.length} dias calculados` : 'Aguardando forecast'}</small></div></div>
            </section>

            <section className="simulation-summary">
              <div><span>Operação</span><b>{activeName}</b></div>
              <div><span>Forecast</span><b>{results.length ? total.toLocaleString('pt-BR') : '—'}</b></div>
              <div><span>Backlog final</span><b className={backlog > 0 ? 'text-warning' : ''}>{results.length ? backlog.toLocaleString('pt-BR') : '—'}</b></div>
              <div><span>Pico de HC</span><b>{results.length ? peakHC : '—'}</b></div>
            </section>

            <section className="section-panel upload-panel">
              <div className="section-heading"><div><h2>Arquivo de forecast</h2><p>Colunas obrigatórias: Data e Forecast.</p></div></div>
              <label className={`dropzone ${file ? 'has-file' : ''}`}>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}/>
                <MaterialIcon name={file ? 'check_circle' : 'upload_file'} size={24}/>
                <div><b>{file || 'Selecionar arquivo'}</b><small>{file ? `${rows.length} registros válidos` : 'Excel ou CSV · processamento local'}</small></div>
                <span className="secondary-action fake-button">{file ? 'Trocar' : 'Procurar'}</span>
              </label>
            </section>

            {results.length > 0 ? <section className="section-panel table-panel">
              <div className="section-heading table-heading"><div><h2>Planejamento diário</h2><p>Capacidade, headcount e ação recomendada por data.</p></div><span className={`plain-status ${backlog > 0 ? 'warning' : 'success'}`}><MaterialIcon name={backlog > 0 ? 'warning' : 'check_circle'} size={17}/>{backlog > 0 ? 'Requer atenção' : 'Capacidade atende'}</span></div>
              <div className="table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Forecast</th><th>Backlog ant.</th><th>Ação</th><th>Checkouts</th><th>Capacidade</th><th>HC</th><th>Backlog final</th></tr></thead><tbody>{results.map(r => <tr key={r.data} className={r.backlogFinal > 0 ? 'row-attention' : ''}><td className="date-cell">{new Date(r.data + 'T12:00:00').toLocaleDateString('pt-BR')}</td><td>{r.tipoDia}</td><td>{r.forecast.toLocaleString('pt-BR')}</td><td>{r.backlogAnterior.toLocaleString('pt-BR')}</td><td><span className="action-label">{r.acao}</span></td><td>{r.checkouts}</td><td>{r.capacidade.toLocaleString('pt-BR')}</td><td>{r.hcTotal}</td><td className={r.backlogFinal > 0 ? 'backlog-value' : ''}>{r.backlogFinal.toLocaleString('pt-BR')}</td></tr>)}</tbody></table></div>
            </section> : <section className="empty-panel"><MaterialIcon name="table_chart" size={26}/><div><h2>Planejamento não calculado</h2><p>Importe o forecast para gerar a tabela diária.</p></div></section>}
          </>}

          {page === 'history' && <section className="empty-panel large"><MaterialIcon name="database" size={28}/><div><h2>Nenhuma simulação salva</h2><p>O histórico será exibido aqui quando a persistência das simulações estiver disponível.</p></div><button className="secondary-action" onClick={() => navigate('simulation')}>Nova simulação</button></section>}

          {page === 'parameters' && <>
            <section className="parameter-toolbar"><label><span>Depositante</span><div className="select-wrap"><select value={selectedId} onChange={e => setSelectedId(e.target.value)}><option value="">Novo depositante</option>{depositors.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}</select><MaterialIcon name="expand_more" size={18}/></div></label>{isAdmin && <button className="secondary-action" onClick={() => { setSelectedId(''); setForm(blankDepositor) }}><MaterialIcon name="add" size={17}/>Novo</button>}</section>

            <section className="parameter-grid">
              <div className="section-panel form-panel"><div className="form-panel-heading"><h2>Identificação e escala</h2><p>Configuração base da operação.</p></div><div className="form-grid"><label>Nome<input value={form.nome} disabled={!isAdmin} onChange={e => setText('nome', e.target.value)}/></label><label>Escala<select value={form.escala} disabled={!isAdmin} onChange={e => setText('escala', e.target.value)}><option>5x2</option><option>4x3</option></select></label><label>Jornada<select value={form.jornada} disabled={!isAdmin} onChange={e => setText('jornada', e.target.value)}><option>SEG a SEX</option><option>DOM a QUA</option><option>QUA a SÁB</option></select></label><label>Tipo de colmeia<select value={form.tipo_colmeia} disabled={!isAdmin} onChange={e => setText('tipo_colmeia', e.target.value)}><option>Fixa</option><option>Móvel</option><option>Não se aplica</option></select></label><label className="checkbox"><input type="checkbox" checked={form.ativo} disabled={!isAdmin} onChange={e => setText('ativo', e.target.checked)}/><span>Depositante ativo</span></label></div></div>

              <div className="section-panel form-panel"><div className="form-panel-heading"><h2>Capacidade</h2><p>Produtividade, checkouts e jornadas extraordinárias.</p></div><div className="form-grid"><label>Horas base<input type="number" step="0.5" value={form.horas_trabalhadas_dia} disabled={!isAdmin} onChange={e => numberField('horas_trabalhadas_dia', e.target.value)}/></label><label>Capacidade / checkout<input type="number" value={form.capacidade_checkout_dia} disabled={!isAdmin} onChange={e => numberField('capacidade_checkout_dia', e.target.value)}/></label><label>Checkouts atuais<input type="number" value={form.checkouts_atuais} disabled={!isAdmin} onChange={e => numberField('checkouts_atuais', e.target.value)}/></label><label>Checkouts máximos<input type="number" value={form.checkouts_maximos} disabled={!isAdmin} onChange={e => numberField('checkouts_maximos', e.target.value)}/></label><label>HE máx. dia útil<input type="number" step="0.5" value={form.horas_extra_max_dia_util} disabled={!isAdmin} onChange={e => numberField('horas_extra_max_dia_util', e.target.value)}/></label><label>Horas operação sábado<input type="number" step="0.5" value={form.horas_operacao_extra_sabado} disabled={!isAdmin} onChange={e => numberField('horas_operacao_extra_sabado', e.target.value)}/></label><label>Horas operação dom./feriado<input type="number" step="0.5" value={form.horas_operacao_extra_dom_feriado} disabled={!isAdmin} onChange={e => numberField('horas_operacao_extra_dom_feriado', e.target.value)}/></label></div></div>

              <div className="section-panel form-panel full-span"><div className="form-panel-heading"><h2>Headcount</h2><p>Composição por checkout e estruturas de apoio.</p></div><div className="form-grid headcount-grid"><label>Pessoas / checkout<input type="number" value={form.pessoas_por_checkout} disabled={!isAdmin} onChange={e => numberField('pessoas_por_checkout', e.target.value)}/></label><label>Separando<input type="number" value={form.pessoas_separando} disabled={!isAdmin} onChange={e => numberField('pessoas_separando', e.target.value)}/></label><label>Embalando<input type="number" value={form.pessoas_embalando} disabled={!isAdmin} onChange={e => numberField('pessoas_embalando', e.target.value)}/></label><label>Embalagem / caixa<input type="number" value={form.pessoas_embalagem_caixa} disabled={!isAdmin} onChange={e => numberField('pessoas_embalagem_caixa', e.target.value)}/></label><label>Roteirizando<input type="number" value={form.pessoas_roteirizando} disabled={!isAdmin} onChange={e => numberField('pessoas_roteirizando', e.target.value)}/></label><label>Ressuprindo<input type="number" value={form.pessoas_ressuprindo} disabled={!isAdmin} onChange={e => numberField('pessoas_ressuprindo', e.target.value)}/></label><label>Dimensionamento<select value={form.dimensionamento_apoios} disabled={!isAdmin} onChange={e => setText('dimensionamento_apoios', e.target.value)}><option>Fixo por turno</option><option>Por checkout</option></select></label></div></div>
            </section>

            <div className="sticky-actions">{isAdmin ? <><span className="save-hint">Revise os valores antes de salvar.</span><div className="actions"><button className="primary-action" onClick={saveDepositor} disabled={loading || !form.nome}><MaterialIcon name="save" size={17}/>Salvar</button>{selectedId && <button className="danger-action" onClick={deleteDepositor}><MaterialIcon name="delete" size={17}/>Excluir</button>}</div></> : <span className="readonly-note">Perfil somente leitura.</span>}</div>
            {dataMessage && <div className="message">{dataMessage}</div>}
          </>}
        </>}
      </main>
    </div>
  </div>
}
