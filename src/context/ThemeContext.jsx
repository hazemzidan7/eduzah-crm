import { createContext, useContext, useEffect } from "react";

const STORAGE_KEY = "eduzah-theme";

const ThemeCtx = createContext(null);

/** App is dark-only; light mode was removed. */
export function ThemeProvider({ children }) {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.dataset.theme = "dark";
    body.dataset.theme = "dark";
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }, []);

  return (
    <ThemeCtx.Provider value={{ mode: "dark", isDark: true, toggle: () => {}, setMode: () => {} }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) return { mode: "dark", isDark: true, toggle: () => {}, setMode: () => {} };
  return ctx;
}
