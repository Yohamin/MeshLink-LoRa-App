#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// Counts UART traffic without logging coordinates or accepting unchecked NMEA.
struct GpsDiagnosticCounters {
  uint32_t bytes = 0, printable = 0, starts = 0;
  uint32_t nmeaOk = 0, rejected = 0, overflows = 0, rmc = 0, gga = 0;
  char line[160] = {};
  size_t used = 0;

  static int hex(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
  }
  void complete() {
    line[used] = 0;
    const char *star = strchr(line, '*');
    if (used < 10 || line[6] != ',' || !star || strlen(star) != 3 ||
        hex(star[1]) < 0 || hex(star[2]) < 0) { ++rejected; return; }
    for (size_t i = 1; i <= 5; ++i) {
      if (line[i] < 'A' || line[i] > 'Z') { ++rejected; return; }
    }
    unsigned sum = 0;
    for (const char *p = line + 1; p < star; ++p) sum ^= uint8_t(*p);
    if (sum != unsigned((hex(star[1]) << 4) | hex(star[2]))) { ++rejected; return; }
    ++nmeaOk;
    if (!memcmp(line + 3, "RMC", 3)) ++rmc;
    if (!memcmp(line + 3, "GGA", 3)) ++gga;
  }
  void feed(uint8_t c) {
    ++bytes;
    if (c >= 32 && c <= 126) ++printable;
    if (c == '$') { ++starts; used = 0; line[used++] = '$'; return; }
    if (!used || c == '\r') return;
    if (c == '\n') { complete(); used = 0; return; }
    if (c < 32 || c > 126) { ++rejected; used = 0; return; }
    if (used + 1 < sizeof(line)) line[used++] = char(c);
    else { ++overflows; used = 0; }
  }
};
