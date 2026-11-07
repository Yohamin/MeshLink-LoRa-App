#pragma once
#include "Arduino.h"
struct HardwareSerial {
  bool started = false;
  unsigned starts = 0, ends = 0;
  int rx = -1, tx = -1;
  uint32_t baud = 0;
  std::string incoming;
  explicit HardwareSerial(int) {}
  void setRxBufferSize(unsigned) {}
  void begin(uint32_t rate, int, int receive, int transmit) {
    started = true; ++starts; baud = rate; rx = receive; tx = transmit;
  }
  void end() { started = false; ++ends; incoming.clear(); }
  explicit operator bool() const { return started; }
  int available() const { return started ? int(incoming.size()) : 0; }
  int read() { unsigned char c = incoming.front(); incoming.erase(0, 1); return c; }
};
