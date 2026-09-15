import * as XLSX from 'xlsx'
import type { ForecastRow } from './simulation'

export type ParsedPlanningForecast={
  rows:ForecastRow[]
  sheet:string
  headerRow:number
  rule:string
  demandColumns:string[]
}

export function normalizePlanningHeader(value:string){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
}

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

function numeric(value:unknown){
  if(typeof value==='number')return Number.isFinite(value)?value:0
  const raw=String(value??'').trim()
  if(!raw)return 0
  const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw
  const parsed=Number(normalized)
  return Number.isFinite(parsed)?parsed:0
}

function headerScore(row:unknown[]){
  const normalized=row.map(cell=>normalizePlanningHeader(String(cell??'')))
  const hasDate=normalized.some(value=>['data','date','dia'].includes(value))
  const demandCount=normalized.filter(value=>value.includes('demanda do dia')).length
  const hasDirect=normalized.some(value=>['forecast','forecast total pedido normal','demanda','demanda total','pedidos','volume','volumetria'].includes(value))
  return hasDate?(demandCount*10+(hasDirect?5:0)+1):0
}

function chooseColumns(header:unknown[]){
  const normalized=header.map((cell,index)=>({index,label:String(cell??'').trim(),key:normalizePlanningHeader(String(cell??''))}))
  const date=normalized.find(item=>['data','date','dia'].includes(item.key))
  if(!date)return null

  const dailyDemand=normalized.filter(item=>item.key.includes('demanda do dia'))
  if(dailyDemand.length){
    return{
      dateIndex:date.index,
      demandIndexes:dailyDemand.map(item=>item.index),
      demandColumns:dailyDemand.map(item=>item.label||`Coluna ${item.index+1}`),
      rule:dailyDemand.length>1?`Soma automática de ${dailyDemand.length} colunas “Demanda do Dia”.`:'Coluna “Demanda do Dia”.',
    }
  }

  const exact=normalized.find(item=>['forecast','forecast total pedido normal','demanda','demanda total','pedidos','volume','volumetria'].includes(item.key))
  if(exact)return{dateIndex:date.index,demandIndexes:[exact.index],demandColumns:[exact.label],rule:`Coluna “${exact.label}”.`}

  const candidates=normalized.filter(item=>item.key.includes('forecast')||item.key.includes('demanda'))
  if(candidates.length===1)return{dateIndex:date.index,demandIndexes:[candidates[0].index],demandColumns:[candidates[0].label],rule:`Coluna “${candidates[0].label}”.`}
  return null
}

function isConsolidatedSheet(name:string){
  const normalized=normalizePlanningHeader(name)
  return normalized.includes('consolidado')||normalized.includes('consolidada')||normalized==='forecast'
}

export async function parsePlanningForecastFile(file:File):Promise<ParsedPlanningForecast>{
  const buffer=await file.arrayBuffer()
  const workbook=XLSX.read(buffer,{type:'array',cellDates:true})
  let best:ParsedPlanningForecast|null=null

  for(const sheetName of workbook.SheetNames){
    const sheet=workbook.Sheets[sheetName]
    const matrix=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:null,raw:true})
    if(!matrix.length)continue

    let headerIndex=-1
    let score=0
    const scanLimit=Math.min(matrix.length,30)
    for(let i=0;i<scanLimit;i+=1){
      const nextScore=headerScore(matrix[i]??[])
      if(nextScore>score){score=nextScore;headerIndex=i}
    }
    if(headerIndex<0||score<=0)continue

    const columns=chooseColumns(matrix[headerIndex]??[])
    if(!columns)continue

    const rows:ForecastRow[]=[]
    for(let i=headerIndex+1;i<matrix.length;i+=1){
      const row=matrix[i]??[]
      const data=excelDate(row[columns.dateIndex])
      if(!data)continue
      const forecast=columns.demandIndexes.reduce((sum,index)=>sum+numeric(row[index]),0)
      if(Number.isFinite(forecast)&&forecast>=0)rows.push({data,forecast})
    }

    if(!rows.length)continue
    const parsed:ParsedPlanningForecast={rows,sheet:sheetName,headerRow:headerIndex+1,rule:columns.rule,demandColumns:columns.demandColumns}
    const sameLength=best&&parsed.rows.length===best.rows.length
    const preferConsolidated=sameLength&&isConsolidatedSheet(parsed.sheet)&&!isConsolidatedSheet(best.sheet)
    if(!best||parsed.rows.length>best.rows.length||preferConsolidated)best=parsed
  }

  if(!best)throw new Error('Não encontrei uma tabela diária válida. O arquivo precisa ter uma coluna Data e uma coluna de Forecast/Demanda do Dia.')
  return best
}
