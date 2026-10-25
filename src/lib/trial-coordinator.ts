import { metricPacket, summarizeTest, testTag, type MetricData, type TelemetryJournal } from "./telemetry.ts";
import { decodeTrialControl, encodeTrialControl, type TrialControl } from "./trial-protocol.ts";
import { abortableDelay, matchTestResponse, runSequentialTest, type TestOutcome, type TestProgress } from "./test-runner.ts";

type Packet = Record<string, unknown>;
export type TrialView = { armed: boolean; active: boolean; phase: "idle" | "preparing" | "sending" | "receiving" | "closing" | "completed" | "interrupted";
  runId?: string; role?: "sender" | "receiver"; peer?: string; received: number; remoteSaved: boolean; reason?: string; progress?: TestProgress };
export type TrialLink = { connected: boolean; demo: boolean; correlation: boolean; nodeId: string; idle: boolean; encrypted?: boolean };
type ActiveTrial = { id: string; role: "sender" | "receiver"; peer: string; session: string; bootId: string;
  identity: Packet; controller: AbortController; seen: Set<number>; capture: boolean; closing: boolean;
  sealed?: boolean; closePromise?: Promise<void>; timer?: ReturnType<typeof setTimeout> };
type Waiter<T> = { resolve(value: T): void; reject(error: Error): void };
type Dependencies = {
  journal: TelemetryJournal;
  uuid(): string;
  transmit(to: string, text: string, requestId: string, signal: AbortSignal): Promise<void>;
  query(cmd: string, requestId: string): Promise<void>;
  change(view: TrialView): void;
  error(message: string): void;
  delay?: typeof abortableDelay;
  timeouts?: { snapshot: number; peer: number; send: number };
  environment?: MetricData;
};

