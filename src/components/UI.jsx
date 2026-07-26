import { useState, useRef } from "react";
import { C, font } from "../theme";

export function Btn({ children, onClick, v="primary", sm, full, disabled, style={}, type = "button", ...rest }) {
  const [h,setH] = useState(false);
  const vs = {
    primary: { bg: h?C.rdark:C.red, color:"#fff" },
    outline:  { bg: h?C.faint:"transparent", color:"#fff", border:`1.5px solid ${C.border}` },
    orange:   { bg: h?C.odark:C.orange, color:C.pdark },
    ghost:    { bg:"transparent", color:C.muted, border:"none" },
    danger:   { bg: h?"#dc2626":C.danger, color:"#fff" },
    success:  { bg: h?"#059669":C.success, color:"#fff" },
    purple:   { bg: h?"#5b21b6":C.purple, color:"#fff" },
  };
  const s = vs[v]||vs.primary;
  return (
    <button type={type} disabled={disabled} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} onClick={disabled?undefined:onClick}
      style={{background:disabled?"#555":s.bg,color:s.color,border:s.border||"none",borderRadius:10,padding:sm?"5px 12px":"9px 20px",fontFamily:font,fontWeight:700,fontSize:sm?12:13,cursor:disabled?"not-allowed":"pointer",transition:"all .2s",width:full?"100%":"auto",opacity:disabled?.6:1,...style}}
      {...rest}>
      {children}
    </button>
  );
}

export function Card({ children, style={}, onClick }) {
  const [h,setH] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{color:"rgba(248,250,252,.96)",background:h?"rgba(103,45,134,.22)":"rgba(50,29,61,.58)",border:`1px solid ${h?C.purple+"55":C.border}`,borderRadius:18,padding:20,backdropFilter:"blur(12px)",transition:"all .25s",cursor:onClick?"pointer":"default",...style}}>
      {children}
    </div>
  );
}

export function PBar({ value, color=C.red, h=6 }) {
  return (
    <div style={{background:C.faint,borderRadius:99,height:h,overflow:"hidden"}}>
      <div style={{width:`${value}%`,height:"100%",background:color,borderRadius:99,transition:"width .6s"}}/>
    </div>
  );
}

export function Badge({ children, color=C.red }) {
  return <span style={{background:color+"44",color:"#fff",border:`1px solid ${color}99`,borderRadius:50,padding:"3px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",letterSpacing:0.3}}>{children}</span>;
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

export function Input({ label, value, onChange, type="text", placeholder="", error, rows }) {
  const [f,setF] = useState(false);
  const style = {background:"rgba(255,255,255,.06)",border:`1.5px solid ${error?C.danger:f?C.red:C.border}`,borderRadius:10,padding:"9px 13px",color:"#fff",fontFamily:font,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box",transition:"border-color .2s"};
  const isPicker = type === "date" || type === "time";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:12}}>
      {label && <label style={{fontSize:12,fontWeight:600,color:C.muted}}>{label}</label>}
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
          : <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} onFocus={()=>setF(true)} onBlur={()=>setF(false)} style={style}/>}
      {error && <span style={{color:C.danger,fontSize:11}}>{error}</span>}
    </div>
  );
}

export function Select({ label, value, onChange, options=[] }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:12}}>
      {label && <label style={{fontSize:12,fontWeight:600,color:C.muted}}>{label}</label>}
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{background:"#2a1540",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"9px 13px",color:"#fff",fontFamily:font,fontSize:13,outline:"none"}}>
        {options.map(o => <option key={o.v} value={o.v} style={{background:"#321d3d"}}>{o.l}</option>)}
      </select>
    </div>
  );
}

export function Modal({ children, onClose, title }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:"#2a1540",border:`1px solid ${C.border}`,borderRadius:20,padding:24,maxWidth:520,width:"100%",maxHeight:"88vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}>
        {title && <div style={{fontWeight:800,fontSize:16,marginBottom:18,display:"flex",justifyContent:"space-between"}}>
          {title}
          <button style={{background:"none",border:"none",color:C.muted,fontSize:20,cursor:"pointer",fontFamily:font}} onClick={onClose}>✕</button>
        </div>}
        {children}
      </div>
    </div>
  );
}
