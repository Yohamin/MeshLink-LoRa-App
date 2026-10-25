#pragma once
#include "board_profile.h"
#include "health_signal.h"
#include <string.h>
#if MESH_HAS_MAX30102
#include <MAX30105.h>
#include <spo2_algorithm.h>
#include <freertos/task.h>
#endif

struct MeshHealthSnapshot {
  bool enabled = false, present = false, contact = false;
  bool sampleSeen = false, valueSeen = false, heartValid = false, spo2Valid = false;
  int32_t heartRate = 0, spo2 = 0;
  uint32_t red = 0, infrared = 0, lastSampleAt = 0, lastValueAt = 0;
  uint32_t samples = 0, fifoResets = 0, i2cErrors = 0;
  unsigned windowSamples = 0;
  const char *state = "off";
  // Diagnostic r2: counters are per boot, not medical data. A timeout is NOT
  // an I2C transaction failure. Raw registers are last observed, not live reads.
  uint32_t configAttempts = 0, configFailures = 0, ambientOverflows = 0;
  uint32_t fifoOverflows = 0, sampleTimeouts = 0, sampleGaps = 0, powerEvents = 0;
  uint32_t lastFaultAt = 0;
  const char *lastFault = "none", *lastI2cOperation = "none";
  int lastI2cRegister = -1, lastI2cCode = 0;
  unsigned lastI2cExpected = 0, lastI2cReceived = 0;
  int partId = -1, modeRegister = -1, configRegister = -1, fifoConfigRegister = -1;
  int statusRegister = -1, fifoWrite = -1, fifoOverflow = -1, fifoRead = -1;
  uint32_t fifoResetsVerified = 0, fifoResetFailures = 0, recoveryLimitHits = 0;
  int resetWrite = -1, resetOverflow = -1, resetRead = -1;
  int pausedMode = -1, resumedMode = -1;
};

inline const char *meshHealthDisplayLabel(const MeshHealthSnapshot &s) {
  if (!s.enabled) return "MAX30102 apagado";
  if (!strcmp(s.state, "missing")) return "MAX sin respuesta";
  if (!strcmp(s.state, "wrong_device")) return "MAX ID inesperado";
  if (!strcmp(s.state, "i2c_error")) return "MAX error I2C";
  if (!strcmp(s.state, "ambient_overflow")) return "MAX luz saturada";
  if (!strcmp(s.state, "fifo_overflow")) return "MAX FIFO saturado";
  if (!strcmp(s.state, "fifo_reset_failed")) return "MAX fallo vaciado";
  if (!strcmp(s.state, "fifo_recovery_failed")) return "MAX FIFO persistente";
  if (!strcmp(s.state, "no_samples")) return "MAX sin muestras";
  if (!strcmp(s.state, "sample_gap")) return "MAX muestras cortadas";
  if (!strcmp(s.state, "power_event")) return "MAX reinicio sensor";
  if (!strcmp(s.state, "config_error")) return "MAX config invalida";
  if (!strcmp(s.state, "library_init_error")) return "MAX fallo inicio";
  if (!strcmp(s.state, "bus_error")) return "MAX fallo bus I2C";
  if (!strcmp(s.state, "task_error")) return "MAX fallo tarea";
  if (!strcmp(s.state, "starting")) return "MAX iniciando";
  if (!strcmp(s.state, "warming")) return "MAX tomando muestras";
  if (!strcmp(s.state, "no_contact")) return "MAX sin contacto";
  if (!strcmp(s.state, "poor_signal")) return "MAX senal no valida";
  return "MAX sin dato reciente";
}

