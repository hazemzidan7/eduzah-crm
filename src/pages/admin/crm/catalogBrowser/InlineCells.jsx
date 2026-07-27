import { useEffect, useState } from "react";
import { C } from "../../../../theme";

const cellSx = {
  width: "100%", background: "transparent", border: "1px solid transparent",
  borderRadius: 6, padding: "5px 6px", color: "#fff",
  fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none",
  boxSizing: "border-box", transition: "background .15s, border-color .15s",
};
const cellFocusSx = { background: "rgba(255,255,255,.08)", border: `1px solid ${C.red}88` };

/** Every cell here manages its own draft so typing doesn't fight the live
 * Firestore snapshot; it commits on blur (text/number) or immediately on
 * change (select/date), then lets the prop value reconcile afterward.
 * Widths are floors, not fixed sizes — columns shrink to fit short content
 * (an "Online/Offline" cell shouldn't reserve the same space as an email). */
export function InlineText({ value, onSave, placeholder, minWidth = 80, size = 12 }) {
  const [draft, setDraft] = useState(value || "");
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(value || ""); }, [value, focused]);
  return (
    <input
      value={draft}
      placeholder={placeholder}
      size={size}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); if (draft !== (value || "")) onSave(draft); }}
      style={{ ...cellSx, ...(focused ? cellFocusSx : {}), minWidth, width: "auto" }}
    />
  );
}

export function InlineNumber({ value, onSave, minWidth = 64 }) {
  const [draft, setDraft] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(value ?? ""); }, [value, focused]);
  const commit = () => {
    setFocused(false);
    const num = draft === "" ? null : Number(draft);
    if ((num ?? null) !== (value ?? null)) onSave(Number.isFinite(num) ? num : null);
  };
  return (
    <input
      type="number" value={draft} size={6}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      style={{ ...cellSx, ...(focused ? cellFocusSx : {}), minWidth, width: "auto", textAlign: "end" }}
    />
  );
}

export function InlineDate({ value, onSave }) {
  return (
    <input
      type="date" value={value || ""}
      onChange={(e) => onSave(e.target.value || null)}
      style={{ ...cellSx, minWidth: 112, colorScheme: "dark" }}
    />
  );
}

export function InlineSelect({ value, onSave, options, minWidth = 84 }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onSave(e.target.value || null)}
      style={{ ...cellSx, minWidth, background: "#241536", cursor: "pointer" }}
    >
      {options.map((o) => <option key={o.v} value={o.v} style={{ background: "#321d3d" }}>{o.l}</option>)}
    </select>
  );
}

/** A colored-pill select — reads as a status badge at a glance, but is a
 * real dropdown for one-click changes. Same color language as Badge/
 * LeadStatusBadge (tinted background, tinted border, white text). */
export function InlineStatusSelect({ value, onSave, options, color }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onSave(e.target.value || null)}
      style={{
        appearance: "none", WebkitAppearance: "none", cursor: "pointer",
        minWidth: 108, width: "100%", boxSizing: "border-box",
        background: color ? `${color}40` : "rgba(255,255,255,.08)",
        border: `1px solid ${color ? color + "b0" : C.border}`,
        color: "#fff", fontWeight: 800, fontSize: 11.5, letterSpacing: 0.2,
        borderRadius: 999, padding: "5.5px 22px 5.5px 11px",
        fontFamily: "'Cairo',sans-serif", outline: "none",
        textShadow: "0 1px 2px rgba(0,0,0,.35)",
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='white' opacity='0.7'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center", backgroundSize: "12px",
        transition: "background .15s, border-color .15s",
      }}
    >
      {options.map((o) => <option key={o.v} value={o.v} style={{ background: "#321d3d", color: "#fff" }}>{o.l}</option>)}
    </select>
  );
}

/** A derived (formula) cell — never directly editable, just displayed. */
export function ComputedMoney({ value, color }) {
  return (
    <div style={{ padding: "5px 6px", fontSize: 12.5, fontWeight: 700, color: color || C.muted, minWidth: 70, textAlign: "end" }}>
      {(value || 0).toLocaleString()}
    </div>
  );
}
