import test from 'node:test';
import assert from 'node:assert/strict';
import { gcm } from '@noble/ciphers/aes.js';
import { normalizeHealth } from '../src/lib/health.ts';
import { HealthJournal, HEALTH_MAX_RECORDS, healthArchiveCsv } from '../src/lib/health-journal.ts';
import { createHealthShare, encodeHealthShare, decodeHealthShare, formatHealthShare, assertHealthTransport, declaredChoices, declaredLabels, healthShareRequestsHelp } from '../src/lib/health-share.ts';
import { SerialTaskQueue } from '../src/lib/serial-task-queue.ts';
import { metricPacket } from '../src/lib/telemetry.ts';
const NOW = Date.UTC(2026, 9, 21, 10);
const meta = { id: '012345ABCDEF', label: 'Participante P1', nodeId: 'N-A', bootId: 'A'.repeat(32), board: 'V4.3',
  firmwareVersion: '5.6.0', appVersion: '1.4.1', diagnosticRevision: 3, startedAt: NOW };
const packet = { type: 'health', nodeId: 'N-A', bootId: meta.bootId, uptimeMs: 1000, diagnosticRevision: 3,
  supported: true, enabled: true, present: true, contact: true, experimental: true, state: 'reading',
  heartRateValid: true, spo2Valid: true, heartRateBpm: 72, spo2Percent: 97, ageMs: 100, sampleAgeMs: 20,
  red: 40000, infrared: 50000, windowSamples: 100, samplesReceived: 200, fifoResets: 1, i2cErrors: 0,
  fifoResetsVerified: 1, lastFault: 'none', lastI2cOperation: 'none' };
const health = (extra = {}, at = NOW) => normalizeHealth({ ...packet, ...extra }, at);
class MemoryStore {
  map = new Map(); fail = () => false;
  async getItem(k) { return this.map.get(k) ?? null; }
  async setItem(k, v) { if (this.fail(k)) throw Error('disk full'); this.map.set(k, v); }
  async removeItem(k) { if (this.fail(k)) throw Error('delete failed'); this.map.delete(k); }
}
async function setup() { const store = new MemoryStore(), journal = new HealthJournal(store); await journal.init(); return { store, journal }; }

