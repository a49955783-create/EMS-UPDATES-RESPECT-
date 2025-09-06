import React, { useEffect, useRef, useState } from 'react'
import Tesseract from 'tesseract.js'
import './index.css'

const LOCATIONS = ['','الغرب','الشرق','وسط','الجنوب','الشمال','ساندي','بوليتو']

function cleanLine(s){
  if(!s) return ''
  s = s.replace(/[\u200E\u200F\u202A-\u202E]/g,'')
  s = s.replace(/[©#@*+=~^`"“”'’\[\]\(\)<>]/g,' ')
  s = s.replace(/[|،:؛•·]/g,' | ')
  s = s.replace(/[^\u0600-\u06FF0-9A-Za-z\-\|\s]/g,' ')
  s = s.replace(/\s+/g,' ').trim()
  return s
}
function normalizeCodeToken(tok){
  if(!tok) return ''
  let t = String(tok).trim()
  t = t.replace(/[Oo]/g,'0').replace(/[Il]/g,'1')
  t = t.toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9\-]/g,'')
  if(/^(DAT|D4T|D41|DAI)$/i.test(t)) return 'DA-1'
  const m = t.match(/^([A-Z]{1,3})-?(\d{1,4})$/)
  if(m) return m[1] + '-' + m[2]
  return t
}

