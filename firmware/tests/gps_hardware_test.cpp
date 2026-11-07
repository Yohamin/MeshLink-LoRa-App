#include "../gps_hardware.h"
#include <stdio.h>
using Phase = MeshGpsPowerSequencer::Phase;

int main() {
  MeshGpsPowerSequencer hw;
  assert(hw.phase() == Phase::Off && !hw.poll(0));
  hw.setEnabled(true, 100);
  assert(hw.phase() == Phase::PowerOff && meshPinLevels[34] == HIGH);
  assert(meshPinModes[40] == INPUT && meshPinModes[42] == INPUT);
  assert(!hw.poll(699) && meshPinLevels[34] == HIGH);
  assert(!hw.poll(700) && meshPinLevels[34] == LOW);
  assert(hw.phase() == Phase::Stabilizing);
  assert(!hw.poll(1699) && meshPinModes[40] == INPUT);
  assert(!hw.poll(1700) && hw.phase() == Phase::ResetLow);
  assert(meshPinModes[40] == INPUT_PULLUP);
  assert(meshPinModes[42] == OUTPUT_OPEN_DRAIN && meshPinLevels[42] == LOW);
  assert(!hw.poll(1949) && hw.phase() == Phase::ResetLow);
  assert(!hw.poll(1950) && hw.phase() == Phase::Settling);
  assert(meshPinModes[42] == INPUT_PULLUP);
  assert(!hw.poll(3149));
  assert(hw.poll(3150) && hw.poll(4000) && hw.phase() == Phase::Ready);
  // Turning off while ready removes bias and cannot leave startup pending.
  hw.setEnabled(false, 4001);
  assert(hw.phase() == Phase::Off && !hw.poll(9000));
  assert(meshPinLevels[34] == HIGH && meshPinModes[40] == INPUT && meshPinModes[42] == INPUT);
  // Cancel/restart in every stage; no stale stage may power the receiver back on.
  for (unsigned target = 0; target < 4; ++target) {
    uint32_t at = 10000;
    hw.setEnabled(true, at);
    const uint32_t waits[] = {600, 1000, 250};
    for (unsigned step = 0; step < target; ++step) { at += waits[step]; hw.poll(at); }
    hw.setEnabled(false, at + 1);
    assert(!hw.poll(at + 100000) && hw.phase() == Phase::Off);
    assert(meshPinModes[40] == INPUT && meshPinModes[42] == INPUT && meshPinLevels[34] == HIGH);
  }
  // A delayed loop does not skip reset/stabilization guards.
  hw.setEnabled(true, 100);
  assert(!hw.poll(100000) && hw.phase() == Phase::Stabilizing);
  assert(!hw.poll(100001) && hw.phase() == Phase::Stabilizing);
  // millis() overflow remains safe.
  const uint32_t wrapStart = 0xFFFFFF00u;
  hw.setEnabled(true, wrapStart);
  assert(!hw.poll(wrapStart + 599u));
  assert(!hw.poll(wrapStart + 600u));
  assert(!hw.poll(wrapStart + 1600u));
  assert(!hw.poll(wrapStart + 1850u));
  assert(hw.poll(wrapStart + 3050u));
  for (const auto &e : meshGpioEvents) {
    if (e.pin != 40 && e.pin != 42) continue;
    if (e.isMode) assert(e.value != OUTPUT);
    else assert(e.value == LOW && e.pin == 42);
  }
  static_assert(MESH_GPS_RX_PIN == 39 && MESH_GPS_TX_PIN == -1, "Listen-only RX39");
  puts("GPS V4.3 startup: weak pulls, reset guards, no blocking, off/cancel/restart and wrap PASS");
}
