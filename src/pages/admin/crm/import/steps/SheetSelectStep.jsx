import { useState } from "react";
import { Btn } from "../../../../../components/UI";
import { C } from "../../../../../theme";
import { useLang } from "../../../../../context/LangContext";

export default function SheetSelectStep({ wiz, patch, onNext, onBack }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const [selected, setSelected] = useState(new Set(wiz.selectedSheetNames));

  const toggle = (name) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const continueNext = () => {
    const chosen = wiz.parsed.sheets.filter((s) => selected.has(s.name));
    const rawRows = chosen.flatMap((s) => s.rows.map((r) => ({ ...r, __sourceSheet: s.name })));
    const headers = [...new Set(chosen.flatMap((s) => s.headers))];
    patch({ selectedSheetNames: [...selected], rawRows, headers });
    onNext();
  };

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: 15, marginTop: 0 }}>{tx("اختر الأوراق المطلوب استيرادها", "Choose which worksheets to import")}</h3>
      <p style={{ fontSize: 12.5, color: C.muted, marginBottom: 14 }}>
        {tx(
          "الأوراق المختارة سيتم دمجها معاً — نفس الشخص الموجود في أكثر من ورقة سيتم اكتشافه لاحقاً كتكرار.",
          "Selected sheets will be merged together — the same person appearing in more than one sheet will be caught later as a duplicate.",
        )}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        {wiz.parsed.sheets.map((s) => (
          <label key={s.name} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
            background: "rgba(255,255,255,.04)", borderRadius: 10, cursor: "pointer", fontSize: 13,
          }}>
            <input type="checkbox" checked={selected.has(s.name)} onChange={() => toggle(s.name)} />
            <span style={{ fontWeight: 700 }}>{s.name}</span>
            <span style={{ color: C.muted, fontSize: 11.5 }}>
              {s.headerRowIndex === null
                ? tx("بدون رأس أعمدة", "no header row")
                : tx(`رأس في الصف ${s.headerRowIndex + 1}`, `header at row ${s.headerRowIndex + 1}`)}
              {" · "}{s.headers.length} {tx("عمود", "columns")}{" · "}{s.rows.length} {tx("سجل", "records")}
            </span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn v="purple" onClick={onBack}>{tx("رجوع", "Back")}</Btn>
        <Btn v="primary" disabled={selected.size === 0} onClick={continueNext}>{tx("التالي", "Next")}</Btn>
      </div>
    </div>
  );
}
