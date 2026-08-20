import { Fragment, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function setInputValue(input:HTMLInputElement,value:number){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set
  setter?.call(input,String(value))
  input.dispatchEvent(new Event('input',{bubbles:true}))
  input.dispatchEvent(new Event('change',{bubbles:true}))
}

export default function CheckoutStepperFeature(){
  const[inputs,setInputs]=useState<HTMLInputElement[]>([])
  const[,setVersion]=useState(0)

  useEffect(()=>{
    const scan=()=>{
      const next=Array.from(document.querySelectorAll<HTMLInputElement>('.checkout-plan-input'))
      setInputs(current=>current.length===next.length&&current.every((item,index)=>item===next[index])?current:next)
    }
    scan()
    const observer=new MutationObserver(scan)
    observer.observe(document.body,{childList:true,subtree:true})
    return()=>observer.disconnect()
  },[])

  useEffect(()=>{
    const refresh=()=>setVersion(v=>v+1)
    inputs.forEach(input=>{
      input.addEventListener('input',refresh)
      input.addEventListener('change',refresh)
    })
    return()=>inputs.forEach(input=>{
      input.removeEventListener('input',refresh)
      input.removeEventListener('change',refresh)
    })
  },[inputs])

  return <>{inputs.map((input,index)=>{
    const target=input.parentElement
    if(!target)return null
    const value=Number(input.value||0)
    const min=Number(input.min||0)
    return <Fragment key={`${index}-${input.getAttribute('aria-label')??''}`}>
      {createPortal(
        <div className="checkout-stepper" aria-label={input.getAttribute('aria-label')??'Checkouts planejados'}>
          <button type="button" className="checkout-stepper-button" disabled={value<=min} onClick={()=>setInputValue(input,Math.max(min,value-1))} aria-label="Diminuir checkout">−</button>
          <span className="checkout-stepper-value">{value}</span>
          <button type="button" className="checkout-stepper-button" onClick={()=>setInputValue(input,value+1)} aria-label="Aumentar checkout">+</button>
        </div>,
        target,
      )}
    </Fragment>
  })}</>
}
