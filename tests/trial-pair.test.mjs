import { test } from "node:test";
import assert from "node:assert/strict";
import { TrialCoordinator } from "../src/lib/trial-coordinator.ts";
import { TelemetryJournal, summarizeTest, testTag } from "../src/lib/telemetry.ts";
import { encodeTrialControl, decodeTrialControl } from "../src/lib/trial-protocol.ts";

function memory() {
  const values = new Map();
  return { values, async getItem(k) { return values.get(k) ?? null; }, async setItem(k,v) { values.set(k,v); } };
}
async function until(predicate, timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw Error("Test condition timed out");
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
async function pair(options = {}) {
  let counter = 0;
  const endpoints = {}, wire = [];
  for (const id of ["N-A", "N-B"]) {
    const store = memory(), journal = new TelemetryJournal(store);
    await journal.init();
    const identity = { nodeId: id, bootId: id === "N-A" ? "AAAAAAAAAAAAAAAA" : "BBBBBBBBBBBBBBBB",
      board: "V4", firmwareVersion: "5.5.0", snapshotCorrelation: true, uptimeMs: 1000 };
    const endpoint = { id, store, journal, errors: [], views: [], identity, queries: 0 };
    endpoints[id] = endpoint;
    endpoint.coordinator = new TrialCoordinator({
      journal, uuid: () => (++counter).toString(16).toUpperCase().padStart(12, "0") + "-0000-0000-0000-000000000000",
      change: v => endpoint.views.push(v), error: e => endpoint.errors.push(e),
      delay: options.pause ? async () => new Promise(resolve => setTimeout(resolve, options.pause)) : async () => {},
      timeouts: { snapshot: 300, peer: 400, send: 300 },
      query: async (type, requestId) => {
        endpoint.queries++;
        if (options.noSnapshots === id) return;
        endpoint.coordinator.receive({ ...identity, type, requestId, metrics: { txPackets: counter, futureMetric: 42 } });
      },
      transmit: async (to, text, requestId, signal) => {
        if (signal.aborted) throw Error("aborted");
        wire.push({ from: id, to, text });
        const msgId = `${id}-${++counter}`;
        endpoint.coordinator.receive({ ...identity, type: "sent", requestId, msgId, ok: true, to, bytes: 130 });
        const tag = testTag(text);
        const control = decodeTrialControl(text);
        const delivered = !tag || !options.deliver || options.deliver(tag.sequence);
        const recipient = endpoints[to];
        if (recipient && delivered && !(options.dropSaved && control?.kind === "saved")) {
          if (options.failReceiverDuringData && id === "N-A" && tag?.sequence === 25) {
            recipient.store.setItem = async () => { throw Error("storage full mid-trial"); };
          }
          const packet = { ...recipient.identity, type: "message", from: id, to, msgId, broadcast: false,
            bytes: 130, rssi: -101.4, snr: 9.88, encrypted: true };
          recipient.coordinator.receive(packet);
          recipient.coordinator.incoming(tag && options.decryptFail?.(tag.sequence) ? "[decrypt failed]" : text, packet,
            tag && options.decryptFail?.(tag.sequence) ? { success: false } : undefined);
        }
        if (tag && options.noSentObservation) return;
        endpoint.coordinator.receive({ ...identity,
          ...(tag && options.acked && !options.acked(tag.sequence)
            ? { type: "ackTimeout", msgId, to }
            : { type: "ack", ackFor: msgId, from: to, latencyMs: 1500 }),
        });
      },
    });
    endpoint.coordinator.updateLink({ nodeId: id, connected: true, demo: false, correlation: true, idle: true, encrypted: true });
    endpoint.coordinator.receive({ ...identity, type: "info" });
  }
  return { a: endpoints["N-A"], b: endpoints["N-B"], wire };
}

test("control codec: fits 32 bytes, rejects malformed/overfull manifests", () => {
  const runId = "ABCDEF123456";
  for (const c of [{ kind: "start", runId, intervalMs: 60000 }, { kind: "ready", runId },
    { kind: "finish", runId, attempted: 100, sent: 95, complete: true }, { kind: "saved", runId, received: 95 }, { kind: "stop", runId }]) {
    const encoded = encodeTrialControl(c);
    assert.ok(new TextEncoder().encode(encoded).length <= 32);
    assert.deepEqual(decodeTrialControl(encoded), c);
  }
  assert.equal(decodeTrialControl(`E1:F:${runId}:001:002:C`), null);
  assert.equal(decodeTrialControl(`E1:F:${runId}:002:001:C`), null);
  assert.equal(decodeTrialControl(`E1:S:${runId}:100:00`), null);
});

test("two phones: idle view creates no logs; no 100 sends without receiver prepared", async () => {
  const { a, b, wire } = await pair();
  assert.equal(a.journal.sessions.length, 0); assert.equal(b.journal.sessions.length, 0);
  a.coordinator.setArmed(true);
  await a.coordinator.start("N-B", "Campo abierto", 2000);
  assert.equal(wire.filter(p => testTag(p.text)).length, 0);
  assert.equal(b.journal.sessions.length, 0);
  assert.equal(a.coordinator.view.phase, "interrupted");
  assert.equal(a.coordinator.view.remoteSaved, false);
});

test("two phones: both record same trial, 100 unique packets, exact per-test PDR and saved receipt", async () => {
  const { a, b, wire } = await pair({ deliver: n => n <= 75, acked: n => n <= 70 });
  a.coordinator.setArmed(true); b.coordinator.setArmed(true);
  await a.coordinator.start("N-B", "Sótano", 2000);
  await until(() => !b.coordinator.busy());
  assert.equal(a.coordinator.view.phase, "completed"); assert.equal(b.coordinator.view.phase, "completed");
  assert.equal(a.coordinator.view.remoteSaved, true);
  assert.equal(wire.filter(p => testTag(p.text)).length, 100);
  assert.equal(a.queries, 6); assert.equal(b.queries, 6); // Fresh info/nodes/status at both boundaries.
  const ar = await a.journal.archive(a.journal.sessions[0].id);
  const br = await b.journal.archive(b.journal.sessions[0].id);
  const runId = a.coordinator.view.runId;
  assert.equal(runId, b.coordinator.view.runId);
  assert.ok(ar.records.every(r => r.data.runId === runId));
  assert.ok(br.records.every(r => r.data.runId === runId));
  const tx = summarizeTest(ar.records, runId), rx = summarizeTest(br.records, runId);
  assert.equal(tx.pdrAck, 70); assert.equal(tx.avgAckLatencyMs, 1500);
  assert.equal(tx.remoteReceived, 75); assert.equal(tx.receiverConfirmed, true);
  assert.equal(rx.received, 75); assert.equal(rx.senderRadioSent, 100); assert.equal(rx.pdrReception, 75);
  assert.ok(Math.abs(rx.avgRxRssi + 101.4) < 0.000001); assert.ok(Math.abs(rx.avgRxSnr - 9.88) < 0.000001);
  assert.equal(a.errors.length, 0); assert.equal(b.errors.length, 0);
  const count = a.journal.sessions[0].records;
  a.coordinator.receive({ ...a.identity, type: "status", metrics: { txPackets: 9999 } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(a.journal.sessions[0].records, count); // No leakage after finalization.
});

test("receiver must persist baseline before READY; missing correlated snapshots prevent traffic", async () => {
  const { a, b, wire } = await pair({ noSnapshots: "N-B" });
  a.coordinator.setArmed(true); b.coordinator.setArmed(true);
  await a.coordinator.start("N-B", "Edificios", 2000);
  await until(() => !b.coordinator.busy());
  assert.equal(wire.filter(p => testTag(p.text)).length, 0);
  assert.equal(wire.some(p => decodeTrialControl(p.text)?.kind === "ready"), false);
  assert.equal(a.coordinator.view.phase, "interrupted");
});

test("lost final receipt cannot be reported as complete on sender", async () => {
  const { a, b } = await pair({ dropSaved: true });
  a.coordinator.setArmed(true); b.coordinator.setArmed(true);
  await a.coordinator.start("N-B", "Parque", 2000);
  await until(() => !b.coordinator.busy());
  assert.equal(a.coordinator.view.phase, "interrupted"); assert.equal(a.coordinator.view.remoteSaved, false);
  assert.equal(b.coordinator.view.phase, "completed");
});

test("opaque firmware ACK does not hide a receiving-phone decryption failure", async () => {
  const { a, b } = await pair({ decryptFail: n => n === 12 });
  a.coordinator.setArmed(true); b.coordinator.setArmed(true);
  await a.coordinator.start("N-B", "Descifrado", 2000);
  await until(() => !b.coordinator.busy());
  const ar = await a.journal.archive(a.journal.sessions[0].id);
  const br = await b.journal.archive(b.journal.sessions[0].id);
  const tx = summarizeTest(ar.records, a.coordinator.view.runId);
  const rx = summarizeTest(br.records, b.coordinator.view.runId);
  assert.equal(tx.pdrAck, 100); assert.equal(tx.remoteReceived, 99);
  assert.equal(rx.decryptFailures, 1); assert.equal(rx.pdrReception, 99);
});

test("receiver ignores unrelated data/control, and leaving Ensayos closes both without resume", async () => {
  const { a, b, wire } = await pair({ pause: 2 });
  a.coordinator.setArmed(true); b.coordinator.setArmed(true);
  const trial = a.coordinator.start("N-B", "Cancelar", 2000);
  await until(() => b.coordinator.view.phase === "receiving");
  const id = b.coordinator.view.runId;
  b.coordinator.incoming(`T:${id}:100/100`, { from: "N-OTHER", to: "N-B" });
  b.coordinator.setArmed(false);
  await trial; await until(() => !b.coordinator.busy());
  assert.equal(a.coordinator.view.phase, "interrupted"); assert.equal(b.coordinator.view.phase, "interrupted");
  const count = wire.filter(p => testTag(p.text)).length;
  b.coordinator.setArmed(true);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(wire.filter(p => testTag(p.text)).length, count);
});

test("any chosen node can be sender: reverse test remains separate in same boot sessions", async () => {
  const { a, b } = await pair();
  a.coordinator.setArmed(true); b.coordinator.setArmed(true);
  await a.coordinator.start("N-B", "Ida", 2000);
  const first = a.coordinator.view.runId;
  await until(() => !b.coordinator.busy());
  await b.coordinator.start("N-A", "Vuelta", 2000);
  await until(() => !a.coordinator.busy());
  const second = b.coordinator.view.runId;
  assert.notEqual(first, second);
  assert.equal(a.journal.sessions.length, 1); assert.equal(b.journal.sessions.length, 1);
  const ar = await a.journal.archive(a.journal.sessions[0].id);
  assert.equal(summarizeTest(ar.records, first).role, "sender");
  assert.equal(summarizeTest(ar.records, second).role, "receiver");
  assert.equal(summarizeTest(ar.records, second).pdrReception, 100);
});

test("receiver disk failure cannot emit READY or start any of the 100 data messages", async () => {
  const { a, b, wire } = await pair();
  a.coordinator.setArmed(true); b.coordinator.setArmed(true);
  b.store.setItem = async () => { throw Error("storage full"); };
  await a.coordinator.start("N-B", "Sin espacio", 2000);
  await until(() => !b.coordinator.busy());
  assert.equal(wire.filter(p => testTag(p.text)).length, 0);
  assert.equal(wire.some(p => decodeTrialControl(p.text)?.kind === "ready"), false);
  assert.equal(a.coordinator.view.remoteSaved, false); assert.ok(b.errors.length > 0);
});

test("wrong peer and plaintext READY cannot bypass receiver preparation", async () => {
  const { a, wire } = await pair();
  a.coordinator.setArmed(true);
  const running = a.coordinator.start("N-B", "Sin receptor", 2000);
  await until(() => wire.some(p => decodeTrialControl(p.text)?.kind === "start"));
  const text = encodeTrialControl({ kind: "ready", runId: a.coordinator.view.runId });
  a.coordinator.incoming(text, { from: "N-OTHER", to: "N-A", encrypted: true });
  a.coordinator.incoming(text, { from: "N-B", to: "N-A", encrypted: false });
  await running;
  assert.equal(wire.filter(p => testTag(p.text)).length, 0);
  assert.equal(a.coordinator.view.phase, "interrupted");
});

test("receiver write failure during data stops the run and never confirms remote saved", async () => {
  const { a, b, wire } = await pair({ failReceiverDuringData: true });
  a.coordinator.setArmed(true); b.coordinator.setArmed(true);
  await a.coordinator.start("N-B", "Fallo en recepción", 2000);
  await until(() => !b.coordinator.busy());
  assert.equal(a.coordinator.view.phase, "interrupted");
  assert.equal(a.coordinator.view.remoteSaved, false);
  assert.equal(wire.some(p => decodeTrialControl(p.text)?.kind === "saved"), false);
  assert.ok(b.errors.length > 0);
  assert.ok(wire.filter(p => testTag(p.text)).length < 100);
  const backup = await b.journal.archive(b.journal.sessions[0].id);
  assert.ok(backup.records.length > 0);
});
