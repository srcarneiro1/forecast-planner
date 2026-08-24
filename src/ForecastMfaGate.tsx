import { type FormEvent, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

type GovernanceRole = 'OWNER' | 'ADMIN' | 'USER'
type Mode = 'hidden' | 'checking' | 'setup' | 'challenge'
type Enrollment = { factorId: string; qrCode: string; secret: string }

function friendlyError(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('invalid') || lower.includes('code')) return 'Código inválido ou expirado. Aguarde um novo código no autenticador e tente novamente.'
  return 'Não foi possível concluir a autenticação em duas etapas. Tente novamente.'
}

export default function ForecastMfaGate() {
  const [mode, setMode] = useState<Mode>('hidden')
  const [governanceRole, setGovernanceRole] = useState<GovernanceRole>('USER')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function resolveState() {
    if (!supabase) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setMode('hidden')
      setGovernanceRole('USER')
      return
    }

    const { data: governance } = await supabase.from('app_governance').select('governance_role').eq('user_id', user.id).maybeSingle()
    const role = (governance?.governance_role ?? 'USER') as GovernanceRole
    setGovernanceRole(role)
    if (role !== 'OWNER' && role !== 'ADMIN') {
      setMode('hidden')
      return
    }

    setMode('checking')
    setError(null)
    const [{ data: aal, error: aalError }, { data: factors, error: factorsError }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ])

    if (aalError || factorsError) {
      setError('Não foi possível verificar o segundo fator de autenticação.')
      setMode('challenge')
      return
    }

    if (aal.currentLevel === 'aal2') {
      setMode('hidden')
      return
    }

    const verified = factors.totp.find(item => item.status === 'verified')
    if (verified) {
      setFactorId(verified.id)
      setMode('challenge')
      return
    }

    setFactorId(null)
    setEnrollment(null)
    setMode('setup')
  }

  useEffect(() => {
    if (!supabase) return
    void resolveState()
    const { data } = supabase.auth.onAuthStateChange(() => { void resolveState() })
    return () => data.subscription.unsubscribe()
  }, [])

  async function beginEnrollment() {
    if (!supabase) return
    setBusy(true)
    setError(null)
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      for (const pending of factors?.totp.filter(item => item.status === 'unverified') ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: pending.id })
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Forecast Planner' })
      if (enrollError) throw enrollError
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
      setFactorId(data.id)
    } catch (enrollError) {
      setError(friendlyError(enrollError instanceof Error ? enrollError.message : ''))
    } finally {
      setBusy(false)
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const normalizedCode = code.replace(/\D/g, '').slice(0, 6)
    if (!factorId || normalizedCode.length !== 6) {
      setError('Informe o código de 6 dígitos exibido no seu aplicativo autenticador.')
      return
    }

    setBusy(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: normalizedCode })
    if (verifyError) {
      setError(friendlyError(verifyError.message))
      setBusy(false)
      return
    }

    setCode('')
    await resolveState()
    setBusy(false)
  }

  async function signOut() {
    await supabase?.auth.signOut()
    setMode('hidden')
  }

  if (mode === 'hidden') return null

  return <div className="forecast-mfa-backdrop"><section className="forecast-mfa-card" role="dialog" aria-modal="true" aria-labelledby="forecast-mfa-title"><div className="forecast-mfa-badge">{governanceRole === 'OWNER' ? 'OWNER' : 'ADMINISTRADOR'} · ACESSO PROTEGIDO</div><h1 id="forecast-mfa-title">Verificação em duas etapas</h1>{mode === 'checking' ? <><p>Verificando o nível de segurança da sua sessão.</p><div className="forecast-mfa-loading"/></> : mode === 'setup' ? <>{enrollment ? <><p>Escaneie o QR Code com seu aplicativo autenticador. Depois informe o código de 6 dígitos para ativar o segundo fator.</p><div className="forecast-mfa-qr"><img src={enrollment.qrCode} alt="QR Code para cadastrar o autenticador do Forecast Planner"/></div><div className="forecast-mfa-secret"><span>Chave manual</span><code>{enrollment.secret}</code></div><form onSubmit={verify} className="forecast-mfa-form"><label htmlFor="forecast-mfa-code">Código do autenticador</label><input id="forecast-mfa-code" value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} autoFocus/><button className="primary-action" type="submit" disabled={busy}>{busy?'Validando…':'Ativar e continuar'}</button></form></> : <><p>Contas de Owner e Admin precisam de TOTP para utilizar recursos administrativos do Forecast Planner.</p><button className="primary-action" type="button" onClick={()=>void beginEnrollment()} disabled={busy}>{busy?'Preparando…':'Configurar aplicativo autenticador'}</button></>}</> : <><p>Abra seu aplicativo autenticador e informe o código atual.</p><form onSubmit={verify} className="forecast-mfa-form"><label htmlFor="forecast-mfa-code">Código de 6 dígitos</label><input id="forecast-mfa-code" value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} autoFocus/><button className="primary-action" type="submit" disabled={busy}>{busy?'Validando…':'Verificar e continuar'}</button></form></>}{error&&<div className="forecast-mfa-error">{error}</div>}<button className="secondary-action forecast-mfa-signout" type="button" onClick={()=>void signOut()} disabled={busy}>Sair da conta</button><div className="forecast-mfa-note">O segundo fator é individual e não deve ser compartilhado. O segredo TOTP não é armazenado pelo Forecast Planner.</div></section></div>
}