// The worker owns I2C and the vendor algorithm. It never touches BLE, LoRa,
// NVS or the OLED, and does not wait for a finger in the main mesh loop.
class MeshMax30102 {
 public:
  bool begin() {
#if MESH_HAS_MAX30102
    if (task) return true;
    if (xTaskCreate(taskEntry, "mesh-max30102", 6144, this, 1, &task) != pdPASS) {
      published.state = "task_error";
      return false;
    }
    return true;
#else
    return false;
#endif
  }
  bool setEnabled(bool enabled) {
#if MESH_HAS_MAX30102
    if (!task) return false;
    portENTER_CRITICAL(&gate);
    requested = enabled;
    ++generation;
    published.enabled = enabled;
    published.heartValid = published.spo2Valid = published.valueSeen = false;
    published.sampleSeen = published.contact = false;
    published.windowSamples = 0;
    published.state = enabled ? "starting" : "off";
    portEXIT_CRITICAL(&gate);
    return true;
#else
    return false;
#endif
  }
  MeshHealthSnapshot snapshot() {
#if MESH_HAS_MAX30102
    portENTER_CRITICAL(&gate);
    MeshHealthSnapshot result = published;
    portEXIT_CRITICAL(&gate);
    return result;
#else
    MeshHealthSnapshot result;
    result.state = "unsupported";
    return result;
#endif
  }
 private:
#ifdef MESH_HEALTH_DIAGNOSTIC_TEST
  friend struct MeshHealthDiagnosticTest;
#endif
#if MESH_HAS_MAX30102
  static constexpr uint8_t address = 0x57;
  TwoWire bus{1};
  MAX30105 device;
  TaskHandle_t task = nullptr;
  portMUX_TYPE gate = portMUX_INITIALIZER_UNLOCKED;
  bool requested = false;
  uint32_t generation = 0;
  MeshHealthSnapshot published;
  MeshHealthWindow window;
  uint32_t configuredAt = 0;
  uint8_t recoveriesWithoutSample = 0;
  static constexpr uint8_t maxRecoveriesWithoutSample = 3;

