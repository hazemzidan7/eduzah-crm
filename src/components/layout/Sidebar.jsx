import { useState } from "react";
import { C } from "../../theme";
import { useLang } from "../../context/LangContext";
import { useAuth } from "../../context/AuthContext";
import { useCatalog } from "../../context/CatalogContext";
import { useCrmNav } from "../../context/CrmNavContext";
import {
  IconPeople, IconGrid, IconBell, IconHistory, IconBox, IconBarChart,
  IconGear, IconChevronDown, IconChevronRight, IconChevronsCollapse,
} from "../Icons";

const primaryItems = [
  { key: "leads", ar: "العملاء", en: "Leads", Icon: IconPeople },
  { key: "pipeline", ar: "خط المبيعات", en: "Pipeline", Icon: IconGrid },
  { key: "reminders", ar: "المتابعات", en: "Reminders", Icon: IconBell },
  { key: "importHistory", ar: "سجل الاستيراد", en: "Import History", Icon: IconHistory },
];

const bottomItems = [
  { key: "reports", ar: "التقارير", en: "Reports", Icon: IconBarChart },
  { key: "users", ar: "المستخدمون", en: "Users", Icon: IconPeople },
  { key: "settings", ar: "الإعدادات", en: "Settings", Icon: IconGear },
];

function NavRow({ active, disabled, indent = 0, onClick, icon, label, title, trailing }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: `9px 12px 9px ${12 + indent}px`, marginBottom: 2,
        border: "none", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
        background: active ? C.red : (hover && !disabled ? "rgba(255,255,255,.07)" : "transparent"),
        color: active ? "#fff" : disabled ? "rgba(255,255,255,.32)" : "rgba(255,255,255,.82)",
        fontFamily: "'Cairo',sans-serif", fontSize: 13, fontWeight: active ? 800 : 600,
        transition: "background .15s, color .15s", textAlign: "start",
      }}
    >
      {icon}
      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {trailing}
    </button>
  );
}

export default function Sidebar() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { currentUser, logout } = useAuth();
  const { businessUnits, programsUnder } = useCatalog();
  const { businessUnitId, programId, section, setSection, selectProgram, goToCatalog } = useCrmNav();

  const [collapsed, setCollapsed] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [expandedBU, setExpandedBU] = useState(businessUnitId);

  const hasProgram = !!programId;

  return (
    <aside style={{
      width: collapsed ? 68 : 240, flexShrink: 0, minHeight: "100vh",
      background: "#2c1a3a", borderInlineEnd: "1px solid rgba(255,255,255,.08)",
      display: "flex", flexDirection: "column", padding: "16px 10px",
      transition: "width .18s ease", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 18px", whiteSpace: "nowrap" }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: C.red, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#fff", flexShrink: 0 }}>E</div>
        {!collapsed && (
          <div>
            <div style={{ fontWeight: 900, fontSize: 15, lineHeight: 1.1 }}>Eduzah</div>
            <div style={{ fontWeight: 800, fontSize: 11, color: C.red, letterSpacing: 0.5 }}>CRM</div>
          </div>
        )}
      </div>

      <nav style={{ flex: 1, overflowY: "auto" }}>
        {primaryItems.map((it) => (
          <NavRow
            key={it.key}
            active={section === it.key}
            disabled={!hasProgram}
            title={!hasProgram ? tx("اختر برنامجًا أولًا", "Select a Program first") : undefined}
            onClick={() => setSection(it.key)}
            icon={<it.Icon size={18} />}
            label={collapsed ? "" : (ar ? it.ar : it.en)}
          />
        ))}

        {!collapsed && <div style={{ height: 1, background: "rgba(255,255,255,.08)", margin: "10px 4px" }} />}

        <NavRow
          active={section === "catalog"}
          onClick={() => { setCatalogOpen((o) => !o); goToCatalog(); }}
          icon={<IconBox size={18} />}
          label={collapsed ? "" : tx("الكتالوج", "Catalog")}
          trailing={!collapsed ? (catalogOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />) : null}
        />

        {!collapsed && catalogOpen && (
          <div>
            {businessUnits.map((bu) => {
              const open = expandedBU === bu.id;
              return (
                <div key={bu.id}>
                  <NavRow
                    active={businessUnitId === bu.id && !programId}
                    indent={14}
                    onClick={() => setExpandedBU(open ? null : bu.id)}
                    icon={null}
                    label={ar ? bu.name_ar : bu.name_en}
                    trailing={open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                  />
                  {open && programsUnder(bu.id).map((p) => (
                    <NavRow
                      key={p.id}
                      active={programId === p.id}
                      indent={28}
                      onClick={() => selectProgram(p.id, bu.id)}
                      icon={null}
                      label={p.name_en}
                    />
                  ))}
                </div>
              );
            })}
            <NavRow
              disabled
              indent={14}
              title={tx("قريبًا", "Coming soon")}
              icon={null}
              label={tx("الدفعات", "Batches")}
            />
          </div>
        )}

        {!collapsed && <div style={{ height: 1, background: "rgba(255,255,255,.08)", margin: "10px 4px" }} />}

        {bottomItems.map((it) => (
          <NavRow
            key={it.key}
            active={section === it.key}
            onClick={() => setSection(it.key)}
            icon={<it.Icon size={18} />}
            label={collapsed ? "" : (ar ? it.ar : it.en)}
          />
        ))}
      </nav>

      <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 10, marginTop: 8 }}>
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 10px" }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.red, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", flexShrink: 0, fontSize: 12.5 }}>
              {currentUser?.avatar || "?"}
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser?.name || currentUser?.email}</div>
              <div style={{ fontSize: 10.5, color: C.muted, textTransform: "capitalize" }}>{currentUser?.role}</div>
            </div>
            <button onClick={logout} title={tx("خروج", "Logout")} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Cairo',sans-serif" }}>{tx("خروج", "Logout")}</button>
          </div>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
            padding: "7px 0", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8,
            background: "transparent", color: C.muted, cursor: "pointer",
          }}
        >
          <span style={{ transform: collapsed ? "rotate(180deg)" : "none", display: "flex" }}><IconChevronsCollapse size={16} /></span>
        </button>
      </div>
    </aside>
  );
}
