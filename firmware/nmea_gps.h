#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

// Bounded, allocation-free reader for checksum-protected NMEA RMC and GGA.
// Any talker (GP/GN/GL/...) is accepted; no receiver-specific commands needed.
class MeshGpsReader {
 public:
  bool hasFix = false;
  bool hasPosition = false;
  double latitude = 0;
  double longitude = 0;
  unsigned satellites = 0;
  uint32_t lastFixAt = 0;
  uint32_t validSentences = 0;
  uint32_t badSentences = 0;
  uint32_t bytesReceived = 0;

  bool fresh(uint32_t now) const {
    return hasFix && hasPosition && uint32_t(now - lastFixAt) <= 10000;
  }
  void clearFix() {
    hasFix = false;
    hasPosition = false;
    satellites = 0;
    used = 0;
  }
  void feed(char c, uint32_t now) {
    ++bytesReceived;
    if (c == '$') { used = 0; line[used++] = c; return; }
    if (!used || c == '\r') return;
    if (c == '\n') {
      line[used] = 0;
      parse(now);
      used = 0;
    } else if (used + 1 < sizeof(line)) {
      line[used++] = c;
    } else {
      ++badSentences;
      used = 0; // Discard overflow until a new '$'.
    }
  }

 private:
  char line[160] = {};
  unsigned used = 0;

  static int hex(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
  }
  static bool coordinate(const char *value, const char *hemisphere,
                         bool isLatitude, double &result) {
    if (!*value || strlen(hemisphere) != 1) return false;
    unsigned digits = 0;
    for (const char *p = value; *p; ++p) {
      if (*p == '.' && digits == (isLatitude ? 4u : 5u)) {
        for (++p; *p; ++p) if (*p < '0' || *p > '9') return false;
        break;
      }
      if (*p < '0' || *p > '9') return false;
      ++digits;
    }
    if (digits != (isLatitude ? 4u : 5u)) return false;
    const char h = *hemisphere;
    if (isLatitude ? (h != 'N' && h != 'S') : (h != 'E' && h != 'W')) return false;
    char *end = nullptr;
    double raw = strtod(value, &end);
    if (*end || !isfinite(raw) || raw < 0) return false;
    unsigned degrees = unsigned(raw / 100);
    double minutes = raw - degrees * 100;
    unsigned limit = isLatitude ? 90 : 180;
    if (minutes >= 60 || degrees > limit || (degrees == limit && minutes != 0)) return false;
    result = degrees + minutes / 60;
    if (h == 'S' || h == 'W') result = -result;
    return true;
  }
  void parse(uint32_t now) {
    char *star = strchr(line, '*');
    if (!star || strlen(star) != 3 || hex(star[1]) < 0 || hex(star[2]) < 0) {
      ++badSentences; return;
    }
    unsigned checksum = 0;
    for (char *p = line + 1; p < star; ++p) checksum ^= unsigned(char(*p));
    if (checksum != unsigned((hex(star[1]) << 4) | hex(star[2]))) {
      ++badSentences; return;
    }
    ++validSentences;
    *star = 0;
    char *fields[20] = {};
    unsigned count = 1;
    fields[0] = line + 1;
    for (char *p = line + 1; *p && count < 20; ++p) {
      if (*p == ',') { *p = 0; fields[count++] = p + 1; }
    }
    if (strlen(fields[0]) != 5) return;
    bool rmc = strcmp(fields[0] + 2, "RMC") == 0;
    bool gga = strcmp(fields[0] + 2, "GGA") == 0;
    if ((!rmc && !gga) || count < (rmc ? 7u : 9u)) return;
    bool active = rmc ? strcmp(fields[2], "A") == 0
                      : (strlen(fields[6]) == 1 && fields[6][0] >= '1' && fields[6][0] <= '8');
    if (rmc && count > 12 && strcmp(fields[12], "N") == 0) active = false;
    if (gga) {
      char *end = nullptr;
      unsigned long n = strtoul(fields[7], &end, 10);
      satellites = *fields[7] && !*end && n <= 99 ? unsigned(n) : 0;
    }
    if (!active) { hasFix = false; return; }
    double lat, lon;
    unsigned start = rmc ? 3 : 2;
    if (!coordinate(fields[start], fields[start + 1], true, lat) ||
        !coordinate(fields[start + 2], fields[start + 3], false, lon)) {
      ++badSentences;
      hasFix = false;
      return;
    }
    latitude = lat;
    longitude = lon;
    hasPosition = hasFix = true;
    lastFixAt = now;
  }
};
