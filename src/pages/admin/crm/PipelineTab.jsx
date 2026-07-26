import { Card } from "../../../components/UI";
import { C } from "../../../theme";
import { useLang } from "../../../context/LangContext";

export default function PipelineTab() {
  const { lang } = useLang();
  const ar = lang === "ar";
  return (
    <Card style={{ padding: 32, textAlign: "center" }}>
      <div style={{ color: C.muted }}>{ar ? "خط المبيعات قادم قريباً" : "Pipeline view coming soon"}</div>
    </Card>
  );
}
