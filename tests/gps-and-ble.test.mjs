import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGps, gpsIsFresh, gpsSosText } from '../src/lib/gps.ts';
import { SerialTaskQueue } from '../src/lib/serial-task-queue.ts';

const valid = { supported: true, enabled: true, hasFix: true, ageMs: 100,
  latitude: -12.08333, longitude: -77.05, satellites: 8 };

test('GPS: fresh coordinates, timeout, no-fix and malformed values', () => {
  const gps = normalizeGps(valid, 1000);
  assert.equal(gpsSosText(gps, 1000), 'SOS -12.08333,-77.05000');
  assert.equal(gpsIsFresh(gps, 10900), true);
  assert.equal(gpsIsFresh(gps, 10901), false);
  for (const bad of [
    { hasFix: false }, { enabled: false }, { supported: false },
    { latitude: 91 }, { longitude: 181 }, { latitude: NaN },
    { longitude: Infinity }, { ageMs: -1 }, { ageMs: 10001 },
    { latitude: '-12' }, { latitude: undefined },
  ]) {
    const rejected = normalizeGps({ ...valid, ...bad }, 1000);
    assert.equal(gpsIsFresh(rejected, 1000), false);
    assert.equal(rejected.latitude, null);
    assert.throws(() => gpsSosText(rejected, 1000));
  }
  assert.equal(gpsIsFresh(gps, 900), false); // Clock moving backwards.
  const zero = normalizeGps({ ...valid, latitude: 0, longitude: 0 }, 1000);
  assert.equal(gpsSosText(zero, 1000), 'SOS 0.00000,0.00000');
  const largest = normalizeGps({ ...valid, latitude: -90, longitude: -180 }, 1000);
  assert.ok(Buffer.byteLength(gpsSosText(largest, 1000)) <= 32);
});

test('BLE: concurrent frames never interleave; failure does not poison queue', async () => {
  const queue = new SerialTaskQueue();
  const chunks = [];
  const frame = (id) => queue.run(async () => {
    for (let i = 0; i < 3; i++) {
      chunks.push(`${id}${i}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  });
  await Promise.all([frame('message'), frame('gps'), frame('metric')]);
  assert.deepEqual(chunks, ['message0', 'message1', 'message2', 'gps0', 'gps1', 'gps2', 'metric0', 'metric1', 'metric2']);
  await assert.rejects(queue.run(async () => { throw new Error('write failed'); }));
  assert.equal(await queue.run(async () => 42), 42);
});
