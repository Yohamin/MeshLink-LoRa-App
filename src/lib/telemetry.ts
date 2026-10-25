// Deliberately independent of React/native modules for reproducible tests.
export type MetricData = Record<string, string | number | boolean>;
export type MetricRecord = { at: number; type: string; data: MetricData };
export type MetricSession = {
  id: string; nodeId: string; bootId: string; firstSeenAt: number; lastSeenAt: number;
  firstUptimeMs: number; lastUptimeMs: number; records: number;
  board: string; firmwareVersion: string; demo: boolean;
};
export type MetricArchive = { schema: 1; session: MetricSession; records: MetricRecord[] };
type Store = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown> };
const ROOT = "@meshlink/telemetry-v1";
const PAGE_SIZE = 64; // Keep each AsyncStorage row well below Android's per-row limit.
const numericKeys = new Set(["uptimeMs", "metricsEpoch", "bytes", "rssi", "snr", "latencyMs", "pdrAck",
  "messagesWithAck", "ackReceived", "ackTimeouts", "onlineNodes", "expectedNodes", "lastRssi", "lastSnr",
  "ackTimeoutMs", "maxNodes", "sx1262DriveDbm", "freePsramBytes", "frequencyMHz", "bandwidthKHz",
  "spreadingFactor", "codingRate", "syncWord", "preambleLength"]);
const stringKeys = new Set(["nodeId", "nodeName", "bootId", "board", "firmwareVersion", "msgId", "ackFor",
  "requestId", "from", "to", "mode", "route", "layer", "radio"]);
const booleanKeys = new Set(["ok", "encrypted", "broadcast", "sos", "requestCorrelation", "snapshotCorrelation"]);

// Never persist message bodies, ciphertext, keys, GPS or physiological data.
export function metricPacket(packet: Record<string, unknown>): MetricRecord | null {
  const type = String(packet.type ?? "");
  if (!["ready", "info", "status", "nodes", "sent", "message", "ack", "ackTimeout",
    "metricsReset", "error", "txError"].includes(type)) return null;
  const data: MetricData = {};
  for (const [key, value] of Object.entries(packet)) {
    if (numericKeys.has(key) && typeof value === "number" && Number.isFinite(value)) data[key] = value;
    if (stringKeys.has(key) && typeof value === "string") data[key] = value.slice(0, 128);
    if (booleanKeys.has(key) && typeof value === "boolean") data[key] = value;
  }
  for (const group of ["metrics", "ble"]) {
    const values = packet[group];
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "number" && Number.isFinite(value)) data[`${group}.${key}`] = value;
      else if (typeof value === "boolean") data[`${group}.${key}`] = value;
    }
  }
  if (type === "nodes" && Array.isArray(packet.nodes)) {
    packet.nodes.forEach((node: unknown, i) => {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (["rssi", "snr", "lastSeenMsAgo", "index"].includes(key) && typeof value === "number" && Number.isFinite(value)) data[`nodes.${i}.${key}`] = value;
        if (["id", "state"].includes(key) && typeof value === "string") data[`nodes.${i}.${key}`] = value.slice(0, 128);
      }
    });
  }
  return { at: Date.now(), type, data };
}