export default function App(){
  const [recipient,setRecipient] = useState('')
  const [deputy,setDeputy] = useState('')
  const [units,setUnits] = useState([])
  const [finalText,setFinalText] = useState('')
  const [toast,setToast] = useState('')
  const [busy,setBusy] = useState(false)
  const dropRef = useRef(null)

  useEffect(()=>{
    const theme = localStorage.getItem('theme') || 'light'
    document.documentElement.classList.toggle('dark', theme==='dark')
  },[])

  function toggleTheme(){
    const isDark = document.documentElement.classList.toggle('dark')
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }

  function onFileChange(e){ const f = e.target.files?.[0]; if(f) runOCR(f) }

  useEffect(()=>{
    function onPaste(e){
      const items = e.clipboardData?.items || []
      for(const it of items){
        if(it.type?.startsWith('image/')){
          const f = it.getAsFile()
          runOCR(f)
          e.preventDefault(); break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return ()=> window.removeEventListener('paste', onPaste)
  },[])

  useEffect(()=>{
    const el = dropRef.current; if(!el) return
    const prevent = e=>{ e.preventDefault(); e.stopPropagation() }
    const drop = e=>{ prevent(e); const f=e.dataTransfer?.files?.[0]; if(f) runOCR(f) }
    el.addEventListener('dragover', prevent); el.addEventListener('dragenter', prevent); el.addEventListener('drop', drop)
    return ()=>{ el.removeEventListener('dragover', prevent); el.removeEventListener('dragenter', prevent); el.removeEventListener('drop', drop) }
  },[])

  async function preprocessImage(file){
    return new Promise((resolve,reject)=>{
      const img=new Image()
      const url=URL.createObjectURL(file)
      img.onload=()=>{
        const maxW=1600
        let w=img.width, h=img.height
        if(w>maxW){ h=Math.round(h*(maxW/w)); w=maxW }
        const c=document.createElement('canvas'); c.width=w; c.height=h
        const ctx=c.getContext('2d')
        ctx.drawImage(img,0,0,w,h)
        const imgData=ctx.getImageData(0,0,w,h)
        const d=imgData.data
        const contrast=1.5, bright=12
        for(let i=0;i<d.length;i+=4){
          const g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]
          let v=(g-128)*contrast+128+bright; v=Math.max(0,Math.min(255,v))
          d[i]=d[i+1]=d[i+2]=v
        }
        ctx.putImageData(imgData,0,0)
        c.toBlob(b=>{ URL.revokeObjectURL(url); resolve(b) },'image/png',0.95)
      }
      img.onerror=e=>{ URL.revokeObjectURL(url); reject(e) }
      img.src=url
    })
  }

  async function ocrExtract(blob){
    const { data } = await Tesseract.recognize(blob, 'ara+eng', { logger: m => {} })
    const lines = (data.text||'').split('\\n').map(cleanLine).filter(Boolean)
    return lines
  }

  async function runOCR(file){
    try{
      setBusy(true)
      const pre = await preprocessImage(file)
      const lines = await ocrExtract(pre)
      const parsed = []
      for(const ln of lines){
        if(!/[\u0600-\u06FF\u0621-\u064A]/.test(ln) && !/[A-Za-z0-9]/.test(ln)) continue
        const tok = ln.split(' ')[0]
        const code = normalizeCodeToken(tok)
        const rest = ln.replace(tok,'').trim()
        let status = 'في الميدان'
        const lower = ln.toLowerCase()
        if(lower.includes('مشغول')) status='مشغول'
        else if(lower.includes('خارج')) status='خارج الخدمة'
        parsed.push({ name: rest, code, status, location: '' })
      }
      const seen = new Set(); const uniq = []
      for(const p of parsed){
        const key = (p.code + '|' + p.name).trim()
        if(!seen.has(key)){ seen.add(key); uniq.push(p) }
      }
      setUnits(uniq)
      setToast( uniq.length ? 'تم استخراج القائمة' : 'لم يُستخرج أي عناصر' )
      setTimeout(()=>setToast(''),2000)
    }catch(e){
      console.error(e)
      alert('تعذّر استخراج النص — جرّب صورة أوضح أو عدّل القائمة يدوياً.')
    }finally{
      setBusy(false)
    }
  }

  function setUnit(i, field, value){
    const cp=[...units]; cp[i][field]=value; setUnits(cp)
  }
  function addUnit(){ setUnits([...units, {name:'', code:'', status:'في الميدان', location: ''}]) }
  function removeUnit(i){ const cp=[...units]; cp.splice(i,1); setUnits(cp) }

  function generate(){
    if(!recipient.trim() || !deputy.trim()){ alert('الرجاء كتابة المستلم والنائب (الاسم + الكود)'); return }
    const recName = recipient.split('|')[0].trim()
    const filtered = units.filter(u => (u.name.trim() || u.code.trim())).filter(u => u.name.trim() !== recName)
    const field = filtered.filter(u => u.status !== 'خارج الخدمة')
    const oos = filtered.filter(u => u.status === 'خارج الخدمة')
    const formatRow = (u) => {
      const base = `${u.name || ''}${u.name && u.code ? ' | ' + u.code : (u.code ? ' | ' + u.code : '')}`.trim()
      const annotations = []
      if(u.status === 'مشغول') annotations.push('مشغول')
      if(u.location) annotations.push(u.location)
      if(annotations.length && base) return `${base} (${annotations.join(') - (')})`
      if(annotations.length && !base) return `(${annotations.join(') - (')})`
      return base
    }
    const linesField = field.map(formatRow).join('\\n')
    const linesOOS = oos.map(u => `${u.name ? u.name : ''}${u.code ? ' | ' + u.code : ''}${u.location ? ' (' + u.location + ')' : ''}`).join('\\n')
    const out = `📌 استلام العمليات 📌

المستلم : ${recipient}

النائب : ${deputy}

عدد و اسماء الوحدات الاسعافيه في الميدان :{${field.length + 1}}
${linesField ? linesField + '\\n' : ''}
خارج الخدمة : (${oos.length})
${linesOOS ? linesOOS + '\\n' : ''}

🎙️ تم استلام العمليات و جاهزون للتعامل مع البلاغات

الملاحظات : تحديث`
    setFinalText(out)
  }

  function copyFinal(){
    navigator.clipboard.writeText(finalText || '').then(()=>{
      setToast('تم النسخ')
      setTimeout(()=>setToast(''),1600)
    })
  }

  return (
    <div className="container">
      <img src="/logo-left.png" className="logo-fixed left" alt="logo left" />
      <img src="/logo-right.png" className="logo-fixed right" alt="logo right" />
      <div className="title">تحديث مركز العمليات للصحة</div>

      <div className="toolbar">
        <button className="btn" onClick={toggleTheme}>وضع داكن/فاتح</button>
        <label className="btn violet" style={{cursor:'pointer'}}>
          رفع / لصق صورة
          <input type="file" accept="image/*" style={{display:'none'}} onChange={onFileChange} />
        </label>
      </div>

      <div className="card grid">
        <div>
          <div className="row">
            <div>
              <label className="label">المستلم</label>
              <input className="input" placeholder="الاسم | الكود" value={recipient} onChange={e=>setRecipient(e.target.value)} />
            </div>
            <div>
              <label className="label">النائب</label>
              <input className="input" placeholder="الاسم | الكود" value={deputy} onChange={e=>setDeputy(e.target.value)} />
            </div>
          </div>

          <div ref={dropRef} className="drop" style={{marginTop:10}}>
            اسحب وأفلت صورة هنا، أو الصقها بـ Ctrl+V
          </div>

          <div style={{marginTop:12}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div className="label">القائمة (اضبط الاسم/الكود/الحالة/الموقع):</div>
              <button className="btn violet" onClick={addUnit}>إضافة سطر جديد</button>
            </div>
            <div className="list" style={{maxHeight:'none'}}>
              {units.map((u,i)=>(
                <div className="item" key={i}>
                  <input className="input" value={u.name} onChange={e=>setUnit(i,'name',e.target.value)} />
                  <input className="input" value={u.code} onChange={e=>setUnit(i,'code',e.target.value)} placeholder="كود" />
                  <select className="select" value={u.status} onChange={e=>setUnit(i,'status',e.target.value)}>
                    <option>في الميدان</option>
                    <option>مشغول</option>
                    <option>خارج الخدمة</option>
                  </select>
                  <select className="select" value={u.location} onChange={e=>setUnit(i,'location',e.target.value)}>
                    {LOCATIONS.map((l,idx)=>(<option key={idx} value={l}>{l||'-- لا شيء --'}</option>))}
                  </select>
                  <button className="btn" onClick={()=>removeUnit(i)}>حذف</button>
                </div>
              ))}
            </div>
          </div>

          <div style={{marginTop:12, display:'flex', gap:10}}>
            <button className="btn violet" onClick={generate}>{busy ? 'جاري التحليل…' : 'توليد النص النهائي'}</button>
            <button className="btn" onClick={copyFinal}>نسخ النتيجة</button>
          </div>
        </div>

        <div>
          <div className="section">
            <div className="label">النتيجة النهائية</div>
            <div className="finalBox">{finalText || 'النتيجة ستظهر هنا…'}</div>
            <div className="small" style={{marginTop:8}}>المستلم يُحتسب ضمن العدد ولا يُعرض ضمن قائمة الميدان.</div>
          </div>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}