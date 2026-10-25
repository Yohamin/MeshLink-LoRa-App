export type TrialControl =
  | { kind: "start"; runId: string; intervalMs: number }
  | { kind: "ready"; runId: string }
  | { kind: "finish"; runId: string; attempted: number; sent: number; complete: boolean }
  | { kind: "saved"; runId: string; received: number }
  | { kind: "stop"; runId: string };
// All controls fit the existing 32 UTF-8-byte encrypted-text budget.
export function encodeTrialControl(control: TrialControl): string {
  const { runId } = control;
  if (!/^[A-F0-9]{12}$/.test(runId)) throw new Error("ID de ensayo inválido.");
  const count = (n: number) => {
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error("Conteo de ensayo inválido.");
    return String(n).padStart(3, "0");
  };
  if (control.kind === "start") {
    if (!Number.isInteger(control.intervalMs / 1000) || control.intervalMs < 2000 || control.intervalMs > 60000) throw new Error("Intervalo inválido.");
    return `E1:S:${runId}:100:${String(control.intervalMs / 1000).padStart(2, "0")}`;
  }
  if (control.kind === "ready") return `E1:R:${runId}`;
  if (control.kind === "saved") return `E1:D:${runId}:${count(control.received)}`;
  if (control.kind === "stop") return `E1:X:${runId}`;
  if (control.sent > control.attempted) throw new Error("TX supera intentos.");
  if (control.complete && control.attempted !== 100) throw new Error("Un ensayo completo requiere 100 intentos.");
  return `E1:F:${runId}:${count(control.attempted)}:${count(control.sent)}:${control.complete ? "C" : "I"}`;
}
export function decodeTrialControl(text: string): TrialControl | null {
  const match = /^E1:([SRFDX]):([A-F0-9]{12})(.*)$/.exec(text);
  if (!match) return null;
  const [, kind, runId, tail] = match;
  if (kind === "R" && !tail) return { kind: "ready", runId };
  if (kind === "X" && !tail) return { kind: "stop", runId };
  const start = /^:100:(\d{2})$/.exec(tail);
  if (kind === "S" && start && Number(start[1]) >= 2 && Number(start[1]) <= 60) return { kind: "start", runId, intervalMs: Number(start[1]) * 1000 };
  const saved = /^:(\d{3})$/.exec(tail);
  if (kind === "D" && saved && Number(saved[1]) <= 100) return { kind: "saved", runId, received: Number(saved[1]) };
  const end = /^:(\d{3}):(\d{3}):([CI])$/.exec(tail);
  if (kind === "F" && end && Number(end[1]) <= 100 && Number(end[2]) <= Number(end[1]) && (end[3] !== "C" || Number(end[1]) === 100)) {
    return { kind: "finish", runId, attempted: Number(end[1]), sent: Number(end[2]), complete: end[3] === "C" };
  }
  return null;
}
