import { createContext, useContext, useState } from "react";
import { useAuth } from "./AuthContext";

const CrmNavCtx = createContext(null);

/**
 * Cross-cutting CRM navigation state — which Program is selected and which
 * section of it is showing. Lifted above CrmCatalogTab/ProgramWorkspace
 * because the Sidebar (outside that tree) needs to both read and drive it.
 */
export function CrmNavProvider({ children }) {
  const { currentUser } = useAuth();
  const [businessUnitId, setBusinessUnitId] = useState(null);
  const [programId, setProgramId] = useState(null);
  // ACCOUNTING-02: an "accounting" role user has no access to Catalog (CRM
  // data is admin-only, see firestore.rules) — land them on Accounting
  // directly instead of a section they'd just see empty/blocked.
  const [section, setSection] = useState(() => (currentUser?.role === "accounting" ? "accounting" : "catalog"));

  const selectProgram = (progId, buId) => {
    setProgramId(progId);
    setBusinessUnitId(buId);
    setSection("leads");
  };

  const goToCatalog = () => {
    setSection("catalog");
  };

  return (
    <CrmNavCtx.Provider value={{
      businessUnitId, programId, section,
      setBusinessUnitId, setProgramId, setSection,
      selectProgram, goToCatalog,
    }}>
      {children}
    </CrmNavCtx.Provider>
  );
}

export function useCrmNav() {
  const ctx = useContext(CrmNavCtx);
  if (!ctx) throw new Error("useCrmNav must be used within CrmNavProvider");
  return ctx;
}
