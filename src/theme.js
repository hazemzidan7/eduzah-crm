export const C = {
  red:"#d91b5b", rdark:"#b81650",
  orange:"#faa633", odark:"#e0901f",
  purple:"#672d86", pdark:"#321d3d", pmid:"#844bab",
  /* Brighter muted for WCAG contrast on dark purple backgrounds */
  muted:"rgba(255,255,255,.80)", faint:"rgba(255,255,255,.09)",
  border:"rgba(255,255,255,.14)",
  success:"#34d399", danger:"#f87171", warning:"#fbbf24",
  /* Status-family colors — used only where the unified status vocabulary
     explicitly calls for a hue outside the 4 brand colors. */
  info:"#3b82f6", statusGreen:"#22c55e", statusEmerald:"#10b981",
  statusGray:"#6b7280", statusSlate:"#94a3b8",
};
export const font = "'Cairo',sans-serif";

/* Shared spacing/radius/shadow scale — one source of truth so cards, inputs,
   buttons and modals read as one coherent system instead of each picking
   its own numbers. */
export const radius = { sm: 8, md: 10, lg: 16, pill: 999 };
export const shadow = {
  sm: "0 1px 2px rgba(0,0,0,.18)",
  md: "0 4px 16px rgba(0,0,0,.22)",
  lg: "0 12px 32px rgba(0,0,0,.32)",
  glowRed: "0 0 0 3px rgba(217,27,91,.24)",
};
export const gHero  = `linear-gradient(135deg,#241531 0%,#3a2247 40%,${C.pmid} 100%)`;
export const gRed   = `linear-gradient(135deg,${C.red},${C.rdark})`;
export const gOr    = `linear-gradient(135deg,${C.orange},${C.odark})`;
export const gPur   = `linear-gradient(135deg,${C.purple},${C.pdark})`;
export const gDash  = `linear-gradient(135deg,#3a2247 0%,${C.pmid} 55%,${C.red}bb 140%)`;
