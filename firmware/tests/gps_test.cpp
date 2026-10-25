#include "../nmea_gps.h"
#include "../board_profile.h"
#include "../routing_policy.h"
#include <assert.h>
#include <stdio.h>
#include <string>

static void feed(MeshGpsReader &gps, const std::string &body, uint32_t now) {
  unsigned checksum = 0;
  for (char c : body) checksum ^= c;
  char suffix[8];
  snprintf(suffix, sizeof(suffix), "*%02X\r\n", checksum);
  for (char c : "$" + body + suffix) gps.feed(c, now);
}

int main() {
  assert(meshNextHopAllows(true, true, false)); // Final recipient, relay selected.
  assert(meshNextHopAllows(false, true, true)); // Selected relay.
  assert(!meshNextHopAllows(false, true, false)); // Unselected relay.
  assert(meshNextHopAllows(false, false, false)); // No route hint.
  assert(meshAckAllows(true, true, true, false)); // Matching overheard ACK.
  assert(!meshAckAllows(true, false, true, false)); // Wrong sender or no pending ID.
  assert(!meshAckAllows(true, false, false, false));
  assert(meshAckAllows(false, false, true, true)); // Relay forwarding.
  assert(!meshAckAllows(false, false, true, false));
  MeshGpsReader gps;
  assert(!gps.fresh(0));
  feed(gps, "GNGGA,120000,1205.00000,S,07703.00000,W,1,08,1.2,100.0,M,0.0,M,,", 100);
  assert(gps.fresh(100));
  assert(fabs(gps.latitude + 12.083333333) < 1e-8);
  assert(fabs(gps.longitude + 77.05) < 1e-8);
  assert(gps.satellites == 8);
  assert(gps.fresh(10100));
  assert(!gps.fresh(10101));
  feed(gps, "GNRMC,120001,V,,,,,,,061026,,,N", 200);
  assert(!gps.fresh(200));
  feed(gps, "GPRMC,120002,A,0000.00000,N,00000.00000,E,0,0,061026,,,A", 300);
  assert(gps.fresh(300) && gps.latitude == 0 && gps.longitude == 0);
  feed(gps, "GPGGA,120003,,,,,0,00,,,,,,,", 400);
  assert(!gps.fresh(400));
  feed(gps, "GNRMC,120004,A,1261.00000,S,07703.00000,W,0,0,061026,,,A", 500);
  assert(!gps.fresh(500)); // Invalid minutes.
  feed(gps, "GNRMC,120004,A,1205.00000,E,07703.00000,W,0,0,061026,,,A", 500);
  assert(!gps.fresh(500)); // Wrong hemisphere.
  feed(gps, "GNRMC,120004,A,-1205.00000,S,07703.00000,W,0,0,061026,,,A", 500);
  assert(!gps.fresh(500));
  feed(gps, "GNRMC,120004,A,9000.00001,N,18000.00000,E,0,0,061026,,,A", 500);
  assert(!gps.fresh(500));
  unsigned before = gps.badSentences;
  for (char c : std::string("$GPRMC,broken*00\n")) gps.feed(c, 600);
  assert(gps.badSentences == before + 1);
  for (char c : "$" + std::string(200, 'X') + "\n") gps.feed(c, 600);
  feed(gps, "GLRMC,120005,A,1205.00000,S,07703.00000,W,0,0,061026,,,A", 0xFFFFFF00);
  assert(gps.fresh(0x10)); // millis() wrap-around.
  assert(!gps.fresh(11000));
  gps.clearFix();
  assert(!gps.hasPosition && !gps.fresh(12000));
#if MESH_BOARD_PROFILE == 3
  static_assert(MESH_HAS_GPS == 0 && VEXT_PIN == 36 && MAX_NODES == 10, "V3 unchanged");
#elif MESH_BOARD_PROFILE == 48
  static_assert(VEXT_PIN == 40 && MESH_GPS_POWER_PIN == 42 && MESH_GPS_WAKE_PIN == -1, "R8 pins");
#else
  static_assert(VEXT_PIN == 36 && MESH_GPS_POWER_PIN == 34 && MESH_GPS_WAKE_PIN == 40, "R2 pins");
#endif
  printf("GPS, routing and board profile %d: PASS\n", MESH_BOARD_PROFILE);
}
