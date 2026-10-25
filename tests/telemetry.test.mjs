import { test } from "node:test";
import assert from "node:assert/strict";
import { TelemetryJournal, metricPacket, testTag, summarizeTest, archiveCsv } from "../src/lib/telemetry.ts";
import { matchTestResponse, runSequentialTest, abortableDelay } from "../src/lib/test-runner.ts";

const identity = { nodeId: "N-123", bootId: "ABCDEF0011223344", uptimeMs: 2345, board: "V3", firmwareVersion: "5.4.0" };
function memory() { const values = new Map(); return { values,
  async getItem(k) { return values.get(k) ?? null; }, async setItem(k,v) { values.set(k,v); } }; }

test("journal: durable pages, reload, same-boot reconnect and separate new boots", async () => {
  const store = memory(), j = new TelemetryJournal(store);
  await j.init(); const id = await j.select(identity);
  await Promise.all(Array.from({ length: 150 }, (_, i) => j.append("status", { "metrics.extraFutureMetric": i })));
  assert.equal((await j.archive(id)).records.length, 150);
  const reloaded = new TelemetryJournal(store); await reloaded.init();
  assert.equal(await reloaded.select(identity), id);
  assert.equal(reloaded.sessions.length, 1);
  await reloaded.append("captureStart", { uptimeMs: 9000 });
  assert.equal((await reloaded.archive(id)).records.length, 151);
  const other = await reloaded.select({ ...identity, bootId: "0000000000000001" });
  assert.notEqual(other, id); assert.equal(reloaded.sessions.length, 2);
  const demo = await reloaded.select(identity, true); assert.notEqual(demo, id);
});

test("journal: crash between page and index is recovered without overwriting events", async () => {
  const store = memory(), j = new TelemetryJournal(store); await j.init(); const id = await j.select(identity);
  await j.append("status", { n: 1 });
  const [indexKey, indexJson] = [...store.values.entries()].find(([k]) => k.endsWith("/index"));
  const index = JSON.parse(indexJson); index[0].records = 0;
  store.values.set(indexKey, JSON.stringify(index));
  const reloaded = new TelemetryJournal(store); await reloaded.init(); await reloaded.select(identity);
  await reloaded.append("status", { n: 2 });
  assert.deepEqual((await reloaded.archive(id)).records.map(r => r.data.n), [1, 2]);
});

test("journal: storage errors are visible, fail closed for writes, allow rescue export", async () => {
  const store = memory(); let failed = false;
  const actual = store.setItem; store.setItem = async (k,v) => { if (failed) throw Error("disk full"); await actual(k,v); };
  const j = new TelemetryJournal(store); await j.init(); const id = await j.select(identity);
  await j.append("sent", { ok: true }); failed = true;
  await assert.rejects(j.append("sent", { ok: false }), /disk full/);
  await assert.rejects(j.flush(), /disk full/);
  assert.equal((await j.archive(id)).records.length, 1);
});

test("privacy: only numeric telemetry and identifiers, never bodies, keys, GPS or physiology", () => {
  const record = metricPacket({ type: "message", text: "SECRET", payload: { data: "ciphertext" }, key: "secretkey",
    latitude: 12, heartRateBpm: 88, rssi: -101, metrics: { futureMetric: 123, malformed: NaN, password: "SECRET" },
    ble: { notificationsSent: 5, lastCommand: "send secret" } });
  assert.equal(record.data.rssi, -101); assert.equal(record.data["metrics.futureMetric"], 123);
  assert.doesNotMatch(JSON.stringify(record), /SECRET|ciphertext|secretkey|latitude|heartRateBpm|lastCommand/);
  assert.equal(metricPacket({ type: "gps", latitude: 12 }), null);
  assert.equal(metricPacket({ type: "health", heartRateBpm: 88 }), null);
});

test("test correlation: reject unrelated, late and wrong-destination replies", () => {
  const pending = { requestId: "request-2", destination: "B" };
  assert.equal(matchTestResponse(pending, { type: "ack", from: "B" }), null);
  assert.equal(matchTestResponse(pending, { type: "sent", requestId: "request-1", to: "B", ok: true, msgId: "OLD" }), null);
  assert.equal(pending.msgId, undefined);
  assert.equal(matchTestResponse(pending, { type: "sent", requestId: "request-2", to: "B", ok: true, msgId: "NEW" }), null);
  assert.equal(pending.msgId, "NEW");
  assert.equal(matchTestResponse(pending, { type: "ack", ackFor: "OLD", from: "B" }), null);
  assert.equal(matchTestResponse(pending, { type: "ack", ackFor: "NEW", from: "C" }), null);
  assert.equal(matchTestResponse(pending, { type: "error", requestId: "other" }), null);
  assert.equal(matchTestResponse(pending, { type: "ack", ackFor: "NEW", from: "B" }), "ack");
});

