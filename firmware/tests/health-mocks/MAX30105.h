#pragma once
// Host-only deterministic bus. Never included by an Arduino firmware build.
#include <stdint.h>
#include <vector>
#include <algorithm>
inline uint32_t mockNow = 0;
inline uint32_t millis() { return mockNow; }
constexpr uint32_t I2C_SPEED_FAST = 400000;
class TwoWire {
 public:
  uint8_t registers[256] = {};
  std::vector<uint8_t> tx, rx, fifo;
  unsigned at = 0;
  uint8_t selected = 0;
  int failRegister = -1, failCode = 2, shortRegister = -1;
  bool failWritesOnly = false, badConfig = false;
  int ignoreWriteRegister = -1;
  bool ignoreShutdown = false, ignoreResume = false, clearNeedsPause = true;
  bool corruptPointerBurst = true;
  unsigned pointerBurstReads = 0;
  std::vector<uint8_t> pointerWriteModes;
  explicit TwoWire(int) { registers[0xFF] = 0x15; }
  bool begin(int, int, uint32_t) { return true; }
  void setTimeOut(int) {}
  void beginTransmission(uint8_t) { tx.clear(); }
  void write(uint8_t byte) { tx.push_back(byte); }
  int endTransmission(bool = true) {
    selected = tx[0];
    if (selected == failRegister && (!failWritesOnly || tx.size() > 1)) return failCode;
    if (tx.size() > 1) {
      if (selected >= 4 && selected <= 6) pointerWriteModes.push_back(registers[9]);
      if (selected == ignoreWriteRegister) return 0; // ACK is not readback.
      if (selected >= 4 && selected <= 6 && clearNeedsPause && !(registers[9] & 0x80)) return 0;
      if (selected == 9 && ((ignoreShutdown && (tx[1] & 0x80)) ||
          (ignoreResume && !(tx[1] & 0x80)))) return 0;
      registers[selected] = tx[1];
    }
    return 0;
  }
  unsigned requestFrom(uint8_t, uint8_t length) {
    rx.clear(); at = 0;
    unsigned got = selected == shortRegister ? length - 1 : length;
    if (selected == 4 && length > 1) ++pointerBurstReads;
    for (unsigned i = 0; i < got; ++i) {
      if (selected == 4 && length == 3 && corruptPointerBurst) {
        // Deliberately unreliable burst-control read; individual reads are valid.
        rx.push_back(i == 1 ? 25 : 0);
      } else {
        rx.push_back(selected == 0x07 ? (fifo.empty() ? 0 : fifo[i % fifo.size()]) : registers[selected + i]);
      }
    }
    if (selected == 0) registers[0] = 0; // Interrupt status is clear-on-read.
    if (selected == 7) {
      registers[6] = (registers[6] + got / 6) & 31;
      if (got >= 6) registers[5] = 0;
    }
    return got;
  }
  int available() { return static_cast<int>(rx.size() - at); }
  uint8_t read() { return rx[at++]; }
};
class MAX30105 {
 public:
  TwoWire *bus = nullptr;
  bool begin(TwoWire &wire, uint32_t, uint8_t) { bus = &wire; return true; }
  void setup(int, int, int, int, int, int) {
    bus->registers[9] = 3;
    bus->registers[10] = bus->badConfig ? 0 : 0x27;
    bus->registers[8] = 0x5F; // Real capture had 0x4F after rollover was disabled.
  }
  void disableFIFORollover() { bus->registers[8] &= ~0x10; }
};