export class TelemetryJournal {
  sessions: MetricSession[] = [];
  currentId: string | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private initialized = false;
  private failure: unknown = null;
  private store: Store;
  private changed: () => void;
  constructor(store: Store, changed: () => void = () => {}) { this.store = store; this.changed = changed; }
  private serialize<T>(job: () => Promise<T>, allowAfterFailure = false): Promise<T> {
    const result = this.tail.then(async () => {
      if (this.failure && !allowAfterFailure) throw this.failure; // Stop recording, but still permit rescue exports.
      try { return await job(); }
      catch (error) { this.failure = error; throw error; }
    });
    this.tail = result.catch(() => {});
    return result;
  }
  async flush() { await this.tail; if (this.failure) throw this.failure; }
  init() { return this.serialize(async () => {
    if (this.initialized) return;
    const raw = await this.store.getItem(`${ROOT}/index`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.some(s => !s || typeof s.id !== "string" || !Number.isInteger(s.records) || s.records < 0)) {
        throw new Error("El índice de métricas está dañado; no se sobrescribió.");
      }
      this.sessions = parsed;
      // Recover a page committed just before a process kill but not indexed yet.
      for (const s of this.sessions) {
        let page = Math.floor(s.records / PAGE_SIZE);
        for (;;) {
          const value = await this.store.getItem(`${ROOT}/${s.id}/${page}`);
          if (!value) break;
          const rows = JSON.parse(value) as MetricRecord[];
          if (!Array.isArray(rows) || rows.length > PAGE_SIZE) throw new Error("Página de métricas dañada.");
          s.records = Math.max(s.records, page * PAGE_SIZE + rows.length);
          if (rows.length < PAGE_SIZE) break;
          ++page;
        }
      }
    }
    this.initialized = true;
    this.changed();
  }); }
  select(packet: Record<string, unknown>, demo = false) { return this.serialize(async () => {
    if (!this.initialized) throw new Error("El registro de métricas aún no está listo.");
    const nodeId = typeof packet.nodeId === "string" ? packet.nodeId : "";
    const bootId = typeof packet.bootId === "string" ? packet.bootId : "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(nodeId) || !/^[A-Fa-f0-9]{16,32}$/.test(bootId)) {
      throw new Error("Este firmware no identifica el arranque; actualízalo para registrar sesiones fiables.");
    }
    const id = `${demo ? "DEMO-" : ""}${nodeId}-${bootId}`;
    let session = this.sessions.find(s => s.id === id);
    const now = Date.now();
    const uptime = typeof packet.uptimeMs === "number" ? packet.uptimeMs : -1;
    if (!session) {
      session = { id, nodeId, bootId, firstSeenAt: now, lastSeenAt: now, firstUptimeMs: uptime,
        lastUptimeMs: uptime, records: 0, board: String(packet.board ?? ""),
        firmwareVersion: String(packet.firmwareVersion ?? ""), demo };
      this.sessions = [...this.sessions, session];
      // Index first: an interrupted first event must not leave an undiscoverable session.
      await this.store.setItem(`${ROOT}/index`, JSON.stringify(this.sessions));
    }
    this.currentId = id;
    this.changed();
    return id;
  }); }
  append(type: string, data: MetricData, sessionId = this.currentId, at = Date.now()) { return this.serialize(async () => {
    if (!sessionId) return;
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) throw new Error("Sesión de métricas desconocida.");
    const page = Math.floor(session.records / PAGE_SIZE);
    const key = `${ROOT}/${sessionId}/${page}`;
    const raw = await this.store.getItem(key);
    const rows: MetricRecord[] = raw ? JSON.parse(raw) : [];
    if (rows.length !== session.records % PAGE_SIZE) throw new Error("Registro inconsistente; se detuvo para preservar los datos.");
    rows.push({ at, type, data });
    await this.store.setItem(key, JSON.stringify(rows));
    session.records++;
    session.lastSeenAt = at;
    if (typeof data.uptimeMs === "number") {
      session.lastUptimeMs = data.uptimeMs;
      if (session.firstUptimeMs < 0 && data.uptimeMs >= 0) session.firstUptimeMs = data.uptimeMs;
    }
    if (typeof data.board === "string") session.board = data.board;
    if (typeof data.firmwareVersion === "string") session.firmwareVersion = data.firmwareVersion;
    await this.store.setItem(`${ROOT}/index`, JSON.stringify(this.sessions));
    this.changed();
  }); }
  archive(id: string) { return this.serialize(async (): Promise<MetricArchive> => {
    const session = this.sessions.find(s => s.id === id);
    if (!session) throw new Error("No se encontró la sesión.");
    const records: MetricRecord[] = [];
    for (let page = 0; page * PAGE_SIZE < session.records; ++page) {
      const raw = await this.store.getItem(`${ROOT}/${id}/${page}`);
      if (!raw) throw new Error("Falta una página del historial; exportación detenida.");
      records.push(...JSON.parse(raw));
    }
    if (records.length !== session.records) throw new Error("Historial incompleto.");
    return { schema: 1, session: { ...session }, records };
  }, true); }
}

export function testTag(text: string): { runId: string; sequence: number } | null {
  const match = /^T:([A-F0-9]{12}):(\d{3})\/100$/.exec(text);
  const sequence = match ? Number(match[2]) : 0;
  return match && sequence >= 1 && sequence <= 100 ? { runId: match[1], sequence } : null;
}

