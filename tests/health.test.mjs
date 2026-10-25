import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHealth, healthIsFresh, healthStatusText, healthSupportReading } from '../src/lib/health.ts';

const packet = { supported: true, enabled: true, present: true, contact: true,
  experimental: true, state: 'reading', heartRateValid: true, spo2Valid: true,
  heartRateBpm: 72, spo2Percent: 97, ageMs: 100, sampleAgeMs: 10,
  red: 40000, infrared: 50000, windowSamples: 100 };

test('health: explicit algorithm flags, fresh sample and measurement required', () => {
  const value = normalizeHealth(packet, 1000);
  assert.equal(value.heartRateBpm, 72);
  assert.equal(value.spo2Percent, 97);
  assert.equal(healthIsFresh(value, 3400), true);
  assert.equal(healthIsFresh(value, 3401), false);
  assert.equal(healthIsFresh(value, 999), false);
  for (const invalid of [
    { supported: false }, { enabled: false }, { present: false }, { contact: false },
    { experimental: false }, { state: 'warming' }, { state: 'poor_signal' },
    { state: 'ambient_overflow' }, { state: 'fifo_overflow' }, { state: 'no_samples' },
    { state: 'sample_gap' }, { state: 'power_event' }, { state: 'config_error' },
    { state: 'i2c_error' }, { state: 'missing' },
    { state: 'fifo_reset_failed' }, { state: 'fifo_recovery_failed' },
    { ageMs: -1 }, { ageMs: 2501 }, { sampleAgeMs: -1 }, { sampleAgeMs: 501 },
    { ageMs: NaN }, { contact: 'true' },
  ]) {
    const result = normalizeHealth({ ...packet, ...invalid }, 1000);
    assert.equal(result.heartRateBpm, null, JSON.stringify(invalid));
    assert.equal(result.spo2Percent, null, JSON.stringify(invalid));
    assert.equal(healthIsFresh(result, 1000), false);
  }
});

test('health: invalid results are null, independent channels, no medical classification', () => {
  assert.equal(normalizeHealth({ ...packet, heartRateValid: false }).heartRateBpm, null);
  assert.equal(normalizeHealth({ ...packet, spo2Valid: false }).spo2Percent, null);
  for (const heartRateBpm of [0, 19, 301, NaN, Infinity, '72', undefined]) {
    assert.equal(normalizeHealth({ ...packet, heartRateBpm }).heartRateBpm, null);
  }
  for (const spo2Percent of [-1, 101, NaN, Infinity, '97', undefined]) {
    assert.equal(normalizeHealth({ ...packet, spo2Percent }).spo2Percent, null);
  }
  // A numeric bound is not a clinical threshold; do not manufacture "normal" status.
  assert.equal(normalizeHealth({ ...packet, spo2Percent: 40 }).spo2Percent, 40);
  assert.equal(normalizeHealth({ ...packet, red: 300000 }).red, null);
  assert.equal(normalizeHealth({ ...packet, enabled: false }).infrared, null);
  const value = normalizeHealth(packet, 1000);
  assert.match(healthStatusText(value, 1000), /experimental/);
  assert.match(healthStatusText(value, 5000), /actualización/);
});

test('emergency support: quality describes data availability, never clinical severity', () => {
  for (const [heartRateBpm, spo2Percent] of [[72, 97], [30, 40], [280, 100]]) {
    const reading = healthSupportReading(normalizeHealth({ ...packet, heartRateBpm, spo2Percent }, 1000), 1100);
    assert.equal(reading.quality, 'available');
    assert.equal(reading.heart, heartRateBpm); assert.equal(reading.oxygen, spo2Percent);
    assert.equal(reading.measuredAt, 900);
    assert.match(reading.guidance, /disponibilidad técnica/);
  }
  for (const invalid of [{ heartRateValid: false }, { spo2Valid: false }]) {
    const reading = healthSupportReading(normalizeHealth({ ...packet, ...invalid }, 1000), 1000);
    assert.equal(reading.quality, 'partial'); assert.match(reading.label, /parcial/);
  }
  for (const value of [null, normalizeHealth({ ...packet, contact: false }, 1000),
    normalizeHealth({ ...packet, state: 'poor_signal' }, 1000), normalizeHealth({ ...packet, enabled: false }, 1000)]) {
    const reading = healthSupportReading(value, 1000);
    assert.equal(reading.quality, 'unavailable'); assert.equal(reading.measuredAt, null);
    assert.equal(reading.heart, null); assert.equal(reading.oxygen, null);
    assert.match(reading.label, /Medición no disponible; repetir/);
    assert.match(reading.guidance, /sin una lectura válida/);
  }
  const expired = healthSupportReading(normalizeHealth(packet, 1000), 4000);
  assert.equal(expired.quality, 'unavailable'); assert.equal(expired.measuredAt, null);
  assert.equal(healthSupportReading(normalizeHealth(packet, 1000), 999).quality, 'unavailable');
});
