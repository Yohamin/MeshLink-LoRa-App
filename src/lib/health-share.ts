import { healthIsFresh, type NodeHealth } from "./health.ts";
import { DEMO_NETWORK_KEY } from "../constants/mesh.ts";

export type DeclaredCondition = "N" | "A" | "M" | "B";
export const declaredChoices: DeclaredCondition[] = ["A", "M", "B", "N"];
export type HealthShare = {
  measuredAt: number; heart: number | null; oxygen: number | null;
  declared: DeclaredCondition; reference: string;
};
export const declaredLabels: Record<DeclaredCondition, string> = {
  N: "Sin estado declarado", A: "Necesito ayuda", M: "Tengo molestias", B: "Me siento bien",
};
export function healthShareRequestsHelp(report: HealthShare): boolean {
  return report.declared === "A";
}
const epochValid = (seconds: number) => Number.isInteger(seconds) && seconds >= 946684800 && seconds < 4102444800;
export function assertHealthTransport(p: { encrypted: boolean; key: string; expectedKey: string; aborted: boolean; now: number; notAfter: number }) {
  if (p.aborted || !Number.isFinite(p.notAfter) || p.now > p.notAfter) throw new Error("La instantánea caducó o se canceló antes de enviarla.");
  if (!p.encrypted || p.key === DEMO_NETWORK_KEY || p.key !== p.expectedKey || p.key.trim().length < 12) {
    throw new Error("Para compartir salud activa el cifrado y configura una clave propia, distinta de la clave de demostración.");
  }
}
export function createHealthShare(h: NodeHealth | null, declared: DeclaredCondition, reference: string, now = Date.now()): HealthShare {
  const fresh = healthIsFresh(h, now);
  return { measuredAt: Math.floor((fresh && h ? h.receivedAt - h.ageMs : now) / 1000) * 1000,
    heart: fresh && h ? h.heartRateBpm : null, oxygen: fresh && h ? h.spo2Percent : null,
    declared, reference: reference.slice(-6).toUpperCase() };
}
export function encodeHealthShare(report: HealthShare): string {
  const seconds = report.measuredAt / 1000;
  if (!epochValid(seconds) || !/^[A-F0-9]{6}$/.test(report.reference) || !declaredChoices.includes(report.declared) ||
      (report.heart !== null && (!Number.isInteger(report.heart) || report.heart < 20 || report.heart > 300)) ||
      (report.oxygen !== null && (!Number.isInteger(report.oxygen) || report.oxygen < 0 || report.oxygen > 100))) {
    throw new Error("Informe inválido; revisa también la hora del teléfono.");
  }
  const text = `H1:${seconds.toString(36).padStart(7, "0")}:${report.heart ?? "-"}:${report.oxygen ?? "-"}:${report.declared}:${report.reference}`;
  if (new TextEncoder().encode(text).length > 32) throw new Error("El informe supera la capacidad de LoRa.");
  return text;
}
export function decodeHealthShare(text: string): HealthShare | null {
  const m = /^H1:([0-9a-z]{7}):(-|[0-9]{1,3}):(-|[0-9]{1,3}):([NAMB]):([A-F0-9]{6})$/.exec(text);
  if (!m) return null;
  const report: HealthShare = { measuredAt: parseInt(m[1], 36) * 1000,
    heart: m[2] === "-" ? null : Number(m[2]), oxygen: m[3] === "-" ? null : Number(m[3]),
    declared: m[4] as DeclaredCondition, reference: m[5] };
  try { return encodeHealthShare(report) === text ? report : null; } catch { return null; }
}
export function formatHealthShare(r: HealthShare): string {
  const available = r.heart !== null || r.oxygen !== null;
  const coverage = r.heart !== null && r.oxygen !== null ? "Pulso y SpO₂ incluidos"
    : available ? "Medición parcial; un valor no está disponible" : "Medición no disponible; repetir cuando sea posible";
  return `APOYO EN EMERGENCIAS · MAX30102\nEstado declarado: ${declaredLabels[r.declared]} (no evaluado por el sensor)\nPulso estimado: ${r.heart ?? "sin lectura válida"}${r.heart === null ? "" : " lpm"}\nSpO₂ estimada: ${r.oxygen ?? "sin lectura válida"}${r.oxygen === null ? "" : " %"}\n${coverage}\nHora ${available ? "de medición" : "del informe"} indicada por el emisor: ${new Date(r.measuredAt).toLocaleString()}\nRef. ${r.reference} · Instantánea, no seguimiento en vivo.\nUso orientativo; no sustituye evaluación médica.${healthShareRequestsHelp(r) ? " Solicitud de ayuda declarada; contactar a la persona. No confirma asistencia." : ""}`;
}