export function summarizeTest(records: MetricRecord[], runId: string) {
  const attempts = new Map<number, MetricData>();
  const transmissions = new Map<string, MetricData>();
  const received = new Set<string>();
  const acks = new Map<string, number>();
  const timeouts = new Set<string>();
  const unknown = new Set<number>();
  const rejectedRequests = new Set<string>();
  const rxRssi: number[] = [], rxSnr: number[] = [];
  for (const r of records) {
    const d = r.data;
    if (d.runId === runId && r.type === "testAttempt") attempts.set(Number(d.sequence), d);
    if (d.runId === runId && r.type === "testUnknown") unknown.add(Number(d.sequence));
    if (r.type === "sent" && typeof d.msgId === "string" && d.ok === true) transmissions.set(d.msgId, d);
    if (typeof d.requestId === "string" && ((r.type === "sent" && d.ok === false) || ["error", "txError"].includes(r.type))) rejectedRequests.add(d.requestId);
    if (r.type === "ack" && typeof d.ackFor === "string" && typeof d.latencyMs === "number") acks.set(d.ackFor, d.latencyMs);
    if (r.type === "ackTimeout" && typeof d.msgId === "string") timeouts.add(d.msgId);
    if (r.type === "testRx" && d.runId === runId && typeof d.from === "string") {
      const key = `${d.from}/${d.sequence}`;
      if (!received.has(key)) {
        received.add(key);
        if (typeof d.rssi === "number") rxRssi.push(d.rssi);
        if (typeof d.snr === "number") rxSnr.push(d.snr);
      }
    }
  }
  const requestIds = new Set([...attempts.values()].map(a => a.requestId));
  const sent = [...transmissions.entries()].filter(([, d]) => requestIds.has(d.requestId));
  const latencies = sent.filter(([id]) => acks.has(id)).map(([id]) => acks.get(id)!);
  const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const manifest = records.findLast(r => r.type === "senderManifest" && r.data.runId === runId)?.data;
  const saved = records.findLast(r => r.type === "receiverSaved" && r.data.runId === runId)?.data;
  const rxComplete = records.some(r => r.type === "receiverJournalSaved" && r.data.runId === runId);
  const senderSent = manifest?.complete === true && typeof manifest.radioSent === "number" ? manifest.radioSent : null;
  return { runId, planned: 100, attempted: attempts.size, radioSent: sent.length,
    role: records.find(r => r.data.runId === runId && typeof r.data.role === "string")?.data.role ?? "legacy",
    senderRadioSent: senderSent, senderAttempted: manifest?.attempted ?? null,
    pdrReception: rxComplete && senderSent !== null && senderSent > 0 && received.size <= senderSent ? received.size / senderSent * 100 : null,
    receiverConfirmed: !!saved, remoteReceived: typeof saved?.received === "number" ? saved.received : null,
    decryptFailures: new Set(records.filter(r => r.type === "testDecryptFailure" && r.data.runId === runId).map(r => r.data.msgId)).size,
    txFailed: [...rejectedRequests].filter(id => requestIds.has(id)).length,
    ack: latencies.length, timeouts: sent.filter(([id]) => timeouts.has(id) && !acks.has(id)).length,
    unobserved: unknown.size, pdrAck: sent.length ? latencies.length / sent.length * 100 : null,
    ackPerAttempt: attempts.size ? latencies.length / attempts.size * 100 : null,
    avgAckLatencyMs: mean(latencies), received: received.size,
    avgRxRssi: mean(rxRssi), avgRxSnr: mean(rxSnr) };
}

export function archiveCsv(archive: MetricArchive): string {
  const keys = [...new Set(archive.records.flatMap(r => Object.keys(r.data)))].sort();
  const cell = (value: unknown) => {
    let text = value === undefined ? "" : String(value);
    if (typeof value === "string" && /^[=+\-@\t\r\n]/.test(text)) text = `'${text}`; // Spreadsheet formula injection.
    return `"${text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [
    ["sessionId", "nodeId", "bootId", "demo", "phoneTimeIso", "event", ...keys].map(cell).join(","),
    ...archive.records.map(r => [archive.session.id, archive.session.nodeId, archive.session.bootId,
      archive.session.demo, new Date(r.at).toISOString(), r.type, ...keys.map(k => r.data[k])].map(cell).join(",")),
  ].join("\r\n");
}
