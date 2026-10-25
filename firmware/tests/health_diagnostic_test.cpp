#define MESH_BOARD_PROFILE 43
#define MESH_HEALTH_DIAGNOSTIC_TEST
#include "../max30102_sensor.h"
#include <assert.h>
#include <stdio.h>

struct MeshHealthDiagnosticTest {
  static void ready(MeshMax30102 &sensor, MeshHealthSnapshot &s) {
    mockNow = 100;
    s.enabled = true;
    assert(sensor.configure(s));
    assert(s.present && s.configAttempts == 1 && s.i2cErrors == 0);
    assert(s.partId == 21 && s.configRegister == 39 && s.fifoConfigRegister == 79);
    assert(s.fifoResetsVerified == 1 && s.fifoResetFailures == 0);
    assert(s.pausedMode == 131 && s.resumedMode == 3);
    assert(s.resetWrite == 0 && s.resetOverflow == 0 && s.resetRead == 0);
    assert(sensor.bus.pointerBurstReads == 0);
    assert(sensor.bus.pointerWriteModes.size() == 3);
    for (auto mode : sensor.bus.pointerWriteModes) assert(mode == 131);
    assert(!strcmp(meshHealthDisplayLabel(s), "MAX tomando muestras"));
  }
  static void sample(MeshMax30102 &sensor, MeshHealthSnapshot &s,
                     uint32_t red = 40000, uint32_t ir = 50000) {
    sensor.bus.registers[4] = (sensor.bus.registers[6] + 1) & 31;
    sensor.bus.fifo = {uint8_t(red >> 16), uint8_t(red >> 8), uint8_t(red),
                      uint8_t(ir >> 16), uint8_t(ir >> 8), uint8_t(ir)};
    mockNow += 40;
    assert(sensor.poll(s));
  }
  static void run() {
    {
      MeshMax30102 sensor; MeshHealthSnapshot s; ready(sensor, s);
      // r1-like raw snapshot: wr=0, ovf=25, rd=0. Clear only while paused,
      // verify, resume, then accept actual samples instead of resetting forever.
      s.heartValid = s.spo2Valid = s.valueSeen = true;
      sensor.bus.registers[5] = 25;
      assert(sensor.poll(s));
      assert(s.fifoOverflow == 25 && s.fifoOverflows == 1 && s.i2cErrors == 0);
      assert(s.fifoResetsVerified == 2 && s.fifoResetFailures == 0);
      assert(!s.valueSeen && !s.heartValid && !s.spo2Valid && !s.sampleSeen);
      assert(!strcmp(s.lastFault, "fifo_overflow") && !strcmp(s.state, "warming"));
      assert(s.resetOverflow == 0 && s.resumedMode == 3);
      // Fake bus corrupts a pointer burst, but r2 never issues that burst.
      for (unsigned i = 0; i < 100; ++i) sample(sensor, s, 40000 + i * 2, 50000 + i * 3);
      assert(s.samples == 100 && s.windowSamples == 100 && !strcmp(s.state, "reading"));
      assert(s.heartValid && s.spo2Valid && s.heartRate == 72 && s.spo2 == 97);
      assert(sensor.bus.pointerBurstReads == 0 && sensor.recoveriesWithoutSample == 0);
      assert(s.fifoResets == 2 && s.i2cErrors == 0);
    }
    {
      MeshMax30102 sensor; MeshHealthSnapshot s; ready(sensor, s);
      // Persistent overflow: at most 3 recoveries before returning false to
      // the worker's 2-second reconfiguration backoff, with sampling paused.
      for (unsigned i = 0; i < 3; ++i) {
        sensor.bus.registers[5] = 25;
        assert(sensor.poll(s));
      }
      sensor.bus.registers[5] = 25;
      assert(!sensor.poll(s));
      assert(s.recoveryLimitHits == 1 && s.fifoResets == 4 && s.samples == 0);
      assert(s.fifoResetsVerified == 4 && s.i2cErrors == 0 && s.present);
      assert(sensor.bus.registers[9] == 131 && !s.valueSeen);
      assert(!strcmp(s.state, "fifo_recovery_failed"));
      assert(!strcmp(meshHealthDisplayLabel(s), "MAX FIFO persistente"));
    }
    {
      MeshMax30102 sensor; MeshHealthSnapshot s; ready(sensor, s);
      mockNow = sensor.configuredAt + 1001;
      assert(!sensor.poll(s));
      assert(!strcmp(s.state, "no_samples") && s.present);
      assert(s.sampleTimeouts == 1 && s.i2cErrors == 0);
    }
    {
      MeshMax30102 sensor; MeshHealthSnapshot s; ready(sensor, s);
      sensor.bus.registers[0] = 0x20;
      assert(sensor.poll(s));
      assert(s.ambientOverflows == 1 && !strcmp(s.lastFault, "ambient_overflow"));
      sample(sensor, s);
      assert(sensor.recoveriesWithoutSample == 0 && s.samples == 1);
      sensor.bus.registers[0] = 1;
      assert(!sensor.poll(s));
      assert(s.powerEvents == 1 && s.present && !strcmp(s.state, "power_event"));
    }
    {
      MeshMax30102 sensor; MeshHealthSnapshot s; ready(sensor, s);
      sample(sensor, s);
      mockNow += 501;
      assert(sensor.poll(s));
      assert(s.sampleGaps == 1 && !s.sampleSeen && !s.valueSeen);
      assert(!strcmp(s.lastFault, "sample_gap") && s.fifoResetsVerified == 2);
    }
    {
      MeshMax30102 sensor; MeshHealthSnapshot s; ready(sensor, s);
      sensor.bus.failRegister = 0;
      assert(!sensor.poll(s));
      assert(s.i2cErrors == 1 && !s.present && s.lastI2cRegister == 0);
      assert(s.lastI2cCode == 2 && !strcmp(s.lastI2cOperation, "read_address"));
      sensor.bus.failRegister = -1;
      assert(sensor.configure(s));
      sensor.bus.shortRegister = 4;
      assert(!sensor.poll(s));
      assert(s.i2cErrors == 2 && s.lastI2cExpected == 1 && s.lastI2cReceived == 0);
      assert(!strcmp(s.lastI2cOperation, "short_read"));
      sensor.bus.shortRegister = -1;
      sensor.bus.failRegister = 0xFF;
      assert(!sensor.configure(s));
      assert(!strcmp(s.state, "missing") && !s.present && s.i2cErrors == 3);
      sensor.bus.failRegister = -1;
      sensor.bus.registers[0xFF] = 0x16;
      assert(!sensor.configure(s));
      assert(!strcmp(s.state, "wrong_device") && s.partId == 0x16 && s.i2cErrors == 3);
      sensor.bus.registers[0xFF] = 0x15;
      sensor.bus.badConfig = true;
      assert(!sensor.configure(s));
      assert(!strcmp(s.state, "config_error") && s.present && s.configRegister == 0);
    }
    {
      MeshMax30102 sensor; MeshHealthSnapshot s; ready(sensor, s);
      // ACK but overflow-clear write has no effect: DO NOT resume.
      sensor.bus.registers[5] = 25; sensor.bus.ignoreWriteRegister = 5;
      assert(!sensor.poll(s));
      assert(s.fifoResetFailures == 1 && s.fifoResetsVerified == 1);
      assert(s.present && s.i2cErrors == 0 && s.resetOverflow == 25);
      assert(sensor.bus.registers[9] == 131 && s.resumedMode == -1);
      assert(!strcmp(s.state, "fifo_reset_failed") && !s.valueSeen);
      assert(!strcmp(meshHealthDisplayLabel(s), "MAX fallo vaciado"));
    }
    {
      MeshMax30102 sensor; MeshHealthSnapshot s; ready(sensor, s);
      // Bus failure during a clear remains I2C failure, not readback failure.
      sensor.bus.registers[5] = 3;
      sensor.bus.failRegister = 5; sensor.bus.failWritesOnly = true;
      assert(!sensor.poll(s));
      assert(s.i2cErrors == 1 && !s.present && !strcmp(s.state, "i2c_error"));
      assert(s.fifoResetFailures == 1 && s.lastI2cRegister == 5);
      assert(!strcmp(s.lastI2cOperation, "write"));
    }
    {
      MeshMax30102 sensor; MeshHealthSnapshot s; ready(sensor, s);
      sensor.bus.registers[5] = 3; sensor.bus.ignoreShutdown = true;
      auto writesBefore = sensor.bus.pointerWriteModes.size();
      assert(!sensor.poll(s));
      assert(s.pausedMode == 3 && s.fifoResetFailures == 1 && s.i2cErrors == 0);
      assert(sensor.bus.pointerWriteModes.size() == writesBefore); // No live clear.
      assert(!strcmp(s.state, "fifo_reset_failed"));
    }
    {
      MeshMax30102 sensor; MeshHealthSnapshot s; ready(sensor, s);
      sensor.bus.registers[5] = 3; sensor.bus.ignoreResume = true;
      assert(!sensor.poll(s));
      assert(s.pausedMode == 131 && s.resumedMode == 131 && s.fifoResetFailures == 1);
      assert(s.fifoResetsVerified == 1 && !s.valueSeen && s.i2cErrors == 0);
    }
    {
      MeshMax30102 sensor; MeshHealthSnapshot s; ready(sensor, s);
      sensor.bus.registers[4] = 1; sensor.bus.registers[6] = 31;
      sensor.bus.fifo = {0, 0x9C, 0x40, 0, 0xC3, 0x50};
      assert(sensor.poll(s));
      assert(s.samples == 2 && sensor.bus.registers[6] == 1); // Pointer wrap.
      sensor.bus.registers[4] = 2; sensor.bus.shortRegister = 7;
      assert(!sensor.poll(s));
      assert(s.samples == 2 && !s.valueSeen && s.i2cErrors == 1); // No partial sample.
      sensor.bus.shortRegister = -1;
      assert(sensor.configure(s));
      assert(!strcmp(s.lastFault, "i2c_error")); // Latched after recovery.
      assert(sensor.begin() && sensor.setEnabled(false));
      auto disabled = sensor.snapshot();
      assert(!disabled.enabled && !disabled.heartValid && !disabled.spo2Valid);
      assert(!strcmp(meshHealthDisplayLabel(disabled), "MAX30102 apagado"));
    }
    puts("MAX30102 r2: verified paused clear, sample recovery, bounded retries, NACK, short read, ignored writes, resume failure, pointer wrap and validity PASS");
  }
};
int main() { MeshHealthDiagnosticTest::run(); }
