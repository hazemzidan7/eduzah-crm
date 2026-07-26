import { Card } from "../../../components/UI";
import { C } from "../../../theme";
import { useLang } from "../../../context/LangContext";

export default function CrmDashboardTab() {
  const { lang } = useLang();
  const ar = lang === "ar";
  return (
    <Card style={{ padding: 32, textAlign: "center" }}>
      <div style={{ color: C.muted }}>{ar ? "لوحة معلومات CRM قادمة قريباً" : "CRM Dashboard coming soon"}</div>
    </Card>
  );
}
