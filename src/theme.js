export const C = {
  red:"#ff5c7a", rdark:"#e8486a",
  orange:"#ffb84d", odark:"#e8920f",
  purple:"#7d3d9e", pdark:"#321d3d", pmid:"#4a1f6e",
  /* Brighter muted for WCAG contrast on dark purple backgrounds */
  muted:"rgba(255,255,255,.72)", faint:"rgba(255,255,255,.09)",
  border:"rgba(255,255,255,.14)",
  success:"#34d399", danger:"#f87171", warning:"#fbbf24",
};
export const font = "'Cairo',sans-serif";
export const gHero  = "linear-gradient(135deg,#1a0a2e 0%,#321d3d 40%,#4a1f6e 100%)";
export const gRed   = `linear-gradient(135deg,${C.red},${C.rdark})`;
export const gOr    = `linear-gradient(135deg,${C.orange},${C.odark})`;
export const gPur   = `linear-gradient(135deg,${C.purple},${C.pdark})`;
export const gDash  = `linear-gradient(135deg,#321d3d 0%,#4a1f6e 55%,${C.red}bb 140%)`;