  static void taskEntry(void *self) { static_cast<MeshMax30102 *>(self)->run(); }
  void publish(const MeshHealthSnapshot &value, uint32_t epoch) {
    portENTER_CRITICAL(&gate);
    if (epoch == generation) published = value;
    portEXIT_CRITICAL(&gate);
  }
  void fault(MeshHealthSnapshot &s, const char *state) {
    invalidate(s, state);
    s.lastFault = state;
    s.lastFaultAt = millis();
  }
  bool i2cFailure(MeshHealthSnapshot &s, uint8_t reg, const char *operation,
                  int code, unsigned expected = 0, unsigned received = 0) {
    ++s.i2cErrors;
    s.present = false;
    s.lastI2cRegister = reg; s.lastI2cOperation = operation; s.lastI2cCode = code;
    s.lastI2cExpected = expected; s.lastI2cReceived = received;
    fault(s, "i2c_error");
    return false;
  }
  bool readRegisters(MeshHealthSnapshot &s, uint8_t reg, uint8_t *out, unsigned length) {
    bus.beginTransmission(address);
    bus.write(reg);
    int code = bus.endTransmission(false);
    if (code != 0) return i2cFailure(s, reg, "read_address", code);
    unsigned got = bus.requestFrom(address, uint8_t(length));
    if (got != length) {
      while (bus.available()) bus.read();
      return i2cFailure(s, reg, "short_read", 0, length, got);
    }
    for (unsigned i = 0; i < length; ++i) out[i] = uint8_t(bus.read());
    return true;
  }
  bool writeRegister(MeshHealthSnapshot &s, uint8_t reg, uint8_t value) {
    bus.beginTransmission(address);
    bus.write(reg);
    bus.write(value);
    int code = bus.endTransmission();
    return code == 0 || i2cFailure(s, reg, "write", code);
  }
  void invalidate(MeshHealthSnapshot &s, const char *state) {
    window.reset();
    s.contact = s.heartValid = s.spo2Valid = s.valueSeen = false;
    s.windowSamples = 0;
    s.state = state;
  }
  bool readFifoPointers(MeshHealthSnapshot &s, uint8_t *pointers) {
    // Separate addressed reads: do not depend on a multi-register burst for
    // control pointers. FIFO_DATA alone is still read in complete 6-byte samples.
    for (uint8_t i = 0; i < 3; ++i) {
      if (!readRegisters(s, uint8_t(0x04 + i), pointers + i, 1)) return false;
    }
    return true;
  }
  bool pauseAcquisition(MeshHealthSnapshot &s, uint8_t &runningMode) {
    uint8_t mode;
    if (!readRegisters(s, 0x09, &mode, 1)) return false;
    s.modeRegister = mode;
    if ((mode & 0x47) != 3) { fault(s, "config_error"); return false; }
    runningMode = mode & 0x07;
    if (!writeRegister(s, 0x09, uint8_t(runningMode | 0x80))) return false;
    // Worker only: allow an in-flight conversion to settle without blocking
    // the mesh loop or spinning on the bus. SHDN retains configuration.
    vTaskDelay(pdMS_TO_TICKS(10));
    if (!readRegisters(s, 0x09, &mode, 1)) return false;
    s.pausedMode = mode;
    if ((mode & 0xC7) != (runningMode | 0x80)) {
      fault(s, "fifo_reset_failed"); return false;
    }
    return true;
  }
  bool failedReset(MeshHealthSnapshot &s) {
    ++s.fifoResetFailures;
    return false; // Preserve a more specific I2C/config/readback fault.
  }
  bool resetFifo(MeshHealthSnapshot &s, const char *state, bool recovery = false) {
    invalidate(s, state);
    s.sampleSeen = false;
    s.resetWrite = s.resetOverflow = s.resetRead = -1;
    s.pausedMode = s.resumedMode = -1;
    if (recovery && recoveriesWithoutSample >= maxRecoveriesWithoutSample) {
      ++s.recoveryLimitHits;
      uint8_t mode;
      if (!pauseAcquisition(s, mode)) return false;
      fault(s, "fifo_recovery_failed");
      return false; // Worker reconfigures after its existing 2 s backoff.
    }
    if (recovery) ++recoveriesWithoutSample;
    ++s.fifoResets;
    uint8_t mode, pointers[3];
    if (!pauseAcquisition(s, mode)) return failedReset(s);
    if (!writeRegister(s, 0x04, 0) || !writeRegister(s, 0x05, 0) ||
        !writeRegister(s, 0x06, 0)) return failedReset(s);
    if (!readFifoPointers(s, pointers)) return failedReset(s);
    s.resetWrite = pointers[0]; s.resetOverflow = pointers[1]; s.resetRead = pointers[2];
    if ((pointers[0] & 0x1F) || (pointers[1] & 0x1F) || (pointers[2] & 0x1F)) {
      fault(s, "fifo_reset_failed"); return failedReset(s);
    }
    // Never resume after an ACK alone: shutdown AND empty FIFO were read back.
    if (!writeRegister(s, 0x09, mode)) return failedReset(s);
    uint8_t resumed;
    if (!readRegisters(s, 0x09, &resumed, 1)) return failedReset(s);
    s.resumedMode = resumed;
    if ((resumed & 0xC7) != mode) {
      fault(s, "fifo_reset_failed"); return failedReset(s);
    }
    ++s.fifoResetsVerified;
    configuredAt = millis();
    s.state = "warming";
    return true;
  }
  bool configure(MeshHealthSnapshot &s) {
    ++s.configAttempts;
    s.state = "starting";
    s.present = false;
    s.sampleSeen = false;
    s.partId = s.modeRegister = s.configRegister = s.fifoConfigRegister = -1;
    s.statusRegister = s.fifoWrite = s.fifoOverflow = s.fifoRead = -1;
    recoveriesWithoutSample = 0;
    uint8_t id;
    if (!readRegisters(s, 0xFF, &id, 1)) { fault(s, "missing"); return false; }
    s.partId = id;
    // 0x15 is shared with MAX30105: this is not unique model identification.
    if (id != 0x15) { fault(s, "wrong_device"); return false; }
    s.present = true;
    if (!device.begin(bus, I2C_SPEED_FAST, address)) { fault(s, "library_init_error"); return false; }
    device.setup(0x1F, 4, 2, 100, 411, 4096); // RED+IR, 100/4 = 25 Hz.
    device.disableFIFORollover(); // Do not silently overwrite unread samples.
    uint8_t value;
    if (!readRegisters(s, 0x09, &value, 1)) return false;
    s.modeRegister = value;
    if (!readRegisters(s, 0x0A, &value, 1)) return false;
    s.configRegister = value;
    if (!readRegisters(s, 0x08, &value, 1)) return false;
    s.fifoConfigRegister = value;
    if (!readRegisters(s, 0x00, &value, 1)) return false;
    s.statusRegister = value;
    if ((s.modeRegister & 0x87) != 3 || s.configRegister != 0x27 ||
        (s.fifoConfigRegister & 0xF0) != 0x40) { fault(s, "config_error"); return false; }
    s.present = true;
    s.sampleSeen = false;
    configuredAt = millis();
    return resetFifo(s, "warming");
  }
  void ingest(MeshHealthSnapshot &s, uint32_t red, uint32_t ir) {
    recoveriesWithoutSample = 0;
    s.red = red; s.infrared = ir;
    s.lastSampleAt = millis(); s.sampleSeen = true; ++s.samples;
    bool calculate = window.push(red, ir, MESH_MAX_CONTACT_IR_MIN);
    s.contact = window.contact;
    s.windowSamples = window.count;
    if (window.count < MeshHealthWindow::size) {
      s.heartValid = s.spo2Valid = s.valueSeen = false;
      s.state = s.contact ? "warming" : "no_contact";
    }
    if (!calculate) return;
    uint32_t redBuffer[100], irBuffer[100];
    int8_t heartValid = 0, oxygenValid = 0;
    int32_t heart = 0, oxygen = 0;
    bool usable = window.copyForCalculation(redBuffer, irBuffer);
    if (usable) maxim_heart_rate_and_oxygen_saturation(
      irBuffer, 100, redBuffer, &oxygen, &oxygenValid, &heart, &heartValid);
    // Numerical guards are not a clinical "normal range" or a diagnosis.
    s.heartValid = usable && heartValid && heart >= 20 && heart <= 300;
    s.spo2Valid = usable && oxygenValid && oxygen >= 0 && oxygen <= 100;
    s.heartRate = heart; s.spo2 = oxygen;
    s.lastValueAt = millis(); s.valueSeen = s.heartValid || s.spo2Valid;
    s.state = s.valueSeen ? "reading" : "poor_signal";
  }
  bool poll(MeshHealthSnapshot &s) {
    uint8_t pointers[3], status;
    if (!readRegisters(s, 0x00, &status, 1)) return false;
    s.statusRegister = status;
    if (!readFifoPointers(s, pointers)) return false;
    s.fifoWrite = pointers[0]; s.fifoOverflow = pointers[1]; s.fifoRead = pointers[2];
    if (status & 0x20) ++s.ambientOverflows;
    if (pointers[1] & 0x1F) ++s.fifoOverflows;
    if (status & 0x01) { ++s.powerEvents; fault(s, "power_event"); return false; }
    if (!s.sampleSeen && uint32_t(millis() - configuredAt) > 1000) {
      ++s.sampleTimeouts; fault(s, "no_samples"); return false;
    }
    if ((pointers[1] & 0x1F) || (status & 0x20)) {
      const char *reason = (pointers[1] & 0x1F) ? "fifo_overflow" : "ambient_overflow";
      fault(s, reason);
      return resetFifo(s, reason, true);
    }
    unsigned pending = (pointers[0] - pointers[2]) & 0x1F;
    // A gap invalidates the entire window, never just the last displayed value.
    if (s.sampleSeen && uint32_t(millis() - s.lastSampleAt) > 500) {
      ++s.sampleGaps;
      fault(s, "sample_gap");
      if (!resetFifo(s, "sample_gap", true)) return false;
      s.sampleSeen = false;
      configuredAt = millis();
      return true;
    }
    while (pending) {
      unsigned samples = pending > 4 ? 4 : pending;
      uint8_t bytes[24];
      if (!readRegisters(s, 0x07, bytes, samples * 6)) return false;
      for (unsigned i = 0; i < samples; ++i) {
        uint8_t *p = bytes + i * 6;
        uint32_t red = ((uint32_t(p[0]) << 16) | (uint32_t(p[1]) << 8) | p[2]) & 0x3FFFF;
        uint32_t ir = ((uint32_t(p[3]) << 16) | (uint32_t(p[4]) << 8) | p[5]) & 0x3FFFF;
        ingest(s, red, ir);
      }
      pending -= samples;
    }
    return true;
  }
  void run() {
    bool busReady = false, configured = false;
    uint32_t currentEpoch = 0, retryAt = 0;
    MeshHealthSnapshot s;
    for (;;) {
      portENTER_CRITICAL(&gate);
      bool enabled = requested;
      uint32_t epoch = generation;
      portEXIT_CRITICAL(&gate);
      if (epoch != currentEpoch) {
        currentEpoch = epoch;
        if (busReady) {
          uint8_t id;
          if (readRegisters(s, 0xFF, &id, 1) && id == 0x15) writeRegister(s, 0x09, 0x80);
        }
        configured = false;
        s.enabled = enabled;
        s.present = s.sampleSeen = false;
        invalidate(s, enabled ? "starting" : "off");
        retryAt = millis();
      }
      if (!enabled) { publish(s, epoch); vTaskDelay(pdMS_TO_TICKS(50)); continue; }
      if (!busReady) {
        busReady = bus.begin(MESH_MAX_SDA_PIN, MESH_MAX_SCL_PIN, 400000);
        bus.setTimeOut(15);
        if (!busReady) {
          fault(s, "bus_error"); publish(s, epoch);
          vTaskDelay(pdMS_TO_TICKS(1000)); continue;
        }
      }
      if (!configured && int32_t(millis() - retryAt) >= 0) {
        configured = configure(s);
        if (!configured) {
          ++s.configFailures;
          invalidate(s, s.state);
          retryAt = millis() + 2000;
        }
      }
      if (configured && !poll(s)) {
        configured = false;
        // Preserve the actual cause and presence: lack of samples is not a NACK.
        invalidate(s, s.state); retryAt = millis() + 2000;
      }
      publish(s, epoch);
      vTaskDelay(pdMS_TO_TICKS(10));
    }
  }
#endif
};
