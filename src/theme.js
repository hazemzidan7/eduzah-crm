// Bright / cheerful / modern SaaS design system (replaces the old dark
// purple identity). Legacy token NAMES are kept so every existing call site
// across the app (`C.red`, `C.muted`, `C.border`, etc.) keeps working without
// a rename — only the VALUES changed, remapped to their closest semantic
// equivalent in the new palette (e.g. C.red was always "brand primary /
// active state", never literally "the color red", so it now resolves to the
// new Primary Blue). New semantic tokens are added alongside for code that
// wants the plain names directly.
export const C = {
  // Brand — legacy names, new bright values
  red: "#2563EB", rdark: "#1D4ED8",       // primary blue / hover
  orange: "#F59E0B", odark: "#D97706",    // accent orange / hover
  purple: "#8B5CF6", pdark: "#F5F3FF", pmid: "#7C3AED", // soft purple / soft-purple-tint / mid
  teal: "#14B8A6", tealDark: "#0D9488",

  // Text — legacy `muted`/`faint` remapped from "white-on-dark" to "dark-on-light"
  muted: "#64748B",           // secondary text (was near-white)
  faint: "#F1F5F9",           // faint fill (was a white overlay)
  border: "#E2E8F0",
  text: "#0F172A",            // primary text
  textSecondary: "#334155",   // body text
  textMuted: "#94A3B8",       // tertiary/placeholder text

  success: "#22C55E", danger: "#EF4444", warning: "#F59E0B",

  // Surfaces
  bg: "#F8FAFC",              // page background
  cardBg: "#FFFFFF",
  sidebarBg: "#FFFFFF",
  sidebarActiveBg: "#EFF6FF",
  sidebarActiveText: "#2563EB",
  secondaryBtnBg: "#EFF6FF",

  // Soft semantic tints (icon chips / badges) — background + matching text
  tint: {
    blue:   { bg: "#EFF6FF", text: "#2563EB" },
    green:  { bg: "#F0FDF4", text: "#16A34A" },
    orange: { bg: "#FFFBEB", text: "#D97706" },
    purple: { bg: "#F5F3FF", text: "#7C3AED" },
    pink:   { bg: "#FDF2F8", text: "#DB2777" },
    red:    { bg: "#FEF2F2", text: "#DC2626" },
    teal:   { bg: "#F0FDFA", text: "#0D9488" },
  },
};
export const font = "'Cairo',sans-serif";

/* Shared spacing/radius/shadow scale — one source of truth so cards, inputs,
   buttons and modals read as one coherent system instead of each picking
   its own numbers. */
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };
export const shadow = {
  sm: "0 1px 2px rgba(15,23,42,.06)",
  md: "0 4px 16px rgba(15,23,42,.08)",
  lg: "0 12px 32px rgba(15,23,42,.12)",
  glowRed: "0 0 0 3px rgba(37,99,235,.15)", // focus ring (legacy name kept)
};
// Very subtle, bright gradients — no glow/neon. Legacy names kept.
export const gHero  = `linear-gradient(135deg,#EFF6FF 0%,#F8FAFC 60%,#F5F3FF 100%)`;
export const gRed   = `linear-gradient(135deg,${C.red},${C.rdark})`;
export const gOr    = `linear-gradient(135deg,${C.orange},${C.odark})`;
export const gPur   = `linear-gradient(135deg,${C.purple},${C.pmid})`;
export const gDash  = `linear-gradient(135deg,#EFF6FF 0%,#F5F3FF 55%,#FFFFFF 100%)`;
