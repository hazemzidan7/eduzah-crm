import { C } from "../../theme";
import { useCatalog } from "../../context/CatalogContext";

/**
 * Single-select over the live catalog: every ACTIVE Program under every
 * Business Unit — the same list the Catalog screen and the Interested
 * Programs picker use. There is no free-text path: the value is always the id
 * of an existing Program, so a fake or misspelled Program can't be entered.
 * No Business-Unit restriction is applied (Sales may pick any active Program).
 */
export default function ProgramSelect({ label, value, onChange, placeholder, disabled = false, invalid = false, ar }) {
  const { businessUnits, programsUnder } = useCatalog();
  const groups = businessUnits
    .map((bu) => ({ bu, programs: programsUnder(bu.id) }))
    .filter((g) => g.programs.length > 0);
  // A stored id whose Program is no longer active must still be visible, but can't be re-chosen.
  const known = groups.some((g) => g.programs.some((p) => p.id === value));
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 4 }}>{label}</label>}
      <select
        value={known ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={invalid}
        style={{ width: "100%", boxSizing: "border-box", background: "#fff", border: `1.5px solid ${invalid ? C.danger : C.border}`, borderRadius: 10, padding: "10px 12px", fontFamily: "'Cairo',sans-serif", fontSize: 13, outline: "none", cursor: disabled ? "default" : "pointer" }}
      >
        <option value="">{placeholder || (ar ? "— اختر كورس —" : "— Select a program —")}</option>
        {groups.map(({ bu, programs }) => (
          <optgroup key={bu.id} label={ar ? (bu.name_ar || bu.name_en) : bu.name_en}>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name_en || p.name_ar}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