test('MAX sessions: opt-in only, persistent pages, no resume after restart', async () => {
  const { store, journal } = await setup();
  await journal.capture(health()); assert.equal(journal.sessions.length, 0);
  await journal.start(meta);
  for (let i = 0; i < 100; ++i) await journal.capture(health({ uptimeMs: 1000 + i * 1000 }, NOW + i * 1000), NOW + i * 1000);
  assert.equal(journal.sessions[0].records, 100);
  const loaded = new HealthJournal(store); await loaded.init();
  assert.equal(loaded.activeId, null); assert.equal(loaded.sessions[0].endReason, 'app_interrupted');
  assert.equal((await loaded.archive(meta.id)).records.length, 100);
  assert.ok(store.map.has(`@meshlink/health-v1/${meta.id}/3`));
});
test('MAX sessions: stop gates immediately, keeps in-flight committed packet, separate new session', async () => {
  const { journal } = await setup(); await journal.start(meta);
  const pending = journal.capture(health()); const stopping = journal.stop('screen_left', NOW + 100);
  await journal.capture(health({ uptimeMs: 2000 })); await Promise.all([pending, stopping]);
  assert.equal(journal.sessions[0].records, 1);
  assert.equal(journal.sessions[0].endReason, 'screen_left');
  await journal.start({ ...meta, id: 'ABCDEF123456' });
  await journal.capture(health({ uptimeMs: 3000 }));
  assert.equal(journal.sessions[1].records, 1);
});
test('MAX sessions: wrong peer/boot/reset uptime stop; duplicates are not invented samples', async () => {
  for (const bad of [{ nodeId: 'N-B' }, { bootId: 'B'.repeat(32) }, { uptimeMs: 10 }, { uptimeMs: -1 }]) {
    const { journal } = await setup(); await journal.start(meta); await journal.capture(health());
    await journal.capture(health()); assert.equal(journal.sessions[0].records, 1);
    await journal.capture(health(bad)); assert.equal(journal.activeId, null);
    assert.equal(journal.sessions[0].endReason, 'node_identity_changed');
  }
});
test('MAX sessions: no-contact, stale and independent invalid channels stored as null, not zero', async () => {
  const { journal } = await setup(); await journal.start(meta);
  await journal.capture(health({ state: 'no_contact', contact: false }));
  await journal.capture(health({ uptimeMs: 2000, heartRateValid: false }), NOW);
  await journal.capture(health({ uptimeMs: 3000 }), NOW + 5000);
  const rows = (await journal.archive(meta.id)).records;
  assert.equal(rows[0].health.heartRateBpm, null); assert.equal(rows[0].health.spo2Percent, null);
  assert.equal(rows[1].health.heartRateBpm, null); assert.equal(rows[1].health.spo2Percent, 97);
  assert.equal(rows[2].health.spo2Percent, null);
});
test('MAX sessions: page committed before index is recovered without overwriting', async () => {
  const { store, journal } = await setup(); await journal.start(meta);
  store.fail = k => k.endsWith('/index');
  await assert.rejects(journal.capture(health()), /disk full/); assert.equal(journal.activeId, null);
  assert.equal((await journal.archive(meta.id)).records.length, 1);
  store.fail = () => false;
  const restored = new HealthJournal(store); await restored.init();
  assert.equal(restored.sessions[0].records, 1);
  await restored.capture(health({ uptimeMs: 2000 }));
  assert.equal((await restored.archive(meta.id)).records.length, 1);
});
test('MAX sessions: full storage stops recording and sharing, rescue export remains available', async () => {
  const { store, journal } = await setup(); await journal.start(meta); await journal.capture(health());
  store.fail = k => !k.endsWith('/index');
  await assert.rejects(journal.capture(health({ uptimeMs: 2000 })), /disk full/);
  assert.equal(journal.activeId, null);
  await assert.rejects(journal.start({ ...meta, id: 'ABCDEFABCDEF' }), /disk full/);
  assert.equal((await journal.archive(meta.id)).records.length, 1);
});
test('MAX sessions: bounded write backlog fails closed, without collecting unbounded data', async () => {
  const { journal } = await setup(); await journal.start(meta);
  const jobs = [];
  for (let i = 0; i < 9; ++i) jobs.push(journal.capture(health({ uptimeMs: 1000 + i })));
  const results = await Promise.allSettled(jobs);
  assert.equal(journal.activeId, null); assert.match(journal.error, /lento/);
  assert.ok(results.some(r => r.status === 'rejected'));
  assert.equal((await journal.archive(meta.id)).records.length, 0);
});
test('MAX sessions: deletion is isolated and interrupted deletion finishes on reload', async () => {
  const { store, journal } = await setup(); await journal.start(meta); await journal.capture(health());
  await journal.stop();
  const other = { ...meta, id: '111111111111' }; await journal.start(other); await journal.capture(health()); await journal.stop();
  store.map.set('@lora-mesh/messages-v1', 'untouched');
  store.fail = k => k.includes(`/${meta.id}/`);
  await assert.rejects(journal.remove(meta.id), /delete failed/);
  store.fail = () => false;
  const reload = new HealthJournal(store); await reload.init();
  assert.equal(reload.sessions.length, 1); assert.equal(reload.sessions[0].id, other.id);
  assert.equal(store.map.get('@lora-mesh/messages-v1'), 'untouched');
  assert.ok(![...store.map.keys()].some(k => k.includes(`/${meta.id}/`)));
});
test('MAX privacy: only normalized physiological diagnostics, never keys, GPS, messages; network journal stays separate', async () => {
  const { journal } = await setup(); await journal.start(meta);
  await journal.capture(health({ networkKey: 'SECRET_KEY', latitude: -12, message: 'PRIVATE_CHAT', ciphertext: 'CIPHER',
    fifoResetFailures: 9, lastFault: 'fifo_reset_failed', heartRateBpm: NaN }));
  const raw = JSON.stringify(await journal.archive(meta.id));
  for (const forbidden of ['SECRET_KEY', 'latitude', 'PRIVATE_CHAT', 'CIPHER']) assert.ok(!raw.includes(forbidden));
  assert.ok(raw.includes('fifoResetFailures')); assert.ok(raw.includes('fifo_reset_failed'));
  assert.equal(metricPacket(packet), null);
});
test('MAX CSV: dynamic diagnostics, missing values blank, quotes and formulas safe', async () => {
  const { journal } = await setup(); await journal.start({ ...meta, label: '=SUM(1,2) "P1"' });
  await journal.capture(health({ contact: false, state: 'no_contact' }));
  const csv = healthArchiveCsv(await journal.archive(meta.id));
  assert.ok(csv.includes('"\'=SUM(1,2) ""P1"""'));
  assert.ok(csv.includes('fifoResetsVerified')); assert.ok(!csv.includes('NaN'));
  assert.ok(csv.includes('"no_contact","",""'));
});
test('MAX wire: both channels and missing channels fit encrypted 32-byte budget; canonical parser', () => {
  for (const heart of [null, 20, 72, 300]) for (const oxygen of [null, 0, 97, 100]) for (const declared of declaredChoices) {
    const r = { measuredAt: NOW, heart, oxygen, declared, reference: 'ABCDEF' };
    const wire = encodeHealthShare(r); assert.ok(Buffer.byteLength(wire) <= 32);
    assert.deepEqual(decodeHealthShare(wire), r);
  }
  for (const bad of ['', 'H1:invalid', 'H1:0000000:72:97:N:ABCDEF', encodeHealthShare(createHealthShare(health(), 'N', meta.id, NOW)) + '\n']) {
    assert.equal(decodeHealthShare(bad), null);
  }
  for (const r of [{ heart: 301 }, { oxygen: 101 }, { declared: 'SAFE' }, { reference: 'bad' }, { measuredAt: Infinity }]) {
    assert.throws(() => encodeHealthShare({ measuredAt: NOW, heart: 72, oxygen: 97, declared: 'N', reference: 'ABCDEF', ...r }));
  }
});
test('MAX sharing: stale/missing values never forwarded as recent, welfare is explicitly declared', () => {
  const fresh = createHealthShare(health(), 'B', meta.id, NOW);
  assert.equal(fresh.heart, 72); assert.equal(fresh.oxygen, 97);
  assert.match(formatHealthShare(fresh), /Estado declarado: Me siento bien \(no evaluado por el sensor\)/);
  assert.match(formatHealthShare(fresh), /no sustituye evaluación médica/);
  const old = createHealthShare(health(), 'A', meta.id, NOW + 9000);
  assert.equal(old.heart, null); assert.equal(old.oxygen, null);
  assert.equal(old.declared, 'A'); assert.ok(!encodeHealthShare(old).includes('72'));
  assert.match(formatHealthShare(old), /sin lectura válida/);
});
test('MAX sharing: encryption/default key/key change/cancel/expiry blocked, rechecked at queue start', async () => {
  const p = { encrypted: true, key: 'ClavePropia-123456', expectedKey: 'ClavePropia-123456', aborted: false, now: NOW, notAfter: NOW + 30000 };
  assert.doesNotThrow(() => assertHealthTransport(p));
  for (const bad of [{ encrypted: false }, { key: 'ClaveSecreta123!' }, { key: 'another-network-key' },
    { aborted: true }, { now: NOW + 30001 }, { notAfter: NaN }]) assert.throws(() => assertHealthTransport({ ...p, ...bad }));
  const queue = new SerialTaskQueue(); let release; const gate = new Promise(r => { release = r; });
  const first = queue.run(() => gate);
  let writes = 0;
  const queued = queue.run(async () => { assertHealthTransport(p); ++writes; });
  p.aborted = true; release(); await first; await assert.rejects(queued); assert.equal(writes, 0);
});
test('MAX sharing: real AES-128-GCM encrypted direct/broadcast payload can be decoded by receiver', () => {
  const key = new Uint8Array(16).fill(7), nonce = new Uint8Array(12).fill(3);
  const wire = encodeHealthShare(createHealthShare(health(), 'A', meta.id, NOW));
  const ciphertext = gcm(key, nonce).encrypt(new TextEncoder().encode(wire));
  assert.ok(3 + Buffer.concat([nonce, ciphertext]).toString('base64').length <= 83);
  for (const to of ['N-B', 'broadcast']) {
    const received = new TextDecoder().decode(gcm(key, nonce).decrypt(ciphertext));
    const report = decodeHealthShare(received); assert.equal(report.heart, 72); assert.equal(report.declared, 'A');
    assert.ok(to); // Same opaque payload over both existing firmware routes.
  }
  const tampered = ciphertext.slice(); tampered[0] ^= 1;
  assert.throws(() => gcm(key, nonce).decrypt(tampered));
});
test('MAX share audit: attempted/submitted are not ACK or remote saved; final result survives local stop', async () => {
  const { journal } = await setup(); await journal.start(meta);
  const report = createHealthShare(health(), 'A', meta.id, NOW);
  const record = { at: NOW, type: 'share', destination: 'broadcast', report, requestId: 'r1' };
  await journal.logShare({ ...record, outcome: 'attempt' }); await journal.stop();
  await journal.logShare({ ...record, outcome: 'submitted' }, meta.id);
  const a = await journal.archive(meta.id);
  assert.deepEqual(a.records.map(r => r.outcome), ['attempt', 'submitted']);
  assert.ok(!JSON.stringify(a).includes('remoteSaved'));
});
test('MAX sessions: bounded records close without automatic overwrite', async () => {
  const { journal } = await setup(); await journal.start(meta);
  for (let i = 0; i < HEALTH_MAX_RECORDS; ++i) await journal.capture(health({ uptimeMs: 1000 + i * 1000 }, NOW + i * 1000), NOW + i * 1000);
  assert.equal(journal.activeId, null); assert.equal(journal.sessions[0].endReason, 'record_limit');
  assert.equal((await journal.archive(meta.id)).records.length, HEALTH_MAX_RECORDS);
});

