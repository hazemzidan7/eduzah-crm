import { useEffect, useState } from "react";
import { C } from "../../../../theme";

const cellSx = {
  width: "100%", background: "transparent", border: "1px solid transparent",
  borderRadius: 6, padding: "5px 6px", color: "#fff",
  fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none",
  boxSizing: "border-box",
};
const cellFocusSx = { background: "rgba(255,255,255,.07)", border: `1px solid ${C.border}` };

/** Every cell here manages its own draft so typing doesn't fight the live
 * Firestore snapshot; it commits on blur (text/number) or immediately on
 * change (select/date), then lets the prop value reconcile afterward. */
export function InlineText({ value, onSave, placeholder, minWidth = 110 }) {
  const [draft, setDraft] = useState(value || "");
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(value || ""); }, [value, focused]);
  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); if (draft !== (value || "")) onSave(draft); }}
      style={{ ...cellSx, ...(focused ? cellFocusSx : {}), minWidth }}
    />
  );
}

export function InlineNumber({ value, onSave, minWidth = 90 }) {
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
      type="number" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      style={{ ...cellSx, ...(focused ? cellFocusSx : {}), minWidth, textAlign: "end" }}
    />
  );
}

export function InlineDate({ value, onSave }) {
  return (
    <input
      type="date" value={value || ""}
      onChange={(e) => onSave(e.target.value || null)}
      style={{ ...cellSx, minWidth: 130, colorScheme: "dark" }}
    />
  );
}

export function InlineSelect({ value, onSave, options, minWidth = 120 }) {
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

/** A derived (formula) cell — never directly editable, just displayed. */
export function ComputedMoney({ value, color }) {
  return (
    <div style={{ padding: "5px 6px", fontSize: 12.5, fontWeight: 700, color: color || C.muted, minWidth: 90, textAlign: "end" }}>
      {(value || 0).toLocaleString()}
    </div>
  );
}
