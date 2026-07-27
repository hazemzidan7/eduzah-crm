import { Badge } from "../UI";
import { C } from "../../theme";
import { useLeadStatus } from "../../context/LeadStatusContext";
import { useLang } from "../../context/LangContext";

const NOT_FOUND_COLOR = "#9ca3af";

export default function LeadStatusBadge({ statusId }) {
  const { statusById } = useLeadStatus();
  const { lang } = useLang();
  const ar = lang === "ar";
  const status = statusId ? statusById(statusId) : null;
  if (!status) return <Badge color={NOT_FOUND_COLOR}>—</Badge>;
  return <Badge color={status.color || C.purple}>{ar ? status.name_ar : status.name_en}</Badge>;
}