// No radio or native dependencies: exercised with two simulated phones in tests.
export class TrialCoordinator {
  view: TrialView = { armed: false, active: false, phase: "idle", received: 0, remoteSaved: false };
  identity: Packet | null = null;
  private deps: Dependencies;
  private link: TrialLink = { connected: false, demo: false, correlation: false, nodeId: "", idle: true };
  private active: ActiveTrial | null = null;
  private packets: Promise<unknown> = Promise.resolve();
  private snapshots = new Map<string, Waiter<Packet>>();
  private appReply: { kind: "ready" | "saved"; waiter: Waiter<TrialControl> } | null = null;
  private pending: { requestId: string; destination: string; msgId?: string; waiter: Waiter<TestOutcome> } | null = null;
  private ambiguous = false;
  constructor(deps: Dependencies) { this.deps = deps; }
  private change(patch: Partial<TrialView>) { this.view = { ...this.view, ...patch }; this.deps.change({ ...this.view }); }
  private time(kind: "snapshot" | "peer" | "send") { return this.deps.timeouts?.[kind] ?? ({ snapshot: 10000, peer: 60000, send: 30000 })[kind]; }
  updateLink(link: TrialLink) { this.link = link; }
  setArmed(armed: boolean) {
    this.change({ armed });
    if (!armed) this.cancel("Se salió de Ensayos o la app dejó de estar visible.");
  }
  busy() { return this.active !== null; }
  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.deps.error(message);
    this.cancel(`Error de registro: ${message}`);
  }
  private enqueue(job: () => Promise<unknown>) {
    const promise = this.packets.then(job);
    this.packets = promise.catch(error => this.fail(error));
    return promise;
  }
  private async record(trial: ActiveTrial, type: string, data: MetricData = {}) {
    await this.deps.journal.append(type, { ...data, runId: trial.id, role: trial.role,
      peer: trial.peer, capturePhase: this.view.phase }, trial.session);
  }
  async append(type: string, data: MetricData) {
    const trial = this.active;
    if (!trial?.capture || trial.sealed) return; // No recording outside the actual test interval.
    try { await this.record(trial, type, data); } catch (error) { this.fail(error); throw error; }
  }
  receive(packet: Packet) {
    if (typeof packet.nodeId === "string" && typeof packet.bootId === "string") {
      if (this.active && (packet.nodeId !== this.link.nodeId || packet.bootId !== this.active.bootId)) this.cancel("Cambió el nodo o su arranque.");
      if (packet.type === "info" || packet.type === "ready") this.identity = { ...this.identity, ...packet };
    }
    const record = metricPacket(packet);
    if (!record) return;
    const trial = this.active; // Bind to the capture that existed at arrival, never a future one.
    const captureAtArrival = trial?.capture === true && !trial.sealed;
    void this.enqueue(async () => {
      if (trial && captureAtArrival) await this.record(trial, record.type, { ...record.data, observedAt: record.at });
      const requestId = typeof packet.requestId === "string" ? packet.requestId : "";
      const query = this.snapshots.get(requestId);
      if (query && trial && packet.bootId === trial.bootId && packet.nodeId === this.link.nodeId) query.resolve(packet);
      if (packet.type === "metricsReset" && trial) this.cancel("Se reiniciaron contadores durante el ensayo.");
      if (this.pending && trial === this.active) {
        const result = matchTestResponse(this.pending, packet);
        if (result) this.pending.waiter.resolve(result);
      }
    }).catch(() => {});
  }
  private wait<T>(signal: AbortSignal, ms: number, register: (waiter: Waiter<T>) => void, clear: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort); clear();
        if (error) reject(error); else resolve(value!);
      };
      const abort = () => finish(new Error(typeof signal.reason === "string" ? signal.reason : "Ensayo detenido."));
      const timer = setTimeout(() => finish(new Error("No llegó la confirmación esperada; el registro remoto no está confirmado.")), ms);
      register({ resolve: value => finish(undefined, value), reject: error => finish(error) });
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    });
  }
  private check(trial?: ActiveTrial) {
    if (!this.view.armed || !this.link.connected || !this.link.correlation || !this.link.idle || !this.identity
      || this.identity.snapshotCorrelation !== true || this.identity.nodeId !== this.link.nodeId) throw new Error("Abre Ensayos, conecta firmware 5.5 y espera a que no haya mensajes pendientes.");
    if (trial && (this.active !== trial || trial.controller.signal.aborted || this.identity.bootId !== trial.bootId)) throw new Error("Se interrumpió el ensayo.");
  }
  private makeTrial(id: string, role: "sender" | "receiver", peer: string): ActiveTrial {
    const identity = this.identity!;
    const session = `${this.link.demo ? "DEMO-" : ""}${identity.nodeId}-${identity.bootId}`;
    const trial: ActiveTrial = { id, role, peer, session, bootId: String(identity.bootId),
      identity: { ...identity }, controller: new AbortController(), seen: new Set(), capture: true, closing: false };
    this.active = trial;
    this.change({ active: true, phase: "preparing", runId: id, role, peer, received: 0, remoteSaved: false, reason: undefined, progress: undefined });
    return trial;
  }
  private async open(trial: ActiveTrial, scenario: string, intervalMs: number) {
    await this.deps.journal.init();
    await this.deps.journal.select({ ...trial.identity, uptimeMs: -1 }, trial.identity.demo === true || this.link.demo);
    await this.record(trial, "trialOpen", { ...this.deps.environment, scenario, intervalMs, planned: 100,
      nodeId: this.link.nodeId, bootId: trial.bootId, encrypted: this.link.encrypted === true,
      origin: trial.role === "sender" ? this.link.nodeId : trial.peer,
      destination: trial.role === "sender" ? trial.peer : this.link.nodeId });
    await this.snapshot(trial, "baseline");
  }
  private async snapshot(trial: ActiveTrial, stage: string) {
    for (const cmd of ["info", "nodes", "status"]) {
      const requestId = this.deps.uuid();
      const response = this.wait<Packet>(trial.controller.signal, this.time("snapshot"), waiter => this.snapshots.set(requestId, waiter), () => this.snapshots.delete(requestId));
      // Attach handlers before invoking a transport that can respond synchronously.
      void this.deps.query(cmd, requestId).catch(error => this.snapshots.get(requestId)?.reject(error));
      const packet = await response;
      if (packet.type !== cmd) throw new Error("Respuesta de instantánea incorrecta.");
      await this.record(trial, "snapshotBoundary", { stage, responseType: cmd, requestId, uptimeMs: Number(packet.uptimeMs ?? -1), metricsEpoch: Number(packet.metricsEpoch ?? -1) });
    }
  }
  private async control(trial: ActiveTrial, control: TrialControl, signal = trial.controller.signal) {
    const requestId = this.deps.uuid();
    await this.record(trial, "trialControlTx", { kind: control.kind, requestId });
    if (signal.aborted) throw new Error("Control de ensayo cancelado.");
    await this.deps.transmit(trial.peer, encodeTrialControl(control), requestId, signal);
  }
  private peerReply(trial: ActiveTrial, kind: "ready" | "saved") {
    return this.wait<TrialControl>(trial.controller.signal, this.time("peer"), waiter => { this.appReply = { kind, waiter }; }, () => { this.appReply = null; });
  }
  incoming(text: string, packet: Packet, crypto?: MetricData): boolean {
    const control = decodeTrialControl(text);
    const tag = testTag(text);
    if (!control && !tag) {
      const current = this.active;
      if (current?.role === "receiver" && current.capture && !current.sealed && packet.from === current.peer && packet.to === this.link.nodeId && crypto?.success === false) {
        void this.enqueue(() => this.record(current, "testDecryptFailure", { msgId: String(packet.msgId ?? ""), from: current.peer, sequenceKnown: false })).catch(() => {});
        return true;
      }
      return false;
    }
    // Reserved traffic is never inserted into real conversations, even when not armed.
    if (packet.broadcast === true || packet.to !== this.link.nodeId || typeof packet.from !== "string") return true;
    if (typeof this.link.encrypted === "boolean" && packet.encrypted !== this.link.encrypted) return true;
    if (control?.kind === "start") {
      if (!this.view.armed || this.active || !this.link.connected) return true;
      try { this.check(); } catch { return true; }
      const trial = this.makeTrial(control.runId, "receiver", packet.from);
      void this.prepareReceiver(trial, control.intervalMs, packet, crypto).catch(error => this.receiverFailure(trial, error));
      return true;
    }
    const trial = this.active;
    if (!trial || packet.from !== trial.peer || (control?.runId ?? tag?.runId) !== trial.id) return true;
    if (tag && trial.role === "receiver" && trial.capture && !trial.sealed && !trial.controller.signal.aborted) {
      void this.enqueue(async () => {
        await this.record(trial, "testRx", { ...tag, from: String(packet.from), msgId: String(packet.msgId ?? ""),
          ...(typeof packet.rssi === "number" && Number.isFinite(packet.rssi) ? { rssi: packet.rssi } : {}),
          ...(typeof packet.snr === "number" && Number.isFinite(packet.snr) ? { snr: packet.snr } : {}),
          bytes: Number(packet.bytes ?? 0) });
        trial.seen.add(tag.sequence);
        this.change({ received: trial.seen.size });
      }).catch(() => {});
    } else if (control) {
      void this.enqueue(async () => {
        await this.record(trial, "trialControlRx", { kind: control.kind, from: String(packet.from), msgId: String(packet.msgId ?? "") });
        if (control.kind === "stop") { this.cancel("El otro teléfono detuvo el ensayo."); return; }
        if (control.kind === "ready" && trial.role === "sender" && this.appReply?.kind === "ready") {
          await this.record(trial, "receiverReady", { confirmed: true });
          this.appReply.waiter.resolve(control);
        }
        if (control.kind === "saved" && trial.role === "sender" && this.appReply?.kind === "saved") {
          await this.record(trial, "receiverSaved", { received: control.received });
          this.change({ remoteSaved: true }); this.appReply.waiter.resolve(control);
        }
        if (control.kind === "finish" && trial.role === "receiver" && !trial.closing) {
          trial.closing = true;
          // Do not block this packet queue while waiting for fresh BLE snapshots.
          void this.finishReceiver(trial, control).catch(error => this.receiverFailure(trial, error));
        }
      }).catch(() => {});
    }
    return true;
  }
  private async prepareReceiver(trial: ActiveTrial, intervalMs: number, packet: Packet, crypto?: MetricData) {
    await this.open(trial, "Ensayo remoto (escenario detallado en el archivo del emisor)", intervalMs);
    await this.record(trial, "testStart", { planned: 100, source: trial.peer, intervalMs, scenario: "Ensayo remoto" });
    const start = metricPacket(packet);
    if (start) await this.record(trial, "trialStartMessage", start.data);
    if (crypto) await this.record(trial, "cryptoDecrypt", { ...crypto, msgId: String(packet.msgId ?? "") });
    await this.deps.journal.flush();
    this.check(trial);
    this.change({ phase: "receiving" });
    // Lease covers all 100 sender observation timeouts plus configured pauses.
    trial.timer = setTimeout(() => this.cancel("No llegó el cierre dentro del plazo máximo del ensayo."), 120000 + 100 * (intervalMs + 30000));
    await this.control(trial, { kind: "ready", runId: trial.id });
  }
  private async finishReceiver(trial: ActiveTrial, end: Extract<TrialControl, { kind: "finish" }>) {
    this.change({ phase: "closing" });
    await this.record(trial, "senderManifest", { attempted: end.attempted, radioSent: end.sent, complete: end.complete });
    // Bounded drain window for a final data frame delayed behind its control.
    await (this.deps.delay ?? abortableDelay)(8000, trial.controller.signal);
    await this.packets;
    await this.snapshot(trial, "final");
    await this.record(trial, "testEnd", { phase: end.complete ? "completed" : "interrupted", received: trial.seen.size });
    await this.record(trial, "receiverJournalSaved", { received: trial.seen.size });
    await this.deps.journal.flush();
    await this.control(trial, { kind: "saved", runId: trial.id, received: trial.seen.size });
    await this.close(trial, end.complete, end.complete ? undefined : "El origen terminó parcialmente.");
  }
  private async receiverFailure(trial: ActiveTrial, error: unknown) {
    if (!trial.capture) return;
    const reason = error instanceof Error ? error.message : String(error);
    this.stopNotice(trial);
    try { await this.close(trial, false, reason); }
    catch { this.deps.error(reason); this.release(trial, false, reason); }
  }
  private stopNotice(trial: ActiveTrial) {
    if (!this.link.connected) return;
    const signal = new AbortController();
    const timer = setTimeout(() => signal.abort(), 10000);
    void this.deps.transmit(trial.peer, encodeTrialControl({ kind: "stop", runId: trial.id }), this.deps.uuid(), signal.signal)
      .catch(() => {}).finally(() => clearTimeout(timer));
  }
  cancel(reason = "Ensayo detenido por el usuario; no se puede retirar un paquete en vuelo.") {
    const trial = this.active;
    if (!trial || trial.controller.signal.aborted) return;
    if (this.pending) this.ambiguous = true;
    trial.controller.abort(reason);
    this.stopNotice(trial);
    if (trial.role === "receiver") {
      trial.closing = true;
      void this.close(trial, false, reason).catch(() => this.release(trial, false, reason));
    }
  }
  resetLink() {
    this.cancel("Se perdió la conexión BLE; ensayo incompleto.");
    this.link.connected = false; this.identity = null; this.ambiguous = false;
  }
  private release(trial: ActiveTrial, complete: boolean, reason?: string) {
    if (trial.timer) clearTimeout(trial.timer);
    trial.capture = false; trial.controller.abort("Ensayo cerrado");
    if (this.active === trial) {
      this.active = null;
      this.change({ active: false, phase: complete ? "completed" : "interrupted", reason });
    }
  }
  private async close(trial: ActiveTrial, complete: boolean, reason?: string) {
    if (trial.closePromise) return trial.closePromise;
    if (!trial.capture) return;
    trial.sealed = true;
    const observed = this.packets;
    trial.closePromise = (async () => {
      await observed;
      await this.record(trial, "trialClose", { complete, reason: reason ?? "", received: trial.seen.size });
      this.release(trial, complete, reason);
    })();
    return trial.closePromise;
  }
  private async sendData(trial: ActiveTrial, sequence: number, text: string) {
    this.check(trial);
    const requestId = this.deps.uuid();
    await this.record(trial, "testAttempt", { sequence, requestId, destination: trial.peer });
    const result = this.wait<TestOutcome>(trial.controller.signal, this.time("send"), waiter => {
      this.pending = { requestId, destination: trial.peer, waiter };
    }, () => { this.pending = null; });
    void this.deps.transmit(trial.peer, text, requestId, trial.controller.signal).catch(error => this.pending?.requestId === requestId && this.pending.waiter.reject(error));
    try { return await result; }
    catch (error) {
      this.ambiguous = true;
      await this.record(trial, "testUnknown", { sequence, requestId });
      trial.controller.abort(error instanceof Error ? error.message : "Sin observación BLE");
      return "unknown" as const;
    }
  }
  async start(destination: string, scenario: string, intervalMs: number): Promise<TestProgress | undefined> {
    if (this.active) throw new Error("Ya existe un ensayo activo en este teléfono.");
    this.check();
    if (this.ambiguous) throw new Error("Reconecta BLE antes de iniciar otro ensayo.");
    if (!/^N-[A-Za-z0-9_-]{1,60}$/.test(destination) || destination === this.link.nodeId || !scenario.trim()
      || !Number.isInteger(intervalMs / 1000) || intervalMs < 2000 || intervalMs > 60000) throw new Error("Selecciona otro nodo, escenario e intervalo entero entre 2 y 60 s.");
    const trial = this.makeTrial(this.deps.uuid().replaceAll("-", "").slice(0, 12).toUpperCase(), "sender", destination);
    let result: TestProgress | undefined;
    try {
      await this.open(trial, scenario.trim().slice(0, 120), intervalMs);
      const ready = this.peerReply(trial, "ready");
      // Always observe the waiter rejection even if GATT fails before the reply.
      void this.control(trial, { kind: "start", runId: trial.id, intervalMs }).catch(error => {
        if (this.active === trial && this.appReply?.kind === "ready") this.appReply.waiter.reject(error);
      });
      await ready;
      this.check(trial);
      this.change({ phase: "sending" });
      result = await runSequentialTest({ runId: trial.id, destination, scenario, intervalMs }, trial.controller.signal, {
        check: () => this.check(trial),
        record: (type, data) => this.record(trial, type, data),
        progress: progress => this.change({ progress }),
        send: (sequence, text) => this.sendData(trial, sequence, text),
      }, this.deps.delay);
      if (result.phase !== "completed" || trial.controller.signal.aborted) throw new Error(result.reason ?? "Ensayo parcial.");
      this.change({ phase: "closing" });
      await this.snapshot(trial, "final");
      const archive = await this.deps.journal.archive(trial.session);
      const summary = summarizeTest(archive.records, trial.id);
      const saved = this.peerReply(trial, "saved");
      void this.control(trial, { kind: "finish", runId: trial.id, attempted: summary.attempted, sent: summary.radioSent, complete: true })
        .catch(error => { if (this.active === trial && this.appReply?.kind === "saved") this.appReply.waiter.reject(error); });
      await saved;
      await this.close(trial, true);
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.stopNotice(trial);
      try { await this.close(trial, false, reason); }
      catch (storageError) { this.deps.error(String(storageError)); this.release(trial, false, reason); }
      return result;
    } finally { trial.controller.abort("Ensayo terminado"); }
  }
}