test('emergency support: only explicitly requested help is SOS, even without measurements', () => {
  assert.deepEqual(declaredChoices, ['A', 'M', 'B', 'N']);
  assert.equal(declaredLabels.M, 'Tengo molestias');
  for (const declared of declaredChoices) for (const value of [null, health({ heartRateBpm: 30, spo2Percent: 40 })]) {
    const report = createHealthShare(value, declared, meta.id, NOW);
    assert.equal(healthShareRequestsHelp(report), declared === 'A');
    assert.equal(decodeHealthShare(encodeHealthShare(report)).declared, declared);
    if (value === null) {
      assert.match(formatHealthShare(report), /Medición no disponible/);
      assert.match(formatHealthShare(report), /Hora del informe/);
    }
    if (declared === 'A') assert.match(formatHealthShare(report), /Solicitud de ayuda declarada/);
  }
  const partial = createHealthShare(health({ heartRateValid: false }), 'M', meta.id, NOW);
  assert.match(formatHealthShare(partial), /Medición parcial/);
  assert.match(formatHealthShare(partial), /Hora de medición/);
});

test('emergency support: discomfort travels in encrypted 32-byte packet and keeps legacy declarations', () => {
  const key = new Uint8Array(16).fill(9), nonce = new Uint8Array(12).fill(5);
  const report = createHealthShare(health(), 'M', meta.id, NOW);
  const wire = encodeHealthShare(report);
  assert.ok(Buffer.byteLength(wire) <= 32);
  const encrypted = gcm(key, nonce).encrypt(new TextEncoder().encode(wire));
  const received = decodeHealthShare(new TextDecoder().decode(gcm(key, nonce).decrypt(encrypted)));
  assert.deepEqual(received, report);
  assert.match(formatHealthShare(received), /Estado declarado: Tengo molestias/);
  for (const declared of ['N', 'A', 'B']) assert.equal(decodeHealthShare(encodeHealthShare({ ...report, declared })).declared, declared);
});

test('emergency support: declared discomfort survives journal reload and CSV/JSON export', async () => {
  const { store, journal } = await setup(); await journal.start(meta);
  const report = createHealthShare(health(), 'M', meta.id, NOW);
  await journal.logShare({ at: NOW, type: 'share', destination: 'N-B', report, outcome: 'submitted', requestId: 'support-1' });
  await journal.stop();
  const restored = new HealthJournal(store); await restored.init();
  const archive = await restored.archive(meta.id);
  assert.equal(archive.records[0].report.declared, 'M');
  assert.ok(healthArchiveCsv(archive).includes('"M","N-B","submitted"'));
  assert.equal(JSON.parse(JSON.stringify(archive)).records[0].report.declared, 'M');
});
