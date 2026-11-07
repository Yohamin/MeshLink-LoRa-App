#include <Arduino.h>
#include <HardwareSerial.h>
#include "gps_diagnostic_core.h"

#if !defined(CONFIG_IDF_TARGET_ESP32S3)
#error "Diagnostico exclusivo para ESP32-S3 Heltec WiFi LoRa 32 V4.3/4.3.1."
#endif
#if !defined(ARDUINO_HELTEC_WIFI_LORA_32_V4) && !defined(HELTEC_WIFI_LORA_32_V4)
#error "Selecciona WiFi LoRa 32 (V4) del core Heltec; no V3, V4-R8 ni ESP32 generico."
#endif

// Bare V4.3 / V4.3.1, NOT V3, V4-R8 or a TFT expansion-board profile.
constexpr int GPS_POWER = 34;  // Active LOW.
constexpr int GPS_RESET = 42;  // Active LOW; weak pull-up when released.
constexpr int GPS_WAKE = 40;   // LOW = standby; weak pull-up to request awake.
constexpr int RADIO_RESET = 12, FEM_POWER = 7, FEM_ENABLE = 2;
constexpr int RX_PINS[] = {38, 39};
constexpr uint32_t BAUDS[] = {9600, 19200, 38400, 57600, 115200};
constexpr unsigned RATE_COUNT = sizeof(BAUDS) / sizeof(BAUDS[0]);
constexpr unsigned MODE_COUNT = 2 * RATE_COUNT;
constexpr uint32_t MODE_MS = 8000;

HardwareSerial gpsUart(1);
GpsDiagnosticCounters counters;
struct ModeResult { bool driver = false; uint32_t bytes = 0, nmea = 0, rejected = 0; };
ModeResult results[MODE_COUNT];
unsigned mode = 0;
uint32_t modeStarted = 0, lastPrint = 0;
bool monitoring = false, finished = false, uartStarted = false, measurementOnly = true;
uint32_t lastControlPrint = 0;

void outputLevel(int pin, int level) {
  pinMode(pin, OUTPUT);
  // Heltec core 3.x ignores digitalWrite until the pin is registered as GPIO.
  digitalWrite(pin, level);
}
void releaseControl(int pin, bool pullup = true) {
  // Input only: never force a push-pull HIGH against an unknown external load.
  pinMode(pin, pullup ? INPUT_PULLUP : INPUT);
}
void keepRadioOff() {
  outputLevel(RADIO_RESET, LOW);
  outputLevel(FEM_ENABLE, LOW);
  outputLevel(FEM_POWER, LOW);
}
int selectedRx() { return RX_PINS[mode / RATE_COUNT]; }
uint32_t selectedBaud() { return BAUDS[mode % RATE_COUNT]; }

void printControls() {
  Serial.printf("[CTRL r2] mode=INPUT_PULLUP power34=%d wake40=%d reset42=%d test=%s\n",
    digitalRead(GPS_POWER), digitalRead(GPS_WAKE), digitalRead(GPS_RESET),
    measurementOnly ? "measurement" : (finished ? "finished" : "uart"));
  Serial.println("[CTRL] Lecturas digitales, NO voltajes ni prueba de continuidad. Medir con multimetro.");
  lastControlPrint = millis();
}

