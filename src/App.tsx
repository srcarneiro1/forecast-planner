import { FormEvent, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { Activity, Database, Download, LogIn, LogOut, Plus, Save, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import { simulate, type Depositor, type ForecastRow } from './engine/simulation'
import { supabase, supabaseConfigured } from './lib/supabase'
import './styles.css'

type Page = 'simulation' | 'history' | 'parameters'
type DbDepositor = Depositor & { id: string; ativo: boolean }
type Profile = { nome: string | null; perfil: string }

const fallbackDemo: Depositor = {
  nome: 'MARCA DEMO', escala: '5x2', jornada: 'SEG a SEX', horas_trabalhadas_dia: 9,
  capacidade_checkout_dia: 500, pessoas_por_checkout: 1, pessoas_separando: 7,
  pessoas_embalando: 9, pessoas_embalagem_caixa: 4, pessoas_roteirizando: 0,
  pessoas_ressuprindo: 0, checkouts_atuais: 7, checkouts_maximos: 9, tipo_colmeia: 'Fixa',
  dimensionamento_apoios: 'Fixo por turno', horas_extra_max_dia_util: 2,
  horas_operacao_extra_sabado: 10, horas_operacao_extra_dom_feriado: 10,
}

const blankDepositor: Omit<DbDepositor, 'id'> = { ...fallbackDemo, nome: '', ativo: true }

export default function App() {
  const [page, setPage] = useState<Page>('simulation')
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

  const selectedDepositor = depositors.find(d => d.id === selectedId)
  const activeDepositor: Depositor = selectedDepositor ?? depositors[0] ?? fallbackDemo
  const results = useMemo(() => simulate(rows, activeDepositor), [rows, activeDepositor])
  const total = results.reduce((s, r) => s + r.forecast, 0)
  const backlog = results.at(-1)?.backlogFinal ?? 0
  const isAdmin = profile?.perfil === 'admin'

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

  const setText = (key: keyof typeof form, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value } as any))

  if (!supabaseConfigured) return <div className="setup-screen"><div className="panel"><h1>Forecast Planner</h1><p>O aplicativo está publicado, mas as variáveis do Supabase ainda não foram configuradas no Cloudflare.</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code></div></div>

  return <div className="shell">
    <aside>
      <div className="brand"><Activity /> Forecast Planner</div>
      <nav>
        <button className={page === 'simulation' ? 'active' : ''} onClick={() => setPage('simulation')}><Upload />Nova Simulação</button>
        <button className={page === 'history' ? 'active' : ''} onClick={() => setPage('history')}><Database />Histórico</button>
        <button className={page === 'parameters' ? 'active' : ''} onClick={() => setPage('parameters')}><SlidersHorizontal />Parâmetros</button>
      </nav>
      {profile ? <div className="user-box"><span>{profile.nome ?? 'Usuário'}</span><small>{profile.perfil}</small><button onClick={signOut}><LogOut size={15}/>Sair</button></div> : <small>Entre para carregar dados do Supabase</small>}
    </aside>

    <main>
      {!profile && <section className="auth-banner">
        <div><h2>Acessar dados operacionais</h2><p>Use sua conta para visualizar e administrar os parâmetros.</p></div>
        <form onSubmit={authSubmit} className="auth-form"><input type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} required/><input type="password" placeholder="Senha" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required/><button className="primary-action" disabled={loading}><LogIn size={17}/>Entrar</button><button type="button" className="secondary-action" onClick={signUp} disabled={loading}>Criar conta</button></form>
        {authMessage && <div className="message">{authMessage}</div>}
      </section>}

      {page === 'simulation' && <>
        <header><span>PLANEJAMENTO OPERACIONAL</span><h1>Nova Simulação</h1><p>Importe o modelo padronizado e valide a capacidade diária.</p></header>
        {depositors.length > 0 && <div className="toolbar"><label>Depositante<select value={selectedId} onChange={e => setSelectedId(e.target.value)}>{depositors.filter(d => d.ativo).map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}</select></label></div>}
        <section className="cards"><article><b>{activeDepositor.nome}</b><span>Depositante</span></article><article><b>{total.toLocaleString('pt-BR')}</b><span>Forecast total</span></article><article><b>{backlog.toLocaleString('pt-BR')}</b><span>Backlog final</span></article><article><b>{results.length}</b><span>Dias simulados</span></article></section>
        <section className="panel"><div className="panel-title"><div><h2>Arquivo de Forecast</h2><p>Colunas obrigatórias: Data e Forecast.</p></div><div className="actions"><button className="secondary-action" onClick={downloadTemplate}><Download size={18}/>Baixar modelo</button><label className="upload"><Upload size={18}/>Selecionar arquivo<input type="file" accept=".xlsx,.xls,.csv" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}/></label></div></div>{file && <div className="file-ok">✓ {file} • {rows.length} registros válidos</div>}</section>
        {results.length > 0 && <section className="panel table-wrap"><h2>Planejamento diário</h2><table><thead><tr><th>Data</th><th>Tipo</th><th>Forecast</th><th>Backlog ant.</th><th>Ação</th><th>Checkouts</th><th>Capacidade</th><th>HC</th><th>Backlog final</th></tr></thead><tbody>{results.map(r => <tr key={r.data}><td>{new Date(r.data + 'T12:00:00').toLocaleDateString('pt-BR')}</td><td><span className={'pill ' + (r.dentroEscala ? 'ok' : 'warn')}>{r.tipoDia}</span></td><td>{r.forecast.toLocaleString('pt-BR')}</td><td>{r.backlogAnterior.toLocaleString('pt-BR')}</td><td>{r.acao}</td><td>{r.checkouts}</td><td>{r.capacidade.toLocaleString('pt-BR')}</td><td>{r.hcTotal}</td><td>{r.backlogFinal.toLocaleString('pt-BR')}</td></tr>)}</tbody></table></section>}
      </>}

      {page === 'history' && <><header><span>PLANEJAMENTO OPERACIONAL</span><h1>Histórico</h1><p>As simulações salvas aparecerão aqui.</p></header><section className="panel empty-state"><Database size={34}/><h2>Nenhuma simulação salva</h2><p>O histórico será conectado na próxima etapa.</p></section></>}

      {page === 'parameters' && <>
        <header><span>CONFIGURAÇÃO OPERACIONAL</span><h1>Parâmetros</h1><p>Premissas utilizadas pelo motor de capacidade.</p></header>
        {!profile ? <section className="panel empty-state"><LogIn size={34}/><h2>Faça login para carregar os parâmetros</h2></section> : <>
          <div className="toolbar"><label>Depositante<select value={selectedId} onChange={e => setSelectedId(e.target.value)}><option value="">Novo depositante</option>{depositors.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}</select></label>{isAdmin && <button className="secondary-action" onClick={() => { setSelectedId(''); setForm(blankDepositor) }}><Plus size={17}/>Novo</button>}</div>
          <section className="parameter-grid">
            <div className="panel form-panel"><h2>Identificação e escala</h2><div className="form-grid"><label>Nome<input value={form.nome} disabled={!isAdmin} onChange={e => setText('nome', e.target.value)}/></label><label>Escala<select value={form.escala} disabled={!isAdmin} onChange={e => setText('escala', e.target.value)}><option>5x2</option><option>4x3</option></select></label><label>Jornada<select value={form.jornada} disabled={!isAdmin} onChange={e => setText('jornada', e.target.value)}><option>SEG a SEX</option><option>DOM a QUA</option><option>QUA a SÁB</option></select></label><label>Tipo de colmeia<select value={form.tipo_colmeia} disabled={!isAdmin} onChange={e => setText('tipo_colmeia', e.target.value)}><option>Fixa</option><option>Móvel</option><option>Não se aplica</option></select></label><label className="checkbox"><input type="checkbox" checked={form.ativo} disabled={!isAdmin} onChange={e => setText('ativo', e.target.checked)}/>Ativo</label></div></div>
            <div className="panel form-panel"><h2>Capacidade</h2><div className="form-grid"><label>Horas base<input type="number" step="0.5" value={form.horas_trabalhadas_dia} disabled={!isAdmin} onChange={e => numberField('horas_trabalhadas_dia', e.target.value)}/></label><label>Capacidade / checkout<input type="number" value={form.capacidade_checkout_dia} disabled={!isAdmin} onChange={e => numberField('capacidade_checkout_dia', e.target.value)}/></label><label>Checkouts atuais<input type="number" value={form.checkouts_atuais} disabled={!isAdmin} onChange={e => numberField('checkouts_atuais', e.target.value)}/></label><label>Checkouts máximos<input type="number" value={form.checkouts_maximos} disabled={!isAdmin} onChange={e => numberField('checkouts_maximos', e.target.value)}/></label><label>HE máx. dia útil<input type="number" step="0.5" value={form.horas_extra_max_dia_util} disabled={!isAdmin} onChange={e => numberField('horas_extra_max_dia_util', e.target.value)}/></label><label>Horas extra sábado<input type="number" step="0.5" value={form.horas_operacao_extra_sabado} disabled={!isAdmin} onChange={e => numberField('horas_operacao_extra_sabado', e.target.value)}/></label><label>Horas extra dom./feriado<input type="number" step="0.5" value={form.horas_operacao_extra_dom_feriado} disabled={!isAdmin} onChange={e => numberField('horas_operacao_extra_dom_feriado', e.target.value)}/></label></div></div>
            <div className="panel form-panel"><h2>Headcount</h2><div className="form-grid"><label>Pessoas / checkout<input type="number" value={form.pessoas_por_checkout} disabled={!isAdmin} onChange={e => numberField('pessoas_por_checkout', e.target.value)}/></label><label>Separando<input type="number" value={form.pessoas_separando} disabled={!isAdmin} onChange={e => numberField('pessoas_separando', e.target.value)}/></label><label>Embalando<input type="number" value={form.pessoas_embalando} disabled={!isAdmin} onChange={e => numberField('pessoas_embalando', e.target.value)}/></label><label>Embalagem / caixa<input type="number" value={form.pessoas_embalagem_caixa} disabled={!isAdmin} onChange={e => numberField('pessoas_embalagem_caixa', e.target.value)}/></label><label>Roteirizando<input type="number" value={form.pessoas_roteirizando} disabled={!isAdmin} onChange={e => numberField('pessoas_roteirizando', e.target.value)}/></label><label>Ressuprindo<input type="number" value={form.pessoas_ressuprindo} disabled={!isAdmin} onChange={e => numberField('pessoas_ressuprindo', e.target.value)}/></label><label>Dimensionamento<select value={form.dimensionamento_apoios} disabled={!isAdmin} onChange={e => setText('dimensionamento_apoios', e.target.value)}><option>Fixo por turno</option><option>Por checkout</option></select></label></div></div>
          </section>
          <div className="form-actions">{isAdmin ? <><button className="primary-action" onClick={saveDepositor} disabled={loading || !form.nome}><Save size={17}/>Salvar parâmetros</button>{selectedId && <button className="danger-action" onClick={deleteDepositor}><Trash2 size={17}/>Excluir</button>}</> : <span className="readonly-note">Perfil somente leitura. Um administrador pode alterar os parâmetros.</span>}</div>
          {dataMessage && <div className="message">{dataMessage}</div>}
        </>}
      </>}
    </main>
  </div>
}
