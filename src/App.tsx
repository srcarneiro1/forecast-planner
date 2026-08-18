import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { Upload, Activity, Database, SlidersHorizontal, Download } from 'lucide-react'
import { simulate, type Depositor, type ForecastRow } from './engine/simulation'
import './styles.css'

const demo: Depositor = {
  nome: 'MARCA DEMO',
  escala: '5x2',
  jornada: 'SEG a SEX',
  horas_trabalhadas_dia: 9,
  capacidade_checkout_dia: 500,
  pessoas_por_checkout: 1,
  pessoas_separando: 7,
  pessoas_embalando: 9,
  pessoas_embalagem_caixa: 4,
  pessoas_roteirizando: 0,
  pessoas_ressuprindo: 0,
  checkouts_atuais: 7,
  checkouts_maximos: 9,
  tipo_colmeia: 'Fixa',
  dimensionamento_apoios: 'Fixo por turno',
  horas_extra_max_dia_util: 2,
  horas_operacao_extra_sabado: 10,
  horas_operacao_extra_dom_feriado: 10,
}

type Page = 'simulation' | 'history' | 'parameters'

export default function App() {
  const [page, setPage] = useState<Page>('simulation')
  const [rows, setRows] = useState<ForecastRow[]>([])
  const [file, setFile] = useState('')
  const results = useMemo(() => simulate(rows, demo), [rows])
  const total = results.reduce((s, r) => s + r.forecast, 0)
  const backlog = results.at(-1)?.backlogFinal ?? 0

  async function onFile(f: File) {
    const b = await f.arrayBuffer()
    const wb = XLSX.read(b, { type: 'array', cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
    const parsed = data
      .map((x) => {
        const raw = x['Data']
        const d = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw ?? '').slice(0, 10)
        const fc = Number(x['Forecast'] ?? 0)
        return { data: d, forecast: fc }
      })
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.data) && Number.isFinite(x.forecast) && x.forecast >= 0)
    setRows(parsed)
    setFile(f.name)
  }

  function downloadTemplate() {
    const sample = [
      { Data: '2026-11-23', Forecast: 3200 },
      { Data: '2026-11-24', Forecast: 4100 },
      { Data: '2026-11-25', Forecast: 5200 },
      { Data: '2026-11-26', Forecast: 6100 },
      { Data: '2026-11-27', Forecast: 7200 },
    ]
    const ws = XLSX.utils.json_to_sheet(sample)
    ws['!cols'] = [{ wch: 14 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Forecast')
    XLSX.writeFile(wb, 'MODELO_FORECAST.xlsx')
  }

  return (
    <div className="shell">
      <aside>
        <div className="brand"><Activity /> Forecast Planner</div>
        <nav>
          <button className={page === 'simulation' ? 'active' : ''} onClick={() => setPage('simulation')}><Upload />Nova Simulação</button>
          <button className={page === 'history' ? 'active' : ''} onClick={() => setPage('history')}><Database />Histórico</button>
          <button className={page === 'parameters' ? 'active' : ''} onClick={() => setPage('parameters')}><SlidersHorizontal />Parâmetros</button>
        </nav>
        <small>v0.2 • Supabase</small>
      </aside>

      <main>
        {page === 'simulation' && <>
          <header><div><span>PLANEJAMENTO OPERACIONAL</span><h1>Nova Simulação</h1><p>Importe o modelo padronizado e valide a capacidade diária.</p></div></header>
          <section className="cards">
            <article><b>{demo.nome}</b><span>Depositante</span></article>
            <article><b>{total.toLocaleString('pt-BR')}</b><span>Forecast total</span></article>
            <article><b>{backlog.toLocaleString('pt-BR')}</b><span>Backlog final</span></article>
            <article><b>{results.length}</b><span>Dias simulados</span></article>
          </section>
          <section className="panel">
            <div className="panel-title">
              <div><h2>Arquivo de Forecast</h2><p>Colunas obrigatórias: Data e Forecast.</p></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="secondary-action" onClick={downloadTemplate}><Download size={18}/>Baixar modelo</button>
                <label className="upload"><Upload size={18}/>Selecionar arquivo<input type="file" accept=".xlsx,.xls,.csv" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}/></label>
              </div>
            </div>
            {file && <div className="file-ok">✓ {file} • {rows.length} registros válidos</div>}
          </section>
          {results.length > 0 && <section className="panel table-wrap">
            <h2>Planejamento diário</h2>
            <table><thead><tr><th>Data</th><th>Tipo</th><th>Forecast</th><th>Backlog ant.</th><th>Ação</th><th>Checkouts</th><th>Capacidade</th><th>HC</th><th>Backlog final</th></tr></thead>
              <tbody>{results.map(r => <tr key={r.data}><td>{new Date(r.data + 'T12:00:00').toLocaleDateString('pt-BR')}</td><td><span className={'pill ' + (r.dentroEscala ? 'ok' : 'warn')}>{r.tipoDia}</span></td><td>{r.forecast.toLocaleString('pt-BR')}</td><td>{r.backlogAnterior.toLocaleString('pt-BR')}</td><td>{r.acao}</td><td>{r.checkouts}</td><td>{r.capacidade.toLocaleString('pt-BR')}</td><td>{r.hcTotal}</td><td>{r.backlogFinal.toLocaleString('pt-BR')}</td></tr>)}</tbody>
            </table>
          </section>}
        </>}

        {page === 'history' && <>
          <header><div><span>PLANEJAMENTO OPERACIONAL</span><h1>Histórico</h1><p>As simulações salvas aparecerão aqui.</p></div></header>
          <section className="panel empty-state"><Database size={34}/><h2>Nenhuma simulação salva</h2><p>Na próxima etapa esta tela será conectada à tabela de simulações do Supabase.</p></section>
        </>}

        {page === 'parameters' && <>
          <header><div><span>CONFIGURAÇÃO OPERACIONAL</span><h1>Parâmetros</h1><p>Premissas utilizadas pelo motor de capacidade.</p></div></header>
          <section className="cards">
            <article><b>{demo.capacidade_checkout_dia}</b><span>Pedidos / checkout</span></article>
            <article><b>{demo.horas_trabalhadas_dia}h</b><span>Jornada base</span></article>
            <article><b>{demo.checkouts_atuais}</b><span>Checkouts atuais</span></article>
            <article><b>{demo.checkouts_maximos}</b><span>Checkouts máximos</span></article>
          </section>
          <section className="panel"><h2>{demo.nome}</h2><p>Escala {demo.escala} • {demo.jornada} • Colmeia {demo.tipo_colmeia}</p><table><tbody><tr><th>Separando</th><td>{demo.pessoas_separando}</td></tr><tr><th>Embalando</th><td>{demo.pessoas_embalando}</td></tr><tr><th>Embalagem/Caixa</th><td>{demo.pessoas_embalagem_caixa}</td></tr><tr><th>HE máxima dia útil</th><td>{demo.horas_extra_max_dia_util}h</td></tr><tr><th>Operação extra sábado</th><td>{demo.horas_operacao_extra_sabado}h</td></tr><tr><th>Operação extra domingo/feriado</th><td>{demo.horas_operacao_extra_dom_feriado}h</td></tr></tbody></table></section>
        </>}
      </main>
    </div>
  )
}
