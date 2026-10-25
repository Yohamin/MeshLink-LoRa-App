export type TestProgress = { runId: string; phase: "running" | "completed" | "cancelled" | "interrupted";
  attempted: number; ack: number; timeouts: number; txFailed: number; reason?: string };
export type TestOutcome = "ack" | "timeout" | "txFailed" | "unknown";
export function matchTestResponse(waiting: { requestId: string; destination: string; msgId?: string }, packet: Record<string, unknown>): TestOutcome | null {
  if (packet.type === "sent" && packet.requestId === waiting.requestId && packet.to === waiting.destination) {
    if (packet.ok !== true) return "txFailed";
    if (typeof packet.msgId === "string" && packet.msgId) waiting.msgId = packet.msgId;
  }
  if (waiting.msgId && packet.type === "ack" && packet.ackFor === waiting.msgId && packet.from === waiting.destination) return "ack";
  if (waiting.msgId && packet.type === "ackTimeout" && packet.msgId === waiting.msgId && packet.to === waiting.destination) return "timeout";
  if (["error", "txError"].includes(String(packet.type)) && packet.requestId === waiting.requestId) return "txFailed";
  return null;
}
export type TestPlan = { runId: string; destination: string; scenario: string; intervalMs: number };
type Hooks = {
  send(sequence: number, text: string): Promise<TestOutcome>;
  record(type: string, data: Record<string, string | number | boolean>): Promise<unknown>;
  progress(value: TestProgress): void;
  check(): void;
};
function abortError() { return new Error("Prueba cancelada"); }
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const stop = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}
export async function runSequentialTest(plan: TestPlan, signal: AbortSignal, hooks: Hooks,
  delay = abortableDelay): Promise<TestProgress> {
  if (!/^[A-F0-9]{12}$/.test(plan.runId) || !plan.destination || plan.destination === "broadcast"
    || !plan.scenario.trim() || !Number.isInteger(plan.intervalMs) || plan.intervalMs < 2000 || plan.intervalMs > 60000) {
    throw new Error("Prueba inválida: destino dirigido, escenario e intervalo de 2–60 s obligatorios.");
  }
  const state: TestProgress = { runId: plan.runId, phase: "running", attempted: 0, ack: 0, timeouts: 0, txFailed: 0 };
  try {
    hooks.check();
    await hooks.record("testStart", { ...plan, planned: 100 });
    for (let sequence = 1; sequence <= 100; ++sequence) {
      if (signal.aborted) throw abortError();
      hooks.check();
      state.attempted = sequence;
      hooks.progress({ ...state });
      const result = await hooks.send(sequence, `T:${plan.runId}:${String(sequence).padStart(3, "0")}/100`);
      if (result === "unknown") throw new Error("No se observó la respuesta BLE; se detuvo sin clasificarla como pérdida de radio.");
      if (result === "ack") ++state.ack;
      if (result === "timeout") ++state.timeouts;
      if (result === "txFailed") ++state.txFailed;
      hooks.progress({ ...state });
      if (sequence < 100) await delay(plan.intervalMs, signal);
    }
    state.phase = "completed";
  } catch (error) {
    state.phase = signal.aborted ? "cancelled" : "interrupted";
    state.reason = signal.aborted && typeof signal.reason === "string" ? signal.reason : error instanceof Error ? error.message : String(error);
  }
  try { await hooks.record("testEnd", { ...state }); }
  finally { hooks.progress({ ...state }); } // A full disk must not leave the UI stuck in "running".
  return state;
}
