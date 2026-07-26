import { useState } from "react";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import ImportWizard from "./ImportWizard";
import ImportHistoryList from "./ImportHistoryList";

export default function ImportTab() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const [section, setSection] = useState("new");

  const sections = [
    { key: "new", ar: "استيراد جديد", en: "New Import" },
    { key: "history", ar: "سجل الاستيراد", en: "History" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {sections.map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)} style={{
            padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
            fontWeight: 700, fontSize: 12, fontFamily: "'Cairo',sans-serif",
            background: section === s.key ? C.red : "rgba(255,255,255,.08)",
            color: section === s.key ? "#fff" : C.muted,
            transition: "all .2s",
          }}>{ar ? s.ar : s.en}</button>
        ))}
      </div>

      {section === "new" && <ImportWizard />}
      {section === "history" && <ImportHistoryList />}
    </div>
  );
}
