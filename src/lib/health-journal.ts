import type { NodeHealth } from "./health.ts";
import { healthIsFresh } from "./health.ts";
import { encodeHealthShare, type HealthShare } from "./health-share.ts";

export const HEALTH_MAX_RECORDS = 1800;
const ROOT = "@meshlink/health-v1", PAGE = 32;
type Store = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<unknown>; removeItem(k: string): Promise<unknown> };
export type HealthSession = {
  id: string; label: string; nodeId: string; bootId: string; board: string; firmwareVersion: string;
  appVersion: string; diagnosticRevision: number; startedAt: number; endedAt: number | null;
  endReason: string; records: number; deleting?: boolean;
};
export type HealthRecord = { at: number; type: "sample"; health: NodeHealth } |
  { at: number; type: "share"; destination: string; report: HealthShare; outcome: "attempt" | "submitted" | "failed"; requestId: string };
export type HealthArchive = { schema: 1; session: HealthSession; records: HealthRecord[]; coverage: string };
export class HealthJournal {
  sessions: HealthSession[] = [];
  activeId: string | null = null;
  ready = false;
  error: string | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private lastUptime = -1;
  private pending = 0;
  private store: Store;
  private changed: () => void;
  constructor(store: Store, changed: () => void = () => {}) { this.store = store; this.changed = changed; }
  private enqueue<T>(job: () => Promise<T>, rescue = false): Promise<T> {
    const task = this.tail.then(async () => {
      if (this.error && !rescue) throw new Error(this.error);
      try { return await job(); }
      catch (e) {
        this.error = e instanceof Error ? e.message : String(e); this.activeId = null; this.changed(); throw e;
      }
    });
    this.tail = task.catch(() => {});
    return task;
  }
  private async index() { await this.store.setItem(`${ROOT}/index`, JSON.stringify(this.sessions)); this.changed(); }
  private async rows(s: HealthSession) {
    const records: HealthRecord[] = [];
    for (let p = 0; p <= Math.floor(HEALTH_MAX_RECORDS / PAGE); ++p) {
      const raw = await this.store.getItem(`${ROOT}/${s.id}/${p}`);
      if (!raw) break;
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows) || rows.length > PAGE || rows.some(r => !r || !Number.isFinite(r.at) || !["sample", "share"].includes(r.type))) {
        throw new Error("Página de mediciones dañada; no se sobrescribió.");
      }
      records.push(...rows);
      if (rows.length < PAGE) break;
    }
    if (records.length < s.records) throw new Error("Faltan registros de esta sesión; conserva la app y sus archivos.");
    return records;
  }
  init() { return this.enqueue(async () => {
    if (this.ready) return;
    const raw = await this.store.getItem(`${ROOT}/index`);
    const sessions = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(sessions) || sessions.some(s => !s || !/^[A-F0-9]{12}$/.test(s.id) ||
      !Number.isInteger(s.records) || s.records < 0 || s.records > HEALTH_MAX_RECORDS)) throw new Error("Índice de mediciones inválido.");
    this.sessions = sessions;
    for (const s of [...this.sessions]) {
      if (s.deleting) { await this.purge(s); continue; }
      const rows = await this.rows(s); s.records = rows.length;
      if (s.endedAt === null) {
        s.endedAt = rows.at(-1)?.at ?? s.startedAt; s.endReason = "app_interrupted";
      }
    }
    await this.index(); this.ready = true; this.changed();
  }); }
  start(meta: Omit<HealthSession, "records" | "endedAt" | "endReason">) { return this.enqueue(async () => {
    if (!this.ready || this.activeId) throw new Error("El registro no está listo o ya hay una sesión activa.");
    if (!/^[A-F0-9]{12}$/.test(meta.id) || !/^[A-Fa-f0-9]{16,32}$/.test(meta.bootId) || !meta.nodeId ||
        this.sessions.some(s => s.id === meta.id)) throw new Error("No se pudo identificar una nueva sesión de medición.");
    const s: HealthSession = { ...meta, label: meta.label.replace(/[\r\n\t]/g, " ").slice(0, 60), records: 0, endedAt: null, endReason: "" };
    this.sessions = [...this.sessions, s]; await this.index();
    this.lastUptime = -1; this.activeId = s.id; this.changed(); return s.id;
  }); }
  private async append(id: string, record: HealthRecord, allowClosed = false) {
    const s = this.sessions.find(s => s.id === id);
    if (!s || (!allowClosed && s.endedAt !== null)) throw new Error("La sesión ya terminó; no se guardó el evento.");
    if (s.records >= HEALTH_MAX_RECORDS) {
      if (s.endedAt === null) await this.close(s, "record_limit", record.at);
      if (record.type === "share") throw new Error("Sesión llena; no se guardó el evento de envío.");
      return;
    }
    const key = `${ROOT}/${id}/${Math.floor(s.records / PAGE)}`;
    const raw = await this.store.getItem(key), rows: HealthRecord[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(rows) || rows.length !== s.records % PAGE) throw new Error("El registro cambió; se detuvo para conservarlo.");
    rows.push(record);
    await this.store.setItem(key, JSON.stringify(rows)); // Commit page BEFORE index.
    s.records++; await this.index();
    if (s.records >= HEALTH_MAX_RECORDS) await this.close(s, "record_limit", record.at);
  }
  private async close(s: HealthSession, reason: string, at: number) {
    if (this.activeId === s.id) this.activeId = null;
    s.endedAt = at; s.endReason = reason; await this.index();
  }
  capture(h: NodeHealth, at = Date.now()): Promise<void> {
    const id = this.activeId;
    if (!id) return Promise.resolve();
    if (this.pending >= 8) {
      this.activeId = null; this.error = "Almacenamiento demasiado lento; registro detenido."; this.changed();
      return Promise.reject(new Error(this.error));
    }
    const snapshot = JSON.parse(JSON.stringify(h)) as NodeHealth;
    const elapsed = Math.max(0, at - h.receivedAt);
    if (snapshot.ageMs >= 0) snapshot.ageMs += elapsed;
    if (snapshot.sampleAgeMs >= 0) snapshot.sampleAgeMs += elapsed;
    if (!healthIsFresh(h, at)) {
      snapshot.heartRateBpm = null; snapshot.spo2Percent = null;
      snapshot.heartRateValid = snapshot.spo2Valid = false;
    }
    if (at < h.receivedAt || snapshot.sampleAgeMs > 500) { snapshot.red = null; snapshot.infrared = null; }
    ++this.pending;
    return this.enqueue(async () => {
      const s = this.sessions.find(s => s.id === id);
      if (!s || s.endedAt !== null) return;
      if (h.nodeId !== s.nodeId || h.bootId !== s.bootId || !Number.isFinite(h.uptimeMs) || h.uptimeMs < 0 || h.uptimeMs < this.lastUptime) {
        await this.close(s, "node_identity_changed", at); return;
      }
      if (h.uptimeMs === this.lastUptime) return;
      this.lastUptime = h.uptimeMs;
      await this.append(id, { at, type: "sample", health: snapshot });
    }).finally(() => { --this.pending; });
  }
  stop(reason = "manual", at = Date.now()) {
    const id = this.activeId; this.activeId = null; this.changed(); // Gate new packets immediately.
    return this.enqueue(async () => {
      const s = this.sessions.find(s => s.id === id);
      if (s && s.endedAt === null) await this.close(s, reason, at);
    });
  }
  logShare(record: Extract<HealthRecord, { type: "share" }>, sessionId = this.activeId) {
    encodeHealthShare(record.report);
    if (!sessionId) return Promise.reject(new Error("Inicia una sesión antes de compartir una medición."));
    return this.enqueue(() => this.append(sessionId, record, record.outcome !== "attempt"));
  }
  archive(id: string) { return this.enqueue(async (): Promise<HealthArchive> => {
    const s = this.sessions.find(s => s.id === id);
    if (!s || s.deleting) throw new Error("Sesión no disponible.");
    const records = await this.rows(s);
    return { schema: 1, session: { ...s, records: records.length }, records,
      coverage: "Instantáneas BLE (~1 Hz), no señal completa de 25 Hz. Hora del teléfono no sincronizada. No diagnóstico médico. Sin recuperación de datos fuera de BLE." };
  }, true); }
  private async purge(s: HealthSession) {
    for (let p = 0; p <= Math.floor(HEALTH_MAX_RECORDS / PAGE); ++p) await this.store.removeItem(`${ROOT}/${s.id}/${p}`);
    this.sessions = this.sessions.filter(x => x.id !== s.id); await this.index();
  }
  remove(id: string) { return this.enqueue(async () => {
    if (this.activeId === id) throw new Error("Finaliza primero la sesión.");
    const s = this.sessions.find(s => s.id === id); if (!s) return;
    s.deleting = true; await this.index(); await this.purge(s);
  }, true); }
}
const csvCell = (v: unknown) => {
  let text = v === null || v === undefined ? "" : String(v);
  if (typeof v === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export function healthArchiveCsv(a: HealthArchive): string {
  const diagnostics = [...new Set(a.records.flatMap(r => r.type === "sample" ? Object.keys(r.health.diagnostics) : []))].sort();
  const base = ["sessionId", "label", "nodeId", "bootId", "board", "firmwareVersion", "appVersion", "diagnosticRevision", "atPhone", "type", "state", "heartBpm", "spo2Percent", "enabled", "present", "contact", "heartValid", "spo2Valid", "red", "infrared",
    "windowSamples", "samplesReceived", "fifoResets", "i2cErrors", "uptimeMs", "ageMs", "sampleAgeMs", "lastFault", "lastI2cOperation", "declared", "destination", "shareOutcome", "measuredAtSender", "reference", "requestId"];
  const rows: unknown[][] = [base.concat(diagnostics)];
  for (const r of a.records) {
    const h = r.type === "sample" ? r.health : null;
    rows.push([a.session.id, a.session.label, a.session.nodeId, a.session.bootId, a.session.board, a.session.firmwareVersion,
      a.session.appVersion, a.session.diagnosticRevision, new Date(r.at).toISOString(), r.type,
      h?.state, r.type === "share" ? r.report.heart : h?.heartRateBpm, r.type === "share" ? r.report.oxygen : h?.spo2Percent,
      h?.enabled, h?.present, h?.contact, h?.heartRateValid, h?.spo2Valid, h?.red, h?.infrared, h?.windowSamples, h?.samplesReceived,
      h?.fifoResets, h?.i2cErrors, h?.uptimeMs, h?.ageMs, h?.sampleAgeMs, h?.lastFault, h?.lastI2cOperation,
      r.type === "share" ? r.report.declared : null, r.type === "share" ? r.destination : null,
      r.type === "share" ? r.outcome : null, r.type === "share" ? new Date(r.report.measuredAt).toISOString() : null,
      r.type === "share" ? r.report.reference : null, r.type === "share" ? r.requestId : null,
      ...diagnostics.map(k => h?.diagnostics[k])]);
  }
  return rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}