void printCounters(const char *label) {
  Serial.printf("[%s] rx=%d baud=%lu bytes=%lu ascii=%lu starts=%lu nmea_ok=%lu bad=%lu overflow=%lu rmc=%lu gga=%lu\n",
    label, selectedRx(), (unsigned long)selectedBaud(), (unsigned long)counters.bytes,
    (unsigned long)counters.printable, (unsigned long)counters.starts, (unsigned long)counters.nmeaOk,
    (unsigned long)counters.rejected, (unsigned long)counters.overflows,
    (unsigned long)counters.rmc, (unsigned long)counters.gga);
}
void remember() {
  results[mode].bytes = counters.bytes;
  results[mode].nmea = counters.nmeaOk;
  results[mode].rejected = counters.rejected;
}
void summary() {
  Serial.println("----- RESUMEN GPS-DIAG r2 -----");
  if (measurementOnly) {
    printControls();
    Serial.println("Modo medicion: barrido UART detenido. Enviar r para iniciar una prueba nueva.");
    return;
  }
  for (unsigned i = 0; i <= mode && i < MODE_COUNT; ++i) {
    Serial.printf("[RESULT] rx=%d baud=%lu uart=%d bytes=%lu nmea_ok=%lu bad=%lu\n",
      RX_PINS[i / RATE_COUNT], (unsigned long)BAUDS[i % RATE_COUNT], results[i].driver,
      (unsigned long)results[i].bytes, (unsigned long)results[i].nmea,
      (unsigned long)results[i].rejected);
  }
  Serial.println("GPIO y orden de encendido NO son una medicion de voltaje.");
  Serial.println("r: ciclo de alimentacion/reset y barrido. m: mantener para medir. ?: resumen.");
}
void beginMode() {
  if (uartStarted) gpsUart.end();
  uartStarted = false;
  // Both lines stay INPUT. No UART TX is attached, including on the alternate RX test.
  pinMode(38, INPUT);
  pinMode(39, INPUT);
  counters = GpsDiagnosticCounters{};
  gpsUart.setRxBufferSize(2048);
  gpsUart.begin(selectedBaud(), SERIAL_8N1, selectedRx(), -1);
  results[mode].driver = bool(gpsUart);
  uartStarted = results[mode].driver;
  modeStarted = lastPrint = millis();
  Serial.printf("[SCAN %u/%u] rx=%d tx=disabled baud=%lu uart=%d duration=8s\n",
    mode + 1, MODE_COUNT, selectedRx(), (unsigned long)selectedBaud(), uartStarted);
}
void restartTest(bool measureOnly = false) {
  if (uartStarted) gpsUart.end();
  uartStarted = false;
  pinMode(38, INPUT);
  pinMode(39, INPUT);
  // Do not weakly feed an unpowered receiver through its control inputs.
  releaseControl(GPS_RESET, false);
  releaseControl(GPS_WAKE, false);
  outputLevel(GPS_POWER, HIGH);
  Serial.println("[POWER] orden GPS_OFF 600ms; no verifica voltaje real.");
  delay(600);
  outputLevel(GPS_POWER, LOW);
  Serial.println("[POWER] orden GPS_ON; estabilizacion 1000ms.");
  delay(1000);
  releaseControl(GPS_WAKE);
  digitalWrite(GPS_RESET, LOW);
  pinMode(GPS_RESET, OUTPUT_OPEN_DRAIN);
  delay(250);
  releaseControl(GPS_RESET);
  Serial.println("[RESET] pulso LOW 250ms; libera con INPUT_PULLUP y espera 1200ms.");
  delay(1200);
  for (unsigned i = 0; i < MODE_COUNT; ++i) results[i] = ModeResult{};
  mode = 0;
  monitoring = finished = false;
  measurementOnly = measureOnly;
  printControls();
  if (measurementOnly) {
    Serial.println("[MEASURE] GPS ordenado ON; UART detenida. Medir GPIO34/40/42 respecto a GND.");
    Serial.println("[MEASURE] r inicia el barrido. Cortar USB Y bateria antes de conectar/desconectar GPS.");
    return;
  }
  beginMode();
}
void holdForMeasurement() {
  if (!measurementOnly && !finished) remember();
  if (uartStarted) gpsUart.end();
  uartStarted = false;
  pinMode(38, INPUT);
  pinMode(39, INPUT);
  measurementOnly = true;
  monitoring = false;
  finished = false;
  // Leave power and control configuration unchanged; no new reset/power cycle.
  printControls();
  Serial.println("[MEASURE] UART detenida; alimentacion y pull-ups mantenidos. r inicia una prueba nueva.");
}
void setup() {
  keepRadioOff();
  // No LoRa, BLE, OLED, MAX30102, Preferences or receiver configuration commands.
  Serial.begin(115200);
  const uint32_t started = millis();
  while (!Serial && uint32_t(millis() - started) < 4000) delay(10);
  delay(500);
  Serial.println("\nGPS-DIAG r2 | Heltec V4.3/4.3.1 + Quectel L76K");
  Serial.println("MeshLink esta sustituido temporalmente. Radio apagado. Sin coordenadas en logs.");
  Serial.println("Barrido RX38/RX39 solo escucha; no intercambiar cables.");
  Serial.println("r2: RESET/WAKE con pull-up interno debil; nunca salida HIGH fuerte. Arranca en modo medicion.");
  restartTest(true);
}
void loop() {
  while (Serial.available()) {
    const char command = char(Serial.read());
    if (command == 'r' || command == 'R') restartTest();
    else if (command == 'm' || command == 'M') holdForMeasurement();
    else if (command == '?') { if (!finished && !measurementOnly) remember(); summary(); }
  }
  if (uint32_t(millis() - lastControlPrint) >= 2000) printControls();
  if (measurementOnly || finished) { delay(5); return; }
  unsigned budget = 512;
  while (uartStarted && budget-- && gpsUart.available()) counters.feed(uint8_t(gpsUart.read()));
  const uint32_t now = millis();
  if (uint32_t(now - lastPrint) >= 2000) {
    lastPrint = now;
    printCounters(monitoring ? "MONITOR" : "GPS-DIAG");
  }
  if (!monitoring && uint32_t(now - modeStarted) >= MODE_MS) {
    remember();
    printCounters("END_MODE");
    if (counters.nmeaOk >= 3) {
      monitoring = true;
      Serial.println("[FOUND] NMEA con checksum valido. UART comunica; esto NO confirma posicion.");
      summary();
    } else if (mode + 1 < MODE_COUNT) {
      ++mode;
      beginMode();
    } else {
      if (uartStarted) gpsUart.end();
      uartStarted = false;
      pinMode(38, INPUT);
      pinMode(39, INPUT);
      finished = true;
      summary();
      Serial.println("[NO_NMEA] No se detecto NMEA valido en el barrido.");
      Serial.println("No demuestra dos GPS averiados: revisar alimentacion, cableado y placa.");
    }
  }
  delay(1);
}
