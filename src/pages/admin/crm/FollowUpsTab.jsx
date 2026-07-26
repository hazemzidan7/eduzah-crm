import { Card } from "../../../components/UI";
import { C } from "../../../theme";
import { useLang } from "../../../context/LangContext";

export default function FollowUpsTab() {
  const { lang } = useLang();
  const ar = lang === "ar";
  return (
    <Card style={{ padding: 32, textAlign: "center" }}>
      <div style={{ color: C.muted }}>{ar ? "قائمة المتابعات قادمة قريباً" : "Follow-ups list coming soon"}</div>
    </Card>
  );
}
