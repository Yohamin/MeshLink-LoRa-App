#pragma once
#include "board_profile.h"

#if MESH_BOARD_PROFILE == 43
#include <Arduino.h>

// Reproduce the GPS-DIAG r2 startup without blocking the mesh/BLE/MAX loop.
// Only the physically tested V4.3/4.3.1 kit uses this sequence.
class MeshGpsPowerSequencer {
 public:
  enum class Phase { Off, PowerOff, Stabilizing, ResetLow, Settling, Ready };

  void setEnabled(bool enabled, uint32_t now) {
    // Remove weak bias before turning receiver power off; never push-pull HIGH.
    pinMode(MESH_GPS_RESET_PIN, INPUT);
    pinMode(MESH_GPS_WAKE_PIN, INPUT);
    pinMode(MESH_GPS_POWER_PIN, OUTPUT);
    digitalWrite(MESH_GPS_POWER_PIN, HIGH);
    phase_ = enabled ? Phase::PowerOff : Phase::Off;
    since_ = now;
  }

  bool poll(uint32_t now) {
    const uint32_t elapsed = uint32_t(now - since_);
    switch (phase_) {
      case Phase::PowerOff:
        if (elapsed >= 600) {
          digitalWrite(MESH_GPS_POWER_PIN, LOW);
          advance(Phase::Stabilizing, now);
        }
        break;
      case Phase::Stabilizing:
        if (elapsed >= 1000) {
          pinMode(MESH_GPS_WAKE_PIN, INPUT_PULLUP);
          digitalWrite(MESH_GPS_RESET_PIN, LOW);
          pinMode(MESH_GPS_RESET_PIN, OUTPUT_OPEN_DRAIN);
          advance(Phase::ResetLow, now);
        }
        break;
      case Phase::ResetLow:
        if (elapsed >= 250) {
          pinMode(MESH_GPS_RESET_PIN, INPUT_PULLUP);
          advance(Phase::Settling, now);
        }
        break;
      case Phase::Settling:
        if (elapsed >= 1200) advance(Phase::Ready, now);
        break;
      default: break;
    }
    return phase_ == Phase::Ready;
  }

  Phase phase() const { return phase_; }

 private:
  Phase phase_ = Phase::Off;
  uint32_t since_ = 0;
  void advance(Phase phase, uint32_t now) { phase_ = phase; since_ = now; }
};
#endif
