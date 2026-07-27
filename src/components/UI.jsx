import { useState, useRef } from "react";
import { C, font, radius, shadow } from "../theme";

export function Btn({ children, onClick, v="primary", sm, full, disabled, style={}, type = "button", title, ...rest }) {
  const cls = `btn-base ${sm ? "btn-sm" : "btn-md"} btn-${v}${full ? " btn-full" : ""}`;
  return (
    <button
      type={type} disabled={disabled} title={title}
      onClick={disabled ? undefined : onClick}
      className={cls}
      style={style}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ children, style={}, onClick }) {
  const [h,setH] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{
        color:"rgba(248,250,252,.96)",
        background:h?"rgba(116,62,148,.72)":"rgba(94,50,120,.62)",
        border:`1px solid ${h?C.purple+"66":"rgba(255,255,255,.18)"}`,
        borderRadius:radius.lg, padding:22, backdropFilter:"blur(12px)",
        boxShadow: h ? shadow.md : shadow.sm,
        transition:"background .2s, border-color .2s, box-shadow .25s",
        cursor:onClick?"pointer":"default",
        ...style,
      }}>
      {children}
    </div>
  );
}

export function PBar({ value, color=C.red, h=6 }) {
  return (
    <div style={{background:C.faint,borderRadius:radius.pill,height:h,overflow:"hidden"}}>
      <div style={{width:`${value}%`,height:"100%",background:color,borderRadius:radius.pill,transition:"width .6s"}}/>
    </div>
  );
}

export function Badge({ children, color=C.red }) {
  return <span style={{background:color+"40",color:"#fff",border:`1px solid ${color}b0`,borderRadius:radius.pill,padding:"4.5px 12px",fontSize:11.5,fontWeight:800,whiteSpace:"nowrap",letterSpacing:0.3,display:"inline-block",textShadow:"0 1px 2px rgba(0,0,0,.35)"}}>{children}</span>;
}

export function Stars({ n=5 }) {
  return <span style={{color:C.orange,fontSize:13}}>{"★".repeat(n)}{"☆".repeat(5-n)}</span>;
}

function CalSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function ClockSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Native date/time with invisible system icon + SVG; opens picker via showPicker() when the icon strip is clicked (WebKit hit-target is unreliable). */
function DarkPickerWrap({ type, value, onChange, style = {}, placeholder, onFocus, onBlur, ...rest }) {
  const inputRef = useRef(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const cls = type === "date" ? "edu-date-input" : "edu-time-input";
  const iconColor = focus ? C.red : hover ? "#f8fafc" : "rgba(226, 232, 240, 0.92)";

  const openPicker = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = inputRef.current;
    if (!el || el.disabled || el.readOnly) return;
    if (typeof el.showPicker === "function") {
      void el.showPicker().catch(() => {});
      return;
    }
    el.focus();
  };

  return (
    <div
      style={{ position: "relative", width: "100%" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onFocus={(e) => {
          setFocus(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          onBlur?.(e);
        }}
        className={cls}
        style={{ ...style, width: "100%", position: "relative", boxSizing: "border-box", paddingInlineEnd: 44 }}
        {...rest}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={type === "date" ? "فتح التقويم" : "فتح اختيار الوقت"}
        onClick={openPicker}
        style={{
          position: "absolute",
          insetInlineEnd: 0,
          top: 0,
          bottom: 0,
          width: 48,
          margin: 0,
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          zIndex: 1,
        }}
      />
      <span
        aria-hidden
        style={{
          position: "absolute",
          insetInlineEnd: 10,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: iconColor,
          transition: "color 0.2s ease",
          zIndex: 2,
        }}
      >
        {type === "date" ? <CalSvg /> : <ClockSvg />}
      </span>
    </div>
  );
}

export function DarkDateInput({ value, onChange, style = {}, ...rest }) {
  return <DarkPickerWrap type="date" value={value} onChange={onChange} style={style} {...rest} />;
}

export function DarkTimeInput({ value, onChange, style = {}, ...rest }) {
  return <DarkPickerWrap type="time" value={value} onChange={onChange} style={style} {...rest} />;
}

const fieldBaseSx = (error, focused) => ({
  background:"rgba(255,255,255,.055)",
  border:`1.5px solid ${error?C.danger:focused?C.red:C.border}`,
  borderRadius:radius.md, padding:"11px 14px",
  color:"#fff", fontFamily:font, fontSize:13, outline:"none",
  width:"100%", boxSizing:"border-box",
  boxShadow: focused ? shadow.glowRed : "none",
  transition:"border-color .18s, box-shadow .18s, background .18s",
});

export function Input({ label, value, onChange, type="text", placeholder="", error, rows }) {
  const [f,setF] = useState(false);
  const style = fieldBaseSx(error, f);
  const isPicker = type === "date" || type === "time";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
      {label && <label style={{fontSize:12,fontWeight:700,color:C.muted}}>{label}</label>}
      {rows
        ? <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} onFocus={()=>setF(true)} onBlur={()=>setF(false)} style={{...style,resize:"vertical"}}/>
        : isPicker
          ? <DarkPickerWrap
              type={type}
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder={placeholder}
              onFocus={() => setF(true)}
              onBlur={() => setF(false)}
              style={style}
            />
          : <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} onFocus={()=>setF(true)} onBlur={()=>setF(false)} style={style} onMouseEnter={(e)=>{if(!f)e.target.style.borderColor=C.muted;}} onMouseLeave={(e)=>{if(!f)e.target.style.borderColor=error?C.danger:C.border;}}/>}
      {error && <span style={{color:C.danger,fontSize:11,fontWeight:600}}>{error}</span>}
    </div>
  );
}

export function Select({ label, value, onChange, options=[] }) {
  const [f,setF] = useState(false);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
      {label && <label style={{fontSize:12,fontWeight:700,color:C.muted}}>{label}</label>}
      <select value={value} onChange={e=>onChange(e.target.value)} onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        style={{background:"#2a1540",border:`1.5px solid ${f?C.red:C.border}`,borderRadius:radius.md,padding:"11px 14px",color:"#fff",fontFamily:font,fontSize:13,outline:"none",cursor:"pointer",boxShadow:f?shadow.glowRed:"none",transition:"border-color .18s, box-shadow .18s"}}>
        {options.map(o => <option key={o.v} value={o.v} style={{background:"#321d3d"}}>{o.l}</option>)}
      </select>
    </div>
  );
}

export function Modal({ children, onClose, title }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(10,4,18,.78)",backdropFilter:"blur(3px)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:"#2a1540",border:`1px solid ${C.border}`,borderRadius:radius.lg,padding:26,maxWidth:520,width:"100%",maxHeight:"88vh",overflow:"auto",boxShadow:shadow.lg,animation:"fadeUp .22s ease"}} onClick={e=>e.stopPropagation()}>
        {title && <div style={{fontWeight:800,fontSize:16,marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          {title}
          <button style={{background:"rgba(255,255,255,.06)",border:"none",borderRadius:radius.pill,width:28,height:28,color:C.muted,fontSize:15,cursor:"pointer",fontFamily:font,transition:"background .15s, color .15s"}}
            onMouseEnter={(e)=>{e.currentTarget.style.background="rgba(255,255,255,.14)";e.currentTarget.style.color="#fff";}}
            onMouseLeave={(e)=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.color=C.muted;}}
            onClick={onClose}>✕</button>
        </div>}
        {children}
      </div>
    </div>
  );
}
