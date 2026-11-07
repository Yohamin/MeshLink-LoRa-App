#include "../gps_v4_l76k/gps_diagnostic_core.h"
#include <assert.h>
#include <stdio.h>
#include <string>

static std::string sentence(const std::string &body) {
  unsigned checksum = 0;
  for (char c : body) checksum ^= uint8_t(c);
  char suffix[8];
  snprintf(suffix, sizeof(suffix), "*%02X\r\n", checksum);
  return "$" + body + suffix;
}
static void feed(GpsDiagnosticCounters &s, const std::string &text) {
  for (unsigned char c : text) s.feed(c);
}
int main() {
  GpsDiagnosticCounters s;
  assert(s.bytes == 0 && s.nmeaOk == 0);
  auto rmc = sentence("GNRMC,120000,V,,,,,,,021126,,,N");
  feed(s, rmc);
  assert(s.bytes == rmc.size() && s.nmeaOk == 1 && s.rmc == 1);
  // No-fix NMEA is still proof of UART communication.
  feed(s, sentence("GPGGA,120001,,,,,0,00,,,,,,,"));
  assert(s.nmeaOk == 2 && s.gga == 1);
  feed(s, sentence("GPTXT,01,01,02,antenna"));
  assert(s.nmeaOk == 3 && s.gga == 1 && s.rmc == 1);
  feed(s, "$GNRMC,bad*ZZ\n");
  feed(s, "$GNRMC,bad*00\n");
  assert(s.nmeaOk == 3 && s.rejected == 2);
  feed(s, "$" + std::string(200, 'X') + "\n");
  assert(s.overflows == 1);
  feed(s, std::string(10, '\0'));
  feed(s, sentence("GLRMC,120002,V,,,,,,,021126,,,N"));
  assert(s.nmeaOk == 4 && s.rmc == 2);
  feed(s, sentence("GNRMC,discard") + "$GNRMC,partial");
  feed(s, sentence("GNGGA,120003,,,,,0,00,,,,,,,"));
  assert(s.nmeaOk == 6 && s.gga == 2);
  auto invalid = sentence("GNrmc,invalid");
  feed(s, invalid);
  assert(s.nmeaOk == 6 && s.rejected == 3);
  s = GpsDiagnosticCounters{};
  assert(s.bytes == 0 && s.used == 0 && s.nmeaOk == 0 && s.overflows == 0);
  puts("GPS diagnostic core: checksum, no-fix, noise, overflow, recovery and reset PASS");
}
