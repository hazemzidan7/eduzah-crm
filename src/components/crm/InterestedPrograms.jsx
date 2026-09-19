import { useState } from "react";
import { Modal, Btn } from "../UI";
import { C } from "../../theme";
import { useLang } from "../../context/LangContext";
import { useCatalog } from "../../context/CatalogContext";
import { useCustomers } from "../../context/CustomerContext";
import { customerInterestedProgramIds } from "../../utils/interestedPrograms";

/**
 * INTEREST-01 — "الكورسات المهتم بيها" / "Interested Programs".
 * Lead information only: it never creates an engagement/registration/
 * payment. See utils/interestedPrograms.js for the data model.
 */

export const INTEREST_ONLY_NOTE_AR = "اهتمام فقط — اختيار كورس هنا لا يعني تسجيل أو حجز أو دفع.";
export const INTEREST_ONLY_NOTE_EN = "Interest only — selecting a program here is not a registration, booking, or payment.";

/** Human label for one stored id — Program names always render in English, same as everywhere else in the CRM. */
function useProgramLabel() {
  const { nodeById } = useCatalog();
  return (id, tx) => {
    const node = nodeById(id);
    if (!node) return { label: tx("كورس غير متاح", "Unavailable program"), archived: true };
    return { label: node.name_en || node.name_ar || id, archived: node.isActive === false || !!node.archivedAt };
  };
}

const chipBase = {
  display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 11px", borderRadius: 99,
  fontSize: 11.5, fontWeight: 700, fontFamily: "'Cairo',sans-serif", border: "1px solid",
};

/** Read-only chips for a list of Program ids. */
export function InterestedProgramChips({ ids, tx, emptyLabel }) {
  const labelFor = useProgramLabel();
  const list = ids || [];
  if (list.length === 0) {
    return <div style={{ fontSize: 12, color: C.muted }}>{emptyLabel ?? tx("لا توجد كورسات مسجّلة كاهتمام", "No interests recorded")}</div>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {list.map((id) => {
        const { label, archived } = labelFor(id, tx);
        return (
          <span key={id} dir="ltr" style={{ ...chipBase, background: archived ? "#F1F5F9" : `${C.purple}14`, borderColor: archived ? C.border : `${C.purple}44`, color: archived ? C.muted : C.text }}>
            {label}{archived ? ` (${tx("مؤرشف", "archived")})` : ""}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Multi-select over the live catalog: every active Program under every
 * Business Unit (same source and same ordering the Catalog screen uses —
 * nothing is created or invented here). `value` is the selected id array.
 * A stored id whose Program has since been archived/removed still shows in
 * the "selected" strip so it can be seen and explicitly removed, but cannot
 * be re-added from the list.
 */
export function InterestedProgramsPicker({ value, onChange }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { businessUnits, programsUnder } = useCatalog();
  const labelFor = useProgramLabel();
  const [q, setQ] = useState("");

  const selected = value || [];
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const query = q.trim().toLowerCase();

  const groups = businessUnits
    .map((bu) => ({
      bu,
      programs: programsUnder(bu.id).filter((p) => !query || (p.name_en || "").toLowerCase().includes(query) || (p.name_ar || "").includes(q.trim())),
    }))
    .filter((g) => g.programs.length > 0);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 2 }}>
        {tx("الكورسات المهتم بيها", "Interested Programs")} <span style={{ fontWeight: 600 }}>({tx("اختياري", "optional")})</span>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{ar ? INTEREST_ONLY_NOTE_AR : INTEREST_ONLY_NOTE_EN}</div>

      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {selected.map((id) => {
            const { label, archived } = labelFor(id, tx);
            return (
              <button
                key={id} type="button" onClick={() => toggle(id)} dir="ltr"
                title={tx("إزالة", "Remove")}
                style={{ ...chipBase, cursor: "pointer", background: archived ? "#F1F5F9" : `${C.purple}22`, borderColor: archived ? C.border : C.purple, color: archived ? C.muted : C.text }}
              >
                {label}{archived ? ` (${tx("مؤرشف", "archived")})` : ""} <span aria-hidden style={{ fontWeight: 900 }}>×</span>
              </button>
            );
          })}
        </div>
      )}

      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={tx("ابحث عن كورس…", "Search programs…")}
        style={{ width: "100%", boxSizing: "border-box", background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", marginBottom: 8 }}
      />

      <div style={{ maxHeight: 230, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 10px", background: "#FAFBFC" }}>
        {groups.length === 0 && <div style={{ fontSize: 12, color: C.muted, padding: 6 }}>{tx("لا توجد نتائج", "No matching programs")}</div>}
        {groups.map(({ bu, programs }) => (
          <div key={bu.id} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", marginBottom: 5 }}>{ar ? bu.name_ar : bu.name_en}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {programs.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <button
                    key={p.id} type="button" onClick={() => toggle(p.id)} dir="ltr" aria-pressed={on}
                    style={{ ...chipBase, cursor: "pointer", background: on ? `${C.purple}22` : "#fff", borderColor: on ? C.purple : C.border, color: on ? C.text : C.muted }}
                  >
                    {on ? "✓ " : ""}{p.name_en}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Edit one existing customer's interest list. Saves via CustomerContext.setCustomerInterestedPrograms (customer doc only). */
export function InterestedProgramsModal({ customer, onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { setCustomerInterestedPrograms } = useCustomers();
  const [ids, setIds] = useState(() => customerInterestedProgramIds(customer));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await setCustomerInterestedPrograms(customer.id, ids);
      onClose();
    } catch (e) {
      setError(e?.message?.startsWith("INVALID_INTERESTED_PROGRAMS")
        ? tx("في كورس مش متاح — اختار من القائمة فقط", "A selected program isn't available — pick from the list only")
        : tx("تعذّر الحفظ", "Couldn't save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={tx("الكورسات المهتم بيها", "Interested Programs")} onClose={onClose}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12 }}>
        {customer.fullName || "—"} <span dir="ltr" style={{ color: C.muted, fontWeight: 600 }}>· {customer.phone || "—"}</span>
      </div>
      <InterestedProgramsPicker value={ids} onChange={setIds} />
      {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn v="purple" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
        <Btn v="primary" disabled={saving} onClick={save}>{saving ? tx("جارٍ الحفظ…", "Saving…") : tx("حفظ", "Save")}</Btn>
      </div>
    </Modal>
  );
}
