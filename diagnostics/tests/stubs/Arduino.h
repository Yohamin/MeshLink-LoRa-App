#pragma once
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string>
#include <vector>

constexpr int LOW = 0, HIGH = 1;
constexpr int INPUT = 1, OUTPUT = 2, INPUT_PULLUP = 5, OUTPUT_OPEN_DRAIN = 18;
constexpr int SERIAL_8N1 = 0;
struct GpioEvent { uint32_t at; int pin; bool isMode; int value; };
inline std::vector<GpioEvent> gpioEvents;
inline uint32_t fakeTime = 0;
inline int gpioModes[49] = {}, gpioLevels[49] = {};
inline bool externallyLow[49] = {};
inline uint32_t millis() { return fakeTime; }
inline void delay(uint32_t ms) { fakeTime += ms; }
inline void digitalWrite(int pin, int value) {
  assert(gpioModes[pin] != 0);  // Model core 3.x: configure GPIO before writing.
  gpioLevels[pin] = value;
  gpioEvents.push_back({fakeTime, pin, false, value});
}
inline void pinMode(int pin, int mode) {
  gpioModes[pin] = mode;
  gpioEvents.push_back({fakeTime, pin, true, mode});
}
inline int digitalRead(int pin) {
  if (externallyLow[pin]) return LOW;
  return gpioModes[pin] == INPUT_PULLUP ? HIGH : gpioLevels[pin];
}
struct FakeSerial {
  std::string output, input;
  void begin(uint32_t) {}
  explicit operator bool() const { return true; }
  int available() const { return int(input.size()); }
  int read() { char c = input.front(); input.erase(0, 1); return c; }
  void println(const char *s) { output += std::string(s) + "\n"; }
  template<typename... Args> void printf(const char *format, Args... args) {
    char buffer[1024];
    const int n = snprintf(buffer, sizeof(buffer), format, args...);
    assert(n >= 0 && size_t(n) < sizeof(buffer));
    output += buffer;
  }
};
inline FakeSerial Serial;