const plan = { runId: "ABCDEF123456", destination: "N-B", scenario: "Sótano", intervalMs: 2000 };
test("test runner: exactly 100 numbered sends, never concurrent, 99 controlled pauses", async () => {
  let inFlight = 0, count = 0, pauses = 0; const events = [];
  const result = await runSequentialTest(plan, new AbortController().signal, {
    check() {}, record: async (type, data) => events.push({ type, data }), progress() {},
    send: async (n, text) => {
      assert.equal(++inFlight, 1); ++count;
      assert.deepEqual(testTag(text), { runId: plan.runId, sequence: n });
      assert.ok(new TextEncoder().encode(text).length <= 32);
      await Promise.resolve(); --inFlight;
      return n <= 70 ? "ack" : n <= 90 ? "timeout" : "txFailed";
    },
  }, async ms => { assert.equal(ms, 2000); ++pauses; });
  assert.equal(count, 100); assert.equal(pauses, 99);
  assert.equal(result.phase, "completed"); assert.equal(result.ack, 70); assert.equal(result.timeouts, 20); assert.equal(result.txFailed, 10);
  assert.deepEqual(events.map(e => e.type), ["testStart", "testEnd"]);
});

test("test runner: cancel/no BLE observation/background stops, no automatic resume", async () => {
  const controller = new AbortController(); let sent = 0;
  const hooks = { check() {}, record: async () => {}, progress() {}, send: async () => { ++sent; return "ack"; } };
  const cancelled = await runSequentialTest(plan, controller.signal, hooks, async () => { controller.abort("background"); });
  assert.equal(sent, 1); assert.equal(cancelled.phase, "cancelled"); assert.equal(cancelled.reason, "background");
  sent = 0;
  const interrupted = await runSequentialTest(plan, new AbortController().signal, { ...hooks, send: async () => { ++sent; return "unknown"; } });
  assert.equal(sent, 1); assert.equal(interrupted.phase, "interrupted"); assert.equal(interrupted.timeouts, 0);
  const stopped = new AbortController(); stopped.abort(); await assert.rejects(abortableDelay(2000, stopped.signal));
  await assert.rejects(runSequentialTest({ ...plan, intervalMs: 0 }, new AbortController().signal, hooks), /inválida/);
  await assert.rejects(runSequentialTest({ ...plan, destination: "broadcast" }, new AbortController().signal, hooks), /inválida/);
});

test("report: per-test PDR denominators, ACK-only mean, unique received, separate RSSI from ACK", () => {
  const rows = []; const add = (type, data) => rows.push({ type, data, at: 0 });
  for (let n = 1; n <= 10; ++n) {
    add("testAttempt", { runId: plan.runId, sequence: n, requestId: `r${n}` });
    add("sent", { requestId: `r${n}`, msgId: `m${n}`, ok: true });
    if (n <= 7) add("ack", { ackFor: `m${n}`, latencyMs: 1000 + n, rssi: -10 });
    else add("ackTimeout", { msgId: `m${n}` });
  }
  add("ack", { ackFor: "unrelated", latencyMs: 9999 });
  add("testRx", { runId: plan.runId, from: "N-A", sequence: 1, rssi: -100, snr: 9 });
  add("testRx", { runId: plan.runId, from: "N-A", sequence: 1, rssi: -120, snr: -1 });
  const s = summarizeTest(rows, plan.runId);
  assert.equal(s.pdrAck, 70); assert.equal(s.avgAckLatencyMs, 1004); assert.equal(s.timeouts, 3);
  assert.equal(s.received, 1); assert.equal(s.avgRxRssi, -100); assert.equal(s.avgRxSnr, 9);
  assert.equal(summarizeTest([], plan.runId).pdrAck, null);
  assert.equal(testTag("T:ABCDEF123456:101/100"), null);
});

test("test runner: failed persistence cannot leave the UI running or permit another send", async () => {
  const updates = []; let sent = 0;
  await assert.rejects(runSequentialTest(plan, new AbortController().signal, {
    check() {}, progress: state => updates.push(state),
    record: async () => { throw Error("disk full"); },
    send: async () => { ++sent; return "ack"; },
  }), /disk full/);
  assert.equal(sent, 0); assert.equal(updates.at(-1).phase, "interrupted");
});

test("CSV: dynamic metric columns, commas/quotes/newlines, no formula execution", () => {
  const csv = archiveCsv({ session: { ...identity, id: "node-boot", demo: false }, records: [
    { at: 0, type: "testStart", data: { scenario: '=HYPERLINK("x")', "metrics.new": -101.4, note: "a,b\nc" } },
  ] });
  assert.match(csv, /metrics.new/); assert.match(csv, /"-101.4"/); assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"a,b\nc"/);
});
