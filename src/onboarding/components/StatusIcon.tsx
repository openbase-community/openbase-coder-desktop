import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";

export function StatusIcon({
  ok,
  severity = "warn",
}: {
  ok: boolean;
  severity?: "error" | "warn";
}) {
  if (ok) {
    return <CheckCircle2 aria-hidden className="h-4 w-4 text-emerald-500" />;
  }
  if (severity === "error") {
    return <XCircle aria-hidden className="h-4 w-4 text-red-500" />;
  }
  return <AlertCircle aria-hidden className="h-4 w-4 text-amber-500" />;
}
