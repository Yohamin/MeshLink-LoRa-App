#pragma once
#include <assert.h>
#include <stdint.h>
#include <vector>
constexpr int LOW = 0, HIGH = 1;
constexpr int INPUT = 1, OUTPUT = 2, INPUT_PULLUP = 5, OUTPUT_OPEN_DRAIN = 18;
struct MeshGpioEvent { int pin; bool isMode; int value; };
inline std::vector<MeshGpioEvent> meshGpioEvents;
inline int meshPinModes[49] = {}, meshPinLevels[49] = {};
inline void pinMode(int pin, int mode) {
  meshPinModes[pin] = mode;
  meshGpioEvents.push_back({pin, true, mode});
}
inline void digitalWrite(int pin, int value) {
  assert(meshPinModes[pin] != 0);
  meshPinLevels[pin] = value;
  meshGpioEvents.push_back({pin, false, value});
}
