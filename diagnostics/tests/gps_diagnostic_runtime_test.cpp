// Exercise the actual sketch with simulated GPIO/UART, not just its NMEA parser.
#define CONFIG_IDF_TARGET_ESP32S3 1
#define ARDUINO_HELTEC_WIFI_LORA_32_V4 1
#include "../gps_v4_l76k/gps_v4_l76k.ino"

static void command(const char *s) { Serial.input = s; loop(); }
static void assertReleased() {
  assert(gpioModes[40] == INPUT_PULLUP && gpioModes[42] == INPUT_PULLUP);
  assert(gpioModes[34] == OUTPUT && gpioLevels[34] == LOW);
}
int main() {
  setup();
  assert(measurementOnly && !uartStarted && gpsUart.starts == 0);
  assertReleased();
  assert(Serial.output.find("GPS-DIAG r2") != std::string::npos);
  assert(Serial.output.find("power34=0 wake40=1 reset42=1 test=measurement") != std::string::npos);
  // A real low is reported as low even with a requested pull-up, not as success.
  externallyLow[40] = externallyLow[42] = true;
  command("?");
  assert(Serial.output.find("wake40=0 reset42=0") != std::string::npos);
  externallyLow[40] = externallyLow[42] = false;
  command("r\n");
  assert(!measurementOnly && uartStarted && mode == 0);
  assert(gpsUart.rx == 38 && gpsUart.tx == -1 && gpsUart.baud == 9600);
  assertReleased();
  for (unsigned step = 0; step < MODE_COUNT; ++step) {
    assert(mode == step && gpsUart.tx == -1);
    assert(gpsUart.rx == RX_PINS[step / RATE_COUNT]);
    assert(gpsUart.baud == BAUDS[step % RATE_COUNT]);
    fakeTime += MODE_MS + 1;
    loop();
  }
  assert(finished && !uartStarted && !gpsUart.started);
  assert(Serial.output.find("[NO_NMEA]") != std::string::npos);
  assertReleased();
  command("r");
  const uint32_t beforeHold = fakeTime;
  command("m");
  assert(measurementOnly && !uartStarted && !gpsUart.started);
  assert(fakeTime - beforeHold < 10);  // No hidden reset or power-cycle on m.
  assertReleased();
  command("r");
  assert(!finished && !measurementOnly && mode == 0 && counters.bytes == 0);
  // Three valid sentences must still select and monitor the listening mode.
  // Generate checksums so the fixture itself cannot hide a codec regression.
  const std::string body = "GNRMC,120000,V,,,,,,,021126,,,N";
  unsigned sum = 0;
  for (unsigned char c : body) sum ^= c;
  char suffix[8];
  snprintf(suffix, sizeof(suffix), "*%02X\r\n", sum);
  const std::string frame = "$" + body + suffix;
  gpsUart.incoming = frame + frame + frame;
  fakeTime += MODE_MS + 1;
  loop();
  assert(monitoring && !finished && counters.nmeaOk == 3);
  command("m");
  assert(measurementOnly && !monitoring && !uartStarted);

  bool powered = false, resetLow = false;
  uint32_t resetAt = 0;
  int mode40 = INPUT, mode42 = INPUT;
  unsigned resetPulses = 0;
  for (const auto &e : gpioEvents) {
    if (!e.isMode && e.pin == GPS_POWER) {
      powered = e.value == LOW;
      if (!powered) assert(mode40 == INPUT && mode42 == INPUT);
    }
    if (e.pin != GPS_WAKE && e.pin != GPS_RESET) continue;
    if (!e.isMode) { assert(e.value != HIGH); continue; }
    assert(e.value != OUTPUT);  // Never push-pull either receiver control.
    if (e.value == INPUT_PULLUP) assert(powered);
    if (e.pin == GPS_WAKE) {
      mode40 = e.value;
      assert(e.value == INPUT || e.value == INPUT_PULLUP);
    } else {
      mode42 = e.value;
      if (e.value == OUTPUT_OPEN_DRAIN) {
        assert(powered); resetLow = true; resetAt = e.at;
      } else if (resetLow) {
        assert(e.value == INPUT_PULLUP && e.at - resetAt == 250);
        resetLow = false; ++resetPulses;
      }
    }
  }
  assert(resetPulses == 4 && !resetLow);
  puts("GPS-DIAG r2 runtime: weak pulls, reset timing, measurement, UART scan, NMEA and stop/restart PASS");
}
