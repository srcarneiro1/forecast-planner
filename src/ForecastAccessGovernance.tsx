import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'

type GovernanceRole='OWNER'|'ADMIN'|'USER'
type AccessUser={user_id:string;email:string;nome:string;ativo:boolean;perfil_funcional:string;governance_role:GovernanceRole}

export default function ForecastAccessGovernance(){
  const[isOwner,setIsOwner]=useState(false)
  const[open,setOpen]=useState(false)
  const[users,setUsers]=useState<AccessUser[]>([])
  const[loading,setLoading]=useState(false)
  const[message,setMessage]=useState<string|null>(null)
  const[navTarget,setNavTarget]=useState<Element|null>(null)

  useEffect(()=>{
    if(!supabase)return
    let active=true
    async function resolveOwner(){
      const{data:{user}}=await supabase!.auth.getUser()
      if(!active||!user){setIsOwner(false);return}
      const{data}=await supabase!.from('app_governance').select('governance_role').eq('user_id',user.id).maybeSingle()
      if(active)setIsOwner(data?.governance_role==='OWNER')
    }
    void resolveOwner()
    const{data}=supabase.auth.onAuthStateChange(()=>{void resolveOwner()})
    return()=>{active=false;data.subscription.unsubscribe()}
  },[])

  useEffect(()=>{
    if(!isOwner){setNavTarget(null);return}
    const find=()=>setNavTarget(document.querySelector('.sidebar-nav'))
    find()
    const observer=new MutationObserver(find)
    observer.observe(document.body,{childList:true,subtree:true})
    return()=>observer.disconnect()
  },[isOwner])

  useEffect(()=>{
    if(open)void loadUsers()
  },[open])

  async function loadUsers(){
    if(!supabase)return
    setLoading(true);setMessage(null)
    const{data,error}=await supabase.rpc('list_forecast_access_users')
    if(error)setMessage(error.message)
    else setUsers((data??[]) as AccessUser[])
    setLoading(false)
  }

  async function setAdmin(user:AccessUser,makeAdmin:boolean){
    if(!supabase||user.governance_role==='OWNER')return
    const verb=makeAdmin?'conceder acesso administrativo a':'revogar o acesso administrativo de'
    if(!window.confirm(`Confirma ${verb} ${user.nome||user.email}?`))return
    setLoading(true);setMessage(null)
    const{error}=await supabase.rpc('set_forecast_admin_role',{p_target_id:user.user_id,p_make_admin:makeAdmin})
    if(error)setMessage(error.message)
    else{setMessage(makeAdmin?'Administrador concedido com sucesso.':'Administrador revogado com sucesso.');await loadUsers()}
    setLoading(false)
  }

  if(!isOwner||!navTarget)return null

  const navButton=createPortal(<>
    <div className="nav-divider forecast-governance-divider"/>
    <button type="button" className="forecast-governance-nav" onClick={()=>setOpen(true)}>
      <span className="material-symbols-rounded material-icon" aria-hidden="true">manage_accounts</span>
      <span>Acessos</span>
    </button>
  </>,navTarget)

  const modal=open?createPortal(<div className="forecast-governance-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}>
    <section className="forecast-governance-dialog" role="dialog" aria-modal="true" aria-labelledby="forecast-access-title">
      <header className="forecast-governance-head">
        <div><span>ADMINISTRAÇÃO</span><h2 id="forecast-access-title">Acessos e administradores</h2><p>O Owner é permanente. Administradores delegados podem operar parâmetros, mas não podem alterar a governança.</p></div>
        <button type="button" className="icon-button" aria-label="Fechar gestão de acessos" onClick={()=>setOpen(false)}><span className="material-symbols-rounded">close</span></button>
      </header>
      {message&&<div className="forecast-governance-message">{message}</div>}
      {loading&&!users.length?<div className="forecast-governance-loading">Carregando acessos…</div>:<div className="forecast-access-list">
        {users.map(user=><article key={user.user_id} className="forecast-access-card">
          <div className="forecast-access-avatar">{(user.nome||user.email||'U').slice(0,1).toUpperCase()}</div>
          <div className="forecast-access-copy"><strong>{user.nome||'Sem nome'}</strong><span>{user.email}</span><small>Perfil funcional: {user.perfil_funcional} · {user.ativo?'Ativo':'Inativo'}</small></div>
          <span className={`forecast-role-badge role-${user.governance_role.toLowerCase()}`}>{user.governance_role==='OWNER'?'Owner':user.governance_role==='ADMIN'?'Admin':'Usuário'}</span>
          <div className="forecast-access-action">{user.governance_role==='OWNER'?<span className="forecast-owner-lock"><span className="material-symbols-rounded">lock</span>Protegido</span>:user.governance_role==='ADMIN'?<button type="button" className="secondary-action" disabled={loading} onClick={()=>void setAdmin(user,false)}>Revogar Admin</button>:<button type="button" className="primary-action" disabled={loading||!user.ativo} onClick={()=>void setAdmin(user,true)}>Tornar Admin</button>}</div>
        </article>)}
      </div>}
      <footer className="forecast-governance-foot"><span>Promoções e revogações ficam registradas na auditoria de governança.</span><button type="button" className="secondary-action" onClick={()=>void loadUsers()} disabled={loading}>Atualizar</button></footer>
    </section>
  </div>,document.body):null

  return <>{navButton}{modal}</>
}
