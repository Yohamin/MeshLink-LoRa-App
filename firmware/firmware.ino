#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "board_profile.h"
#include "nmea_gps.h"
#include "routing_policy.h"
#include "max30102_sensor.h"

// =====================================================
// LoRa Mesh - Capa 5.1
// Heltec WiFi LoRa 32 V3 / V4 + RadioLib (wire protocol 5.1)
//
// Incluye:
// - OLED funcional con Software I2C
// - RadioLib sin Mcu.begin y sin licencia Heltec
// - nodeId automatico por chip
// - nodeName editable y persistente
// - deteccion de nodos por announce
// - envio broadcast
// - envio directo
// - ACK para mensajes directos
// - PDR ACK y latencia basica
// - estabilidad de canal: jitter, guardas anti-colision y filtros de paquetes corruptos
// - paquetes JSON compactos para no superar el limite LoRa
// - comandos por Monitor Serial
// - integracion BLE/App: comandos JSON por BLE y notificaciones a la app
// - multihop automatico para mensajes dirigidos
// - reset de metricas y mejoras anti-desconexion falsa
// - payload cifrado opaco: la app cifra/descifra y el ESP32 solo transporta
// =====================================================

// =====================
// OLED Heltec WiFi LoRa 32 V3
// =====================
#define OLED_SDA 17
#define OLED_SCL 18
#define OLED_RST 21

U8G2_SSD1306_128X64_NONAME_F_SW_I2C oled(
  U8G2_R0,
  OLED_SCL,
  OLED_SDA,
  OLED_RST
);

// =====================
// Pines LoRa Heltec WiFi LoRa 32 V3
// =====================
#define LORA_NSS   8
#define LORA_DIO1  14
#define LORA_RST   12
#define LORA_BUSY  13

#define LORA_SCK   9
#define LORA_MISO  11
#define LORA_MOSI  10

SX1262 radio = new Module(LORA_NSS, LORA_DIO1, LORA_RST, LORA_BUSY);

// =====================
// Configuracion LoRa
// =====================
#define LORA_FREQ      915.0
#define LORA_BW        125.0
#define LORA_SF        7
#define LORA_CR        5
#define LORA_SYNC_WORD 0x12
#define LORA_POWER     MESH_RADIO_DRIVE_DBM
#define LORA_PREAMBLE  8

// =====================
// Limites
// =====================
#define EXPECTED_NODES 2
#define NODE_TIMEOUT_MS 90000

#define MAX_TEXT_BYTES 40
#define MAX_PACKET_BYTES 240
#define MAX_BLE_COMMAND_BYTES 768

#define DEFAULT_TTL 3
#define ACK_TIMEOUT_MS 8000

// Evitan colisiones entre announce, mensajes y ACK.
#define ANNOUNCE_BASE_INTERVAL_MS 15000
#define ANNOUNCE_JITTER_MS 8000
#define TX_GUARD_AFTER_MESSAGE_MS 5000
#define RX_GUARD_BEFORE_ANNOUNCE_MS 2000
#define FORWARD_DELAY_MIN_MS 80
#define FORWARD_DELAY_JITTER_MS 220

// En Capa 5.1 el comando send usa enrutamiento automatico.
// Si existe un relay disponible, el firmware lo selecciona sin que la app lo indique.
#define AUTO_ROUTE_PREFER_RELAY true
#define ACTIVE_NODE_MS 30000

// =====================
// BLE / App
// =====================
// App escribe comandos JSON en TX y escucha notificaciones JSON en RX.
#define BLE_SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define BLE_TX_UUID      "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define BLE_RX_UUID      "beb5483e-36e1-4688-b7f5-ea07361b26a9"

// Se conserva el tamano usado por la app original, que ya fue validado
// con BLEDevice::setMTU(185). La app reconstruye hasta encontrar '\n'.
#define BLE_CHUNK_BYTES 180
#define BLE_STATUS_INTERVAL_MS 5000

BLEServer *bleServer = nullptr;
BLECharacteristic *bleTxCharacteristic = nullptr;
BLECharacteristic *bleRxCharacteristic = nullptr;

bool bleConnected = false;
bool oldBleConnected = false;
unsigned long lastBleStatusAt = 0;
unsigned long bleCommandsReceived = 0;
unsigned long bleNotificationsSent = 0;
String lastBleCommand = "Sin comandos";
String bleCommandBuffer = "";

// Only loop() executes commands and accesses the radio. BLE callbacks enqueue
// complete frames; this also prevents concurrent multi-chunk notifications.
struct MeshCommand { char text[MAX_BLE_COMMAND_BYTES + 1]; };
QueueHandle_t commandQueue = nullptr;
StaticQueue_t commandQueueControl;
volatile bool commandQueueOverflow = false;
volatile bool commandBufferOverflow = false;
unsigned long commandQueueDrops = 0;

#if MESH_HAS_GPS
HardwareSerial gpsSerial(1);
#endif
MeshGpsReader gpsReader;
bool gpsEnabled = false;
bool gpsUartReady = false;
MeshMax30102 healthSensor;
#if MESH_HAS_MAX30102
bool healthDiagnosticSerial = false; // Explicit opt-in, OFF at boot.
#endif

// =====================
// Identidad
// =====================
Preferences prefs;

String nodeId = "";
String nodeName = "";
String bootId;
uint32_t metricsEpoch = 0;
String activeBleRequestId;
// Command execution is confined to loop(); scope prevents leaking request IDs
// into unrelated asynchronous ACKs, sensor updates or configuration errors.
struct MeshRequestScope {
  explicit MeshRequestScope(const String &id) { activeBleRequestId = id.substring(0, 64); }
  ~MeshRequestScope() { activeBleRequestId = ""; }
};

// Cambiar el namespace fuerza a regenerar nombres automaticos.
// Se usa v2 para evitar nombres repetidos guardados con la logica anterior.
const char *PREF_NAMESPACE = "mesh_node_v2";
const char *PREF_KEY_NAME = "nodeName";

// =====================
// Nodos conocidos
// =====================
struct MeshNode {
  String nodeId;
  String nodeName;
  float rssi;
  float snr;
  unsigned long lastSeen;
  bool online;
};

MeshNode knownNodes[MAX_NODES];

// =====================
// ACK pendientes
// =====================
struct PendingAck {
  String msgId;
  String to;
  unsigned long sentAt;
  bool encrypted;
  bool active;
};

PendingAck pendingAcks[MAX_PENDING_ACKS];

struct SecurityTxMetrics {
  bool available;
  unsigned long plaintextSizeBytes;
  unsigned long ciphertextSizeBytes;
  unsigned long encodedCiphertextSizeBytes;
  unsigned long encryptionTimeUs;
};

// =====================
// Metricas
// =====================
unsigned long txPackets = 0;
unsigned long rxPackets = 0;
unsigned long txOk = 0;
unsigned long txError = 0;

unsigned long announcesSent = 0;
unsigned long announcesReceived = 0;

unsigned long messagesSent = 0;
unsigned long messagesReceived = 0;
unsigned long encryptedMessagesSent = 0;
unsigned long encryptedMessagesReceived = 0;
unsigned long broadcastSent = 0;
unsigned long broadcastReceived = 0;
unsigned long directMessagesSent = 0;
unsigned long directMessagesReceived = 0;
unsigned long directPathSent = 0;
unsigned long autoMultihopSent = 0;
unsigned long autoMultihopReceived = 0;
unsigned long forcedMultihopSent = 0;
unsigned long autoRelaySelected = 0;
unsigned long autoRelayNotFound = 0;

unsigned long ackSent = 0;
unsigned long ackReceived = 0;
unsigned long messagesWithAck = 0;
unsigned long ackTimeouts = 0;

unsigned long duplicatePackets = 0;
unsigned long invalidJsonPackets = 0;
unsigned long corruptedPackets = 0;
unsigned long ownEchoIgnored = 0;
unsigned long guardedAnnounceSkips = 0;
unsigned long sizeDroppedPackets = 0;
unsigned long forwardedMessages = 0;
unsigned long forwardedAcks = 0;
unsigned long droppedByTtl = 0;
unsigned long notNextHopIgnored = 0;
unsigned long selfLoopIgnored = 0;

unsigned long lastLatencyMs = 0;
unsigned long latencySumMs = 0;
unsigned long latencySamples = 0;
unsigned long minLatencyMs = 0;
unsigned long maxLatencyMs = 0;

String lastSecurityMode = "NONE";
unsigned long lastPlaintextSizeBytes = 0;
unsigned long lastCiphertextSizeBytes = 0;
unsigned long lastEncodedCiphertextSizeBytes = 0;
unsigned long lastTransmittedSizeBytes = 0;
long lastCryptoOverheadBytes = 0;
float lastCryptoOverheadPercent = 0.0;
unsigned long lastEncryptionTimeUs = 0;
uint64_t encryptionTimeSumUs = 0;
unsigned long encryptionTimeSamples = 0;
unsigned long lastDecryptionTimeUs = 0;
uint64_t decryptionTimeSumUs = 0;
unsigned long decryptionTimeSamples = 0;
bool lastDecryptSuccess = false;
unsigned long decryptSuccessCount = 0;
unsigned long decryptFailureCount = 0;
bool lastLatencySecurityAes128 = false;

float lastRssi = 0;
float lastSnr = 0;

unsigned long messageCounter = 0;
unsigned long nextAnnounceAt = 0;
unsigned long lastPriorityTxAt = 0;
unsigned long lastPacketRxAt = 0;

volatile bool receivedFlag = false;
bool radioReady = false;

String lastMessageLine = "Sin mensajes";

// =====================================================
// Declaraciones BLE / App
// =====================================================
void handleBleCommand(String input);
void handleBleWriteChunk(String chunk);
void handleSerialCommand(String input);
void sendBleInfo();
void sendBleStatus();
void sendBleNodes();
void sendBleReady();
void bleNotifyLine(String payload);
void bleNotifyEvent(String eventType, String message);
void bleNotifyTxResult(String msgId, String to, String mode, bool ok, int bytes, bool encrypted = false);
void bleNotifyMessageReceived(String msgId, String from, String fromName, String to, String data, bool encrypted, bool sos, bool isBroadcast, String route);
void bleNotifyAckReceived(String from, String ackFor);
void bleNotifyAckTimeout(String msgId, String to);
void resetMetrics();
void touchNode(String remoteId, String remoteName, float rssi, float snr);
String selectBestRelay(String finalTo);
void sendMeshMessageDirect(String to, String text, bool sos);
void sendMeshMessageAuto(String to, String text, bool sos);
void sendMeshMessageVia(String relayNodeId, String finalTo, String text, bool sos, String routeLabel = "via", String modeLabel = "via");
void sendMeshMessage(String to, String text, bool sos);
void sendMeshPayloadDirect(String to, String data, bool encrypted, bool sos, const SecurityTxMetrics &securityMetrics);
void sendMeshPayloadAuto(String to, String data, bool encrypted, bool sos, const SecurityTxMetrics &securityMetrics);
void sendMeshPayloadVia(String relayNodeId, String finalTo, String data, bool encrypted, bool sos, const SecurityTxMetrics &securityMetrics, String routeLabel = "via", String modeLabel = "via");
bool extractCommandPayload(StaticJsonDocument<768> &doc, String &data, bool &encrypted, SecurityTxMetrics &securityMetrics);
void recordDecryptionMetric(StaticJsonDocument<768> &doc);
void sendBleGps(String requestId = "");
void sendBleHealth(String requestId = "");

class MeshBleServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) {
    bleConnected = true;
    Serial.println("[BLE] App conectada");
  }

  void onDisconnect(BLEServer *server) {
    bleConnected = false;
    bleCommandBuffer = "";
    if (commandQueue) xQueueReset(commandQueue);
    Serial.println("[BLE] App desconectada");
    delay(100);
    BLEDevice::startAdvertising();
    Serial.println("[BLE] Advertising reiniciado");
  }
};

class MeshBleWriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) {
    auto raw = characteristic->getValue();
    String chunk = String(raw.c_str());

    if (chunk.length() == 0) {
      return;
    }

    handleBleWriteChunk(chunk);
  }
};

// =====================================================
// Utilidades
// =====================================================
String limitUtf8Bytes(String s, size_t maxBytes) {
  if (s.length() <= maxBytes) return s;

  size_t cut = maxBytes;

  while (cut > 0 && ((uint8_t)s[cut] & 0xC0) == 0x80) {
    cut--;
  }

  return s.substring(0, cut);
}

String truncateForOled(String s, size_t maxChars) {
  if (s.length() <= maxChars) return s;
  return s.substring(0, maxChars);
}

float getPdrAck() {
  if (directMessagesSent == 0) return 0.0;
  return ((float)messagesWithAck / (float)directMessagesSent) * 100.0;
}

float getAvgLatency() {
  if (latencySamples == 0) return 0.0;
  return (float)latencySumMs / (float)latencySamples;
}

float getAvgEncryptionTimeUs() {
  if (encryptionTimeSamples == 0) return 0.0;
  return (float)encryptionTimeSumUs / (float)encryptionTimeSamples;
}

float getAvgDecryptionTimeUs() {
  if (decryptionTimeSamples == 0) return 0.0;
  return (float)decryptionTimeSumUs / (float)decryptionTimeSamples;
}

void updateLatencyStats(unsigned long latencyMs) {
  lastLatencyMs = latencyMs;
  latencySumMs += latencyMs;
  latencySamples++;

  if (minLatencyMs == 0 || latencyMs < minLatencyMs) {
    minLatencyMs = latencyMs;
  }

  if (latencyMs > maxLatencyMs) {
    maxLatencyMs = latencyMs;
  }
}

String createMsgId() {
  messageCounter++;

  // ID compacto y practicamente unico para reservar mas bytes al ciphertext:
  // 6 hex del nodo + 32 bits aleatorios del ESP32 + contador de 16 bits.
  String nodeSuffix = nodeId;
  if (nodeSuffix.length() > 6) {
    nodeSuffix = nodeSuffix.substring(nodeSuffix.length() - 6);
  }

  char buffer[24];
  snprintf(
    buffer,
    sizeof(buffer),
    "%s-%08lX-%04X",
    nodeSuffix.c_str(),
    (unsigned long)esp_random(),
    (unsigned int)(messageCounter & 0xFFFF)
  );

  return String(buffer);
}

void scheduleNextAnnounce() {
  nextAnnounceAt = millis() + ANNOUNCE_BASE_INTERVAL_MS + random(0, ANNOUNCE_JITTER_MS);
}

bool isValidRemoteId(const String &remoteId) {
  return remoteId.startsWith("N-") && remoteId.length() >= 6 && remoteId.length() <= 20;
}

bool isValidNodeName(const String &name) {
  if (name.length() == 0 || name.length() > 32) return false;
  if (name.indexOf('{') >= 0) return false;
  if (name.indexOf('}') >= 0) return false;
  if (name.indexOf('"') >= 0) return false;
  if (name.indexOf('\n') >= 0) return false;
  if (name.indexOf('\r') >= 0) return false;
  return true;
}

bool isCompleteJsonObject(const String &input) {
  int depth = 0;
  bool started = false;
  bool inString = false;
  bool escaped = false;

  for (size_t i = 0; i < input.length(); i++) {
    char c = input[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c == '\\') {
        escaped = true;
      } else if (c == '"') {
        inString = false;
      }
      continue;
    }

    if (c == '"') {
      inString = true;
    } else if (c == '{') {
      depth++;
      started = true;
    } else if (c == '}') {
      depth--;
      if (depth < 0) return true;
    }
  }

  return started && depth == 0 && !inString;
}

// ArduinoJson puede recibir indicadores desde distintas versiones como
// booleano true, entero 1 o texto "true"/"1". Normalizarlos evita que un
// paquete LoRa con "e":1 sea tratado accidentalmente como texto plano.
bool readJsonFlag(JsonVariantConst value) {
  if (value.is<bool>()) {
    return value.as<bool>();
  }

  if (value.is<int>()) {
    return value.as<int>() != 0;
  }

  if (value.is<const char *>()) {
    String text = value.as<const char *>();
    text.trim();
    text.toLowerCase();
    return text == "true" || text == "1";
  }

  return false;
}

// Formatos BLE aceptados:
// 1) Recomendado:
//    {"cmd":"send","to":"N-...","payload":{"encrypted":true,"data":"M2:BASE64"}}
// 2) Compatible:
//    {"cmd":"send","to":"N-...","encrypted":true,"data":"BASE64"}
// 3) Texto existente:
//    {"cmd":"send","to":"N-...","text":"hola"}
//
// El firmware nunca descifra ni altera data. En LoRa se usan las claves
// compactas x=data y e=1 para ahorrar bytes.
bool extractCommandPayload(StaticJsonDocument<768> &doc, String &data, bool &encrypted, SecurityTxMetrics &securityMetrics) {
  data = "";
  encrypted = false;
  securityMetrics = {};

  JsonVariant payloadVariant = doc["payload"];
  JsonVariant textVariant = doc["text"];

  if (payloadVariant.is<JsonObject>()) {
    JsonObject payloadObject = payloadVariant.as<JsonObject>();
    encrypted = readJsonFlag(payloadObject["encrypted"]);
    data = String(payloadObject["data"] | "");
  } else if (textVariant.is<JsonObject>()) {
    JsonObject payloadObject = textVariant.as<JsonObject>();
    encrypted = readJsonFlag(payloadObject["encrypted"]);
    data = String(payloadObject["data"] | "");
  } else if (readJsonFlag(doc["encrypted"]) || doc.containsKey("data")) {
    encrypted = readJsonFlag(doc["encrypted"]);
    data = String(doc["data"] | "");
  } else {
    data = String(doc["text"] | "");
  }

  JsonObject securityObject = doc["securityMetrics"].as<JsonObject>();
  if (!securityObject.isNull()) {
    securityMetrics.available = true;
    securityMetrics.plaintextSizeBytes = securityObject["plaintextSizeBytes"] | 0;
    securityMetrics.ciphertextSizeBytes = securityObject["ciphertextSizeBytes"] | 0;
    securityMetrics.encodedCiphertextSizeBytes = securityObject["encodedCiphertextSizeBytes"] | 0;
    securityMetrics.encryptionTimeUs = securityObject["encryptionTimeUs"] | 0;
  } else {
    // Legacy/plain commands do not include app-side timing. Preserve support
    // while still reporting the sizes visible to this transport layer.
    securityMetrics.plaintextSizeBytes = encrypted ? 0 : data.length();
    securityMetrics.ciphertextSizeBytes = encrypted ? 0 : data.length();
    securityMetrics.encodedCiphertextSizeBytes = data.length();
  }

  if (encrypted) {
    if (data.length() == 0) {
      Serial.println("[CRYPTO] Payload cifrado rechazado: data vacio");
      bleNotifyEvent("error", "Payload cifrado sin data");
      return false;
    }

    // Nunca truncar Base64: un solo byte perdido inutiliza el criptograma.
    if (data.indexOf('\n') >= 0 || data.indexOf('\r') >= 0) {
      Serial.println("[CRYPTO] Payload cifrado rechazado: contiene saltos de linea");
      bleNotifyEvent("error", "Payload cifrado invalido");
      return false;
    }
  }

  return true;
}

void recordTxSecurityMetric(
  String msgId,
  bool encrypted,
  const SecurityTxMetrics &securityMetrics,
  unsigned long transmittedSizeBytes
) {
  lastSecurityMode = encrypted ? "AES128" : "NONE";
  lastPlaintextSizeBytes = securityMetrics.plaintextSizeBytes;
  lastCiphertextSizeBytes = securityMetrics.ciphertextSizeBytes;
  lastEncodedCiphertextSizeBytes = securityMetrics.encodedCiphertextSizeBytes;
  lastTransmittedSizeBytes = transmittedSizeBytes;
  lastEncryptionTimeUs = securityMetrics.encryptionTimeUs;
  lastCryptoOverheadBytes = (long)lastCiphertextSizeBytes - (long)lastPlaintextSizeBytes;
  lastCryptoOverheadPercent = lastPlaintextSizeBytes > 0
    ? ((float)lastCryptoOverheadBytes / (float)lastPlaintextSizeBytes) * 100.0
    : 0.0;

  if (encrypted && securityMetrics.available) {
    encryptionTimeSumUs += lastEncryptionTimeUs;
    encryptionTimeSamples++;
  }

  Serial.print("[SECURITY] msg_id=");
  Serial.print(msgId);
  Serial.print(" security_mode=");
  Serial.print(lastSecurityMode);
  Serial.print(" plaintext_size_bytes=");
  Serial.print(lastPlaintextSizeBytes);
  Serial.print(" ciphertext_size_bytes=");
  Serial.print(lastCiphertextSizeBytes);
  Serial.print(" encoded_ciphertext_size_bytes=");
  Serial.print(lastEncodedCiphertextSizeBytes);
  Serial.print(" transmitted_size_bytes=");
  Serial.print(lastTransmittedSizeBytes);
  Serial.print(" crypto_overhead_bytes=");
  Serial.print(lastCryptoOverheadBytes);
  Serial.print(" crypto_overhead_percent=");
  Serial.print(lastCryptoOverheadPercent, 2);
  Serial.print(" encryption_time_us=");
  Serial.println(lastEncryptionTimeUs);
}

void recordDecryptionMetric(StaticJsonDocument<768> &doc) {
  String msgId = doc["msgId"] | "";
  String securityMode = doc["securityMode"] | "AES128";
  lastSecurityMode = securityMode;
  lastPlaintextSizeBytes = doc["plaintextSizeBytes"] | 0;
  lastCiphertextSizeBytes = doc["ciphertextSizeBytes"] | 0;
  lastEncodedCiphertextSizeBytes = doc["encodedCiphertextSizeBytes"] | 0;
  lastDecryptionTimeUs = doc["decryptionTimeUs"] | 0;
  lastDecryptSuccess = readJsonFlag(doc["decryptSuccess"]);
  lastCryptoOverheadBytes = (long)lastCiphertextSizeBytes - (long)lastPlaintextSizeBytes;
  lastCryptoOverheadPercent = lastPlaintextSizeBytes > 0
    ? ((float)lastCryptoOverheadBytes / (float)lastPlaintextSizeBytes) * 100.0
    : 0.0;

  decryptionTimeSumUs += lastDecryptionTimeUs;
  decryptionTimeSamples++;
  if (lastDecryptSuccess) {
    decryptSuccessCount++;
  } else {
    decryptFailureCount++;
  }

  Serial.print("[SECURITY] msg_id=");
  Serial.print(msgId);
  Serial.print(" security_mode=");
  Serial.print(lastSecurityMode);
  Serial.print(" decryption_time_us=");
  Serial.print(lastDecryptionTimeUs);
  Serial.print(" decrypt_success=");
  Serial.print(lastDecryptSuccess ? "true" : "false");
  Serial.print(" plaintext_size_bytes=");
  Serial.print(lastPlaintextSizeBytes);
  Serial.print(" ciphertext_size_bytes=");
  Serial.print(lastCiphertextSizeBytes);
  Serial.print(" encoded_ciphertext_size_bytes=");
  Serial.println(lastEncodedCiphertextSizeBytes);
}

// =====================================================
// OLED
// =====================================================
void drawScreen(String line1, String line2, String line3, String line4) {
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);

  oled.drawStr(0, 10, truncateForOled(line1, 21).c_str());
  oled.drawStr(0, 25, truncateForOled(line2, 21).c_str());
  oled.drawStr(0, 40, truncateForOled(line3, 21).c_str());
  oled.drawStr(0, 55, truncateForOled(line4, 21).c_str());

  oled.sendBuffer();
}

void initOled() {
  pinMode(VEXT_PIN, OUTPUT);
  digitalWrite(VEXT_PIN, LOW);
  delay(500);

  pinMode(OLED_RST, OUTPUT);
  digitalWrite(OLED_RST, LOW);
  delay(50);
  digitalWrite(OLED_RST, HIGH);
  delay(200);

  oled.begin();
  oled.enableUTF8Print();

  drawScreen("LoRa Mesh", "Capa 5.1", "OLED OK", "Iniciando...");
}

void updateDisplay() {
  int online = 0;

  for (int i = 0; i < MAX_NODES; i++) {
    if (knownNodes[i].nodeId.length() > 0 && knownNodes[i].online) {
      online++;
    }
  }

  String line1 = nodeName;
  String line2 = "Mesh:" + String(online) + "/" + String(EXPECTED_NODES) + " PDR:" + String(getPdrAck(), 0) + "%";
  String line3 = "TX:" + String(txOk) + " RX:" + String(rxPackets) + " ACK:" + String(ackReceived);
  String line4 = "FWD:" + String(forwardedMessages) + " Lat:" + String(lastLatencyMs) + "ms";
  if (MESH_HAS_GPS && (millis() / 5000) % 2) {
    line4 = !gpsEnabled ? "GPS apagado" :
      String(gpsReader.fresh(millis()) ? "GPS FIX " : "GPS buscando ") +
      String(gpsReader.satellites) + " sat";
  }
  if (MESH_HAS_MAX30102 && (millis() / 5000) % 3 == 2) {
    MeshHealthSnapshot health = healthSensor.snapshot();
    bool fresh = health.enabled && health.present && health.contact && health.sampleSeen &&
      uint32_t(millis() - health.lastSampleAt) <= 500 && health.valueSeen &&
      uint32_t(millis() - health.lastValueAt) <= 2500;
    line4 = fresh && !strcmp(health.state, "reading") ?
      String("EXP HR:") + (health.heartValid ? String(health.heartRate) : "--") +
      " O2:" + (health.spo2Valid ? String(health.spo2) : "--") :
      String(meshHealthDisplayLabel(health));
  }

  drawScreen(line1, line2, line3, line4);
}

// =====================================================
// Identidad automatica
// =====================================================
String generateNodeId() {
  uint64_t chipId = ESP.getEfuseMac();

  uint16_t high = (uint16_t)((chipId >> 32) & 0xFFFF);
  uint32_t low = (uint32_t)(chipId & 0xFFFFFFFF);

  char buffer[20];
  snprintf(buffer, sizeof(buffer), "N-%04X%08X", high, low);

  return String(buffer);
}

String generateDefaultNodeName() {
  String cleanId = nodeId;

  if (cleanId.startsWith("N-")) {
    cleanId = cleanId.substring(2);
  }

  if (cleanId.length() >= 8) {
    String firstPart = cleanId.substring(0, 4);
    String lastPart = cleanId.substring(cleanId.length() - 4);
    return "Nodo " + firstPart + "-" + lastPart;
  }

  return "Nodo " + cleanId;
}

void setupIdentity() {
  prefs.begin(PREF_NAMESPACE, false);

  nodeId = generateNodeId();

  nodeName = prefs.getString(PREF_KEY_NAME, "");

  if (nodeName.length() == 0) {
    nodeName = generateDefaultNodeName();
    prefs.putString(PREF_KEY_NAME, nodeName);
  }

  Serial.println("[IDENTITY] Node ID: " + nodeId);
  Serial.println("[IDENTITY] Node Name: " + nodeName);
}

void setNodeName(String newName) {
  newName.trim();

  if (newName.length() == 0) {
    Serial.println("[IDENTITY] Error: nombre vacio");
    return;
  }

  newName = limitUtf8Bytes(newName, 32);
  nodeName = newName;
  prefs.putString(PREF_KEY_NAME, nodeName);

  Serial.println("[IDENTITY] Nombre actualizado: " + nodeName);
  bleNotifyEvent("nameUpdated", "Nombre actualizado");
  sendBleInfo();
  scheduleNextAnnounce();
  updateDisplay();
}

void resetNodeName() {
  prefs.remove(PREF_KEY_NAME);
  nodeName = generateDefaultNodeName();
  prefs.putString(PREF_KEY_NAME, nodeName);

  Serial.println("[IDENTITY] Nombre reiniciado: " + nodeName);
  bleNotifyEvent("nameUpdated", "Nombre reiniciado");
  sendBleInfo();
  scheduleNextAnnounce();
  updateDisplay();
}

// =====================================================
// Nodos detectados
// =====================================================
void upsertNode(String remoteId, String remoteName, float rssi, float snr) {
  if (remoteId.length() == 0) {
    return;
  }

  if (remoteId == nodeId) {
    Serial.println("[MESH] Announce propio ignorado");
    return;
  }

  unsigned long now = millis();

  for (int i = 0; i < MAX_NODES; i++) {
    if (knownNodes[i].nodeId == remoteId) {
      bool wasOffline = !knownNodes[i].online;

      knownNodes[i].nodeName = remoteName;
      knownNodes[i].rssi = rssi;
      knownNodes[i].snr = snr;
      knownNodes[i].lastSeen = now;
      knownNodes[i].online = true;

      Serial.println("[MESH] Nodo actualizado: " + remoteName + " (" + remoteId + ")");

      if (wasOffline) {
        sendBleNodes();
      }

      return;
    }
  }

  for (int i = 0; i < MAX_NODES; i++) {
    if (knownNodes[i].nodeId.length() == 0) {
      knownNodes[i].nodeId = remoteId;
      knownNodes[i].nodeName = remoteName;
      knownNodes[i].rssi = rssi;
      knownNodes[i].snr = snr;
      knownNodes[i].lastSeen = now;
      knownNodes[i].online = true;

      Serial.println("[MESH] Nuevo nodo detectado: " + remoteName + " (" + remoteId + ")");
      sendBleNodes();
      return;
    }
  }

  Serial.println("[MESH] Tabla de nodos llena");
}

void pruneNodes() {
  unsigned long now = millis();

  for (int i = 0; i < MAX_NODES; i++) {
    if (knownNodes[i].nodeId.length() > 0 && knownNodes[i].online) {
      if (now - knownNodes[i].lastSeen > NODE_TIMEOUT_MS) {
        knownNodes[i].online = false;
        Serial.println("[MESH] Nodo offline: " + knownNodes[i].nodeName);
        sendBleNodes();
      }
    }
  }
}

int getOnlineNodeCount() {
  int count = 0;

  for (int i = 0; i < MAX_NODES; i++) {
    if (knownNodes[i].nodeId.length() > 0 && knownNodes[i].online) {
      count++;
    }
  }

  return count;
}

String getNodeIdByIndex(int index) {
  if (index < 0 || index >= MAX_NODES) return "";
  if (knownNodes[index].nodeId.length() == 0) return "";
  return knownNodes[index].nodeId;
}

String getNodeNameById(String id) {
  for (int i = 0; i < MAX_NODES; i++) {
    if (knownNodes[i].nodeId == id && knownNodes[i].nodeName.length() > 0) {
      return knownNodes[i].nodeName;
    }
  }

  return id;
}

String getNodeState(unsigned long lastSeen, bool online) {
  if (!online) return "offline";

  unsigned long age = millis() - lastSeen;

  if (age <= ACTIVE_NODE_MS) return "active";
  if (age <= NODE_TIMEOUT_MS) return "recent";
  return "offline";
}

void touchNode(String remoteId, String remoteName, float rssi, float snr) {
  remoteId.trim();
  remoteName.trim();

  if (!isValidRemoteId(remoteId) || remoteId == nodeId) {
    return;
  }

  if (!isValidNodeName(remoteName)) {
    remoteName = getNodeNameById(remoteId);
  }

  upsertNode(remoteId, remoteName, rssi, snr);
}

String selectBestRelay(String finalTo) {
  unsigned long now = millis();
  String bestRelay = "";
  float bestScore = -99999.0;

  for (int i = 0; i < MAX_NODES; i++) {
    if (knownNodes[i].nodeId.length() == 0) continue;
    if (!knownNodes[i].online) continue;
    if (knownNodes[i].nodeId == finalTo) continue;
    if (knownNodes[i].nodeId == nodeId) continue;

    unsigned long ageMs = now - knownNodes[i].lastSeen;
    if (ageMs > NODE_TIMEOUT_MS) continue;

    // Puntaje simple: RSSI fuerte, SNR alto y menor antiguedad.
    float agePenalty = ((float)ageMs / 1000.0) * 0.05;
    float score = knownNodes[i].rssi + (knownNodes[i].snr * 2.0) - agePenalty;

    if (bestRelay.length() == 0 || score > bestScore) {
      bestRelay = knownNodes[i].nodeId;
      bestScore = score;
    }
  }

  return bestRelay;
}

void printNodes() {
  Serial.println("----- NODOS DETECTADOS -----");

  for (int i = 0; i < MAX_NODES; i++) {
    if (knownNodes[i].nodeId.length() > 0) {
      Serial.print(i);
      Serial.print(" | ");
      Serial.print(knownNodes[i].online ? "ONLINE" : "OFFLINE");
      Serial.print(" | ");
      Serial.print(knownNodes[i].nodeName);
      Serial.print(" | ");
      Serial.print(knownNodes[i].nodeId);
      Serial.print(" | RSSI: ");
      Serial.print(knownNodes[i].rssi);
      Serial.print(" | SNR: ");
      Serial.println(knownNodes[i].snr);
    }
  }

  Serial.println("----------------------------");
}

// =====================================================
// Duplicados
// =====================================================
String seenMessages[MAX_SEEN_MESSAGES];
int seenIndex = 0;

bool wasSeen(String msgId) {
  if (msgId.length() == 0) return false;

  for (int i = 0; i < MAX_SEEN_MESSAGES; i++) {
    if (seenMessages[i] == msgId) {
      return true;
    }
  }

  return false;
}

void markSeen(String msgId) {
  if (msgId.length() == 0) return;

  seenMessages[seenIndex] = msgId;
  seenIndex = (seenIndex + 1) % MAX_SEEN_MESSAGES;
}

// =====================================================
// Pending ACK
// =====================================================
void trackPendingAck(String msgId, String to, bool encrypted) {
  for (int i = 0; i < MAX_PENDING_ACKS; i++) {
    if (!pendingAcks[i].active) {
      pendingAcks[i].msgId = msgId;
      pendingAcks[i].to = to;
      pendingAcks[i].sentAt = millis();
      pendingAcks[i].encrypted = encrypted;
      pendingAcks[i].active = true;
      return;
    }
  }

  pendingAcks[0].msgId = msgId;
  pendingAcks[0].to = to;
  pendingAcks[0].sentAt = millis();
  pendingAcks[0].encrypted = encrypted;
  pendingAcks[0].active = true;
}

bool resolvePendingAck(String ackFor) {
  for (int i = 0; i < MAX_PENDING_ACKS; i++) {
    if (pendingAcks[i].active && pendingAcks[i].msgId == ackFor) {
      unsigned long latency = millis() - pendingAcks[i].sentAt;
      updateLatencyStats(latency);
      lastLatencySecurityAes128 = pendingAcks[i].encrypted;

      Serial.print("[SECURITY] msg_id=");
      Serial.print(ackFor);
      Serial.print(" security_mode=");
      Serial.print(lastLatencySecurityAes128 ? "AES128" : "NONE");
      Serial.print(" latency_ms=");
      Serial.println(latency);

      pendingAcks[i].active = false;
      pendingAcks[i].msgId = "";
      pendingAcks[i].to = "";
      pendingAcks[i].sentAt = 0;
      pendingAcks[i].encrypted = false;

      return true;
    }
  }

  return false;
}

void checkAckTimeouts() {
  unsigned long now = millis();

  for (int i = 0; i < MAX_PENDING_ACKS; i++) {
    if (pendingAcks[i].active && now - pendingAcks[i].sentAt > ACK_TIMEOUT_MS) {
      String timeoutMsgId = pendingAcks[i].msgId;
      String timeoutTo = pendingAcks[i].to;

      Serial.println("[ACK] Timeout para " + timeoutMsgId + " hacia " + timeoutTo);

      pendingAcks[i].active = false;
      pendingAcks[i].msgId = "";
      pendingAcks[i].to = "";
      pendingAcks[i].sentAt = 0;
      pendingAcks[i].encrypted = false;

      ackTimeouts++;
      bleNotifyAckTimeout(timeoutMsgId, timeoutTo);
    }
  }
}

void resetMetrics() {
  ++metricsEpoch; // An explicit reset is a new counter epoch, not a new boot.
  txPackets = 0;
  rxPackets = 0;
  txOk = 0;
  txError = 0;

  announcesSent = 0;
  announcesReceived = 0;

  messagesSent = 0;
  messagesReceived = 0;
  encryptedMessagesSent = 0;
  encryptedMessagesReceived = 0;
  broadcastSent = 0;
  broadcastReceived = 0;
  directMessagesSent = 0;
  directMessagesReceived = 0;
  directPathSent = 0;
  autoMultihopSent = 0;
  autoMultihopReceived = 0;
  forcedMultihopSent = 0;
  autoRelaySelected = 0;
  autoRelayNotFound = 0;

  ackSent = 0;
  ackReceived = 0;
  messagesWithAck = 0;
  ackTimeouts = 0;

  duplicatePackets = 0;
  invalidJsonPackets = 0;
  corruptedPackets = 0;
  ownEchoIgnored = 0;
  guardedAnnounceSkips = 0;
  sizeDroppedPackets = 0;
  forwardedMessages = 0;
  forwardedAcks = 0;
  droppedByTtl = 0;
  notNextHopIgnored = 0;
  selfLoopIgnored = 0;

  lastLatencyMs = 0;
  latencySumMs = 0;
  latencySamples = 0;
  minLatencyMs = 0;
  maxLatencyMs = 0;

  lastSecurityMode = "NONE";
  lastPlaintextSizeBytes = 0;
  lastCiphertextSizeBytes = 0;
  lastEncodedCiphertextSizeBytes = 0;
  lastTransmittedSizeBytes = 0;
  lastCryptoOverheadBytes = 0;
  lastCryptoOverheadPercent = 0.0;
  lastEncryptionTimeUs = 0;
  encryptionTimeSumUs = 0;
  encryptionTimeSamples = 0;
  lastDecryptionTimeUs = 0;
  decryptionTimeSumUs = 0;
  decryptionTimeSamples = 0;
  lastDecryptSuccess = false;
  decryptSuccessCount = 0;
  decryptFailureCount = 0;
  lastLatencySecurityAes128 = false;

  messageCounter = 0;
  lastMessageLine = "Sin mensajes";

  for (int i = 0; i < MAX_PENDING_ACKS; i++) {
    pendingAcks[i].msgId = "";
    pendingAcks[i].to = "";
    pendingAcks[i].sentAt = 0;
    pendingAcks[i].encrypted = false;
    pendingAcks[i].active = false;
  }

  for (int i = 0; i < MAX_SEEN_MESSAGES; i++) {
    seenMessages[i] = "";
  }
  seenIndex = 0;

  Serial.println("[METRICS] Metricas reiniciadas");
  bleNotifyEvent("metricsReset", "Metricas reiniciadas");
  sendBleStatus();
  updateDisplay();
}

// =====================================================
// BLE / App
// =====================================================
bool isBleReady() {
  return bleConnected && bleRxCharacteristic != nullptr;
}

void addTelemetryFields(JsonDocument &doc) {
  if (activeBleRequestId.length()) doc["requestId"] = activeBleRequestId;
  doc["nodeId"] = nodeId;
  doc["bootId"] = bootId;
  doc["uptimeMs"] = uint64_t(esp_timer_get_time() / 1000);
  doc["metricsEpoch"] = metricsEpoch;
}

void bleNotifyLine(String payload) {
  if (!isBleReady()) {
    return;
  }

  payload += "\n";

  for (size_t i = 0; i < payload.length(); i += BLE_CHUNK_BYTES) {
    size_t end = i + BLE_CHUNK_BYTES;

    if (end > payload.length()) {
      end = payload.length();
    }

    String chunk = payload.substring(i, end);
    bleRxCharacteristic->setValue((uint8_t *)chunk.c_str(), chunk.length());
    bleRxCharacteristic->notify();
    bleNotificationsSent++;
    delay(15);
  }
}

void bleNotifyEvent(String eventType, String message) {
  StaticJsonDocument<256> doc;
  doc["type"] = eventType;
  addTelemetryFields(doc);
  if (activeBleRequestId.length()) doc["requestId"] = activeBleRequestId;
  doc["message"] = message;
  doc["nodeId"] = nodeId;
  doc["nodeName"] = nodeName;

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void sendBleInfo() {
#if MESH_HAS_MAX30102
  StaticJsonDocument<1024> doc;
#else
  StaticJsonDocument<768> doc;
#endif
  doc["type"] = "info";
  addTelemetryFields(doc);
  doc["requestCorrelation"] = true;
  doc["snapshotCorrelation"] = true;
  doc["ackTimeoutMs"] = ACK_TIMEOUT_MS;
  doc["nodeId"] = nodeId;
  doc["nodeName"] = nodeName;
  doc["bleConnected"] = bleConnected;
  doc["layer"] = "5.1";
  doc["radio"] = "SX1262-RadioLib";
  doc["firmwareVersion"] = "5.6.0";
  doc["board"] = MESH_BOARD_NAME;
  doc["gpsSupported"] = bool(MESH_HAS_GPS);
  doc["healthSupported"] = bool(MESH_HAS_MAX30102);
#if MESH_HAS_MAX30102
  doc["healthDiagnosticRevision"] = 3;
#endif
  doc["maxNodes"] = MAX_NODES;
  doc["sx1262DriveDbm"] = LORA_POWER;
  doc["freePsramBytes"] = ESP.getFreePsram();
  doc["frequencyMHz"] = LORA_FREQ;
  doc["bandwidthKHz"] = LORA_BW;
  doc["spreadingFactor"] = LORA_SF;
  doc["codingRate"] = LORA_CR;
  doc["syncWord"] = LORA_SYNC_WORD;
  doc["preambleLength"] = LORA_PREAMBLE;

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void sendBleReady() {
  StaticJsonDocument<512> doc;
  doc["type"] = "ready";
  addTelemetryFields(doc);
  doc["requestCorrelation"] = true;
  doc["nodeId"] = nodeId;
  doc["nodeName"] = nodeName;
  doc["serviceUuid"] = BLE_SERVICE_UUID;
  doc["txUuid"] = BLE_TX_UUID;
  doc["rxUuid"] = BLE_RX_UUID;
  doc["commands"] = "info,status,nodes,gps,setGps,health,setHealth,setName,resetName,resetMetrics,send,broadcast,sendDirect,sendvia(debug)";

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void sendBleStatus() {
  StaticJsonDocument<2048> doc;

  doc["type"] = "status";
  addTelemetryFields(doc);
  doc["nodeId"] = nodeId;
  doc["nodeName"] = nodeName;
  doc["onlineNodes"] = getOnlineNodeCount();
  doc["expectedNodes"] = EXPECTED_NODES;
  doc["lastRssi"] = lastRssi;
  doc["lastSnr"] = lastSnr;

  JsonObject m = doc.createNestedObject("metrics");
  m["txPackets"] = txPackets;
  m["txOk"] = txOk;
  m["txError"] = txError;
  m["rxPackets"] = rxPackets;
  m["announcesSent"] = announcesSent;
  m["announcesReceived"] = announcesReceived;
  m["messagesSent"] = messagesSent;
  m["messagesReceived"] = messagesReceived;
  m["encryptedSent"] = encryptedMessagesSent;
  m["encryptedReceived"] = encryptedMessagesReceived;
  m["broadcastSent"] = broadcastSent;
  m["broadcastReceived"] = broadcastReceived;
  m["directSent"] = directMessagesSent;
  m["directReceived"] = directMessagesReceived;
  m["directPathSent"] = directPathSent;
  m["autoMultihopSent"] = autoMultihopSent;
  m["autoMultihopReceived"] = autoMultihopReceived;
  m["forcedMultihopSent"] = forcedMultihopSent;
  m["autoRelaySelected"] = autoRelaySelected;
  m["autoRelayNotFound"] = autoRelayNotFound;
  m["ackSent"] = ackSent;
  m["ackReceived"] = ackReceived;
  m["messagesWithAck"] = messagesWithAck;
  m["ackTimeouts"] = ackTimeouts;
  m["pdrAck"] = getPdrAck();
  m["lastLatencyMs"] = lastLatencyMs;
  m["avgLatencyMs"] = getAvgLatency();
  m["minLatencyMs"] = minLatencyMs;
  m["maxLatencyMs"] = maxLatencyMs;
  m["securityModeAes128"] = lastSecurityMode == "AES128" ? 1 : 0;
  m["plaintextSizeBytes"] = lastPlaintextSizeBytes;
  m["ciphertextSizeBytes"] = lastCiphertextSizeBytes;
  m["encodedCiphertextSizeBytes"] = lastEncodedCiphertextSizeBytes;
  m["transmittedSizeBytes"] = lastTransmittedSizeBytes;
  m["cryptoOverheadBytes"] = lastCryptoOverheadBytes;
  m["cryptoOverheadPercent"] = lastCryptoOverheadPercent;
  m["lastEncryptionTimeUs"] = lastEncryptionTimeUs;
  m["avgEncryptionTimeUs"] = getAvgEncryptionTimeUs();
  m["encryptionTimeSamples"] = encryptionTimeSamples;
  m["lastDecryptionTimeUs"] = lastDecryptionTimeUs;
  m["avgDecryptionTimeUs"] = getAvgDecryptionTimeUs();
  m["decryptionTimeSamples"] = decryptionTimeSamples;
  m["decryptSuccess"] = lastDecryptSuccess ? 1 : 0;
  m["decryptSuccessCount"] = decryptSuccessCount;
  m["decryptFailureCount"] = decryptFailureCount;
  m["latencySecurityModeAes128"] = lastLatencySecurityAes128 ? 1 : 0;
  m["duplicates"] = duplicatePackets;
  m["invalidJson"] = invalidJsonPackets;
  m["corrupted"] = corruptedPackets;
  m["ownEchoIgnored"] = ownEchoIgnored;
  m["forwardedMessages"] = forwardedMessages;
  m["forwardedAcks"] = forwardedAcks;
  m["droppedByTtl"] = droppedByTtl;
  m["notNextHopIgnored"] = notNextHopIgnored;
  m["guardedAnnounceSkips"] = guardedAnnounceSkips;
  m["sizeDroppedPackets"] = sizeDroppedPackets;
  m["commandQueueDrops"] = commandQueueDrops;

  JsonObject b = doc.createNestedObject("ble");
  b["connected"] = bleConnected;
  b["commandsReceived"] = bleCommandsReceived;
  b["notificationsSent"] = bleNotificationsSent;
  b["lastCommand"] = lastBleCommand;

  doc["lastMessage"] = lastMessageLine;

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void sendBleNodes() {
  // Ten node entries, including dynamic IDs and names, can exceed a 1536-byte
  // ArduinoJson document. Keep this on the heap so BLE callbacks do not spend
  // most of their task stack on a large temporary object.
  DynamicJsonDocument doc(512 + MAX_NODES * 384);
  doc["type"] = "nodes";
  addTelemetryFields(doc);
  doc["nodeId"] = nodeId;
  doc["nodeName"] = nodeName;

  JsonArray nodes = doc.createNestedArray("nodes");

  for (int i = 0; i < MAX_NODES; i++) {
    if (knownNodes[i].nodeId.length() > 0) {
      JsonObject n = nodes.createNestedObject();
      n["index"] = i;
      n["id"] = knownNodes[i].nodeId;
      n["name"] = knownNodes[i].nodeName;
      n["online"] = knownNodes[i].online;
      n["rssi"] = knownNodes[i].rssi;
      n["snr"] = knownNodes[i].snr;
      n["lastSeenMsAgo"] = millis() - knownNodes[i].lastSeen;
      n["state"] = getNodeState(knownNodes[i].lastSeen, knownNodes[i].online);
    }
  }

  if (doc.overflowed()) {
    Serial.println("[BLE] No se pudo serializar la lista completa de nodos");
    bleNotifyEvent("error", "Lista de nodos demasiado grande");
    return;
  }

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void bleNotifyTxResult(String msgId, String to, String mode, bool ok, int bytes, bool encrypted) {
  StaticJsonDocument<512> doc;
  doc["type"] = "sent";
  addTelemetryFields(doc);
  if (activeBleRequestId.length()) doc["requestId"] = activeBleRequestId;
  doc["ok"] = ok;
  doc["mode"] = mode;
  doc["msgId"] = msgId;
  doc["from"] = nodeId;
  doc["fromName"] = nodeName;
  doc["to"] = to;
  doc["bytes"] = bytes;
  doc["encrypted"] = encrypted;

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void bleNotifyMessageReceived(String msgId, String from, String fromName, String to, String data, bool encrypted, bool sos, bool isBroadcast, String route) {
  StaticJsonDocument<768> doc;
  doc["type"] = "message";
  addTelemetryFields(doc);
  doc["bytes"] = lastTransmittedSizeBytes;
  doc["msgId"] = msgId;
  doc["from"] = from;
  doc["fromName"] = fromName;
  doc["to"] = to;
  doc["encrypted"] = encrypted;

  if (encrypted) {
    JsonObject payload = doc.createNestedObject("payload");
    payload["encrypted"] = true;
    payload["data"] = data;
  } else {
    doc["text"] = data;
  }
  doc["sos"] = sos;
  doc["broadcast"] = isBroadcast;
  doc["route"] = route;
  doc["rssi"] = lastRssi;
  doc["snr"] = lastSnr;

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void bleNotifyAckReceived(String from, String ackFor) {
  StaticJsonDocument<512> doc;
  doc["type"] = "ack";
  addTelemetryFields(doc);
  doc["rssi"] = lastRssi;
  doc["snr"] = lastSnr;
  doc["from"] = from;
  doc["to"] = nodeId;
  doc["ackFor"] = ackFor;
  doc["latencyMs"] = lastLatencyMs;
  doc["pdrAck"] = getPdrAck();
  doc["messagesWithAck"] = messagesWithAck;
  doc["ackReceived"] = ackReceived;

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void bleNotifyAckTimeout(String msgId, String to) {
  StaticJsonDocument<384> doc;
  doc["type"] = "ackTimeout";
  addTelemetryFields(doc);
  doc["msgId"] = msgId;
  doc["to"] = to;
  doc["ackTimeouts"] = ackTimeouts;
  doc["pdrAck"] = getPdrAck();

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void initBle() {
  String bleName = "LoRaMesh-" + nodeName;

  Serial.println("[BLE] Iniciando BLE: " + bleName);

  BLEDevice::init(bleName.c_str());
  BLEDevice::setMTU(185);

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new MeshBleServerCallbacks());

  BLEService *service = bleServer->createService(BLE_SERVICE_UUID);

  bleTxCharacteristic = service->createCharacteristic(
    BLE_TX_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );

  bleTxCharacteristic->setCallbacks(new MeshBleWriteCallbacks());

  bleRxCharacteristic = service->createCharacteristic(
    BLE_RX_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );

  bleRxCharacteristic->addDescriptor(new BLE2902());
  bleRxCharacteristic->setValue("{\"type\":\"boot\"}\n");

  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);

  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising activo");
  Serial.println("[BLE] Service: " + String(BLE_SERVICE_UUID));
  Serial.println("[BLE] TX Write: " + String(BLE_TX_UUID));
  Serial.println("[BLE] RX Notify: " + String(BLE_RX_UUID));
}

// =====================================================
// RadioLib LoRa
// =====================================================
void setFlag() {
  receivedFlag = true;
}

void startReceiveMode() {
#if MESH_HAS_GPS
  digitalWrite(MESH_FEM_ENABLE_PIN, HIGH);
#if MESH_BOARD_PROFILE == 42
  digitalWrite(MESH_FEM_MODE_PIN, LOW); // GC1109 RX: CPS don't-care.
#else
  digitalWrite(MESH_FEM_MODE_PIN, LOW); // KCT8103L: enable RX LNA.
#endif
#endif
  int state = radio.startReceive();

  if (state == RADIOLIB_ERR_NONE) {
    radioReady = true;
  } else {
    Serial.print("[LoRa] Error startReceive: ");
    Serial.println(state);
    radioReady = false;
  }
}

bool loraSend(String payload) {
  if (payload.length() == 0) {
    Serial.println("[LoRa] TX cancelado: payload vacio");
    return false;
  }

  if (payload.length() > MAX_PACKET_BYTES) {
    sizeDroppedPackets++;
    Serial.println("[LoRa] TX cancelado: " + String(payload.length()) +
                   " bytes; maximo " + String(MAX_PACKET_BYTES));
    bleNotifyEvent("txError", "Paquete LoRa demasiado grande: " +
                   String(payload.length()) + "/" + String(MAX_PACKET_BYTES));
    return false;
  }

  txPackets++;

#if MESH_HAS_GPS
  digitalWrite(MESH_FEM_ENABLE_PIN, HIGH);
  digitalWrite(MESH_FEM_MODE_PIN, HIGH); // TX PA path; DIO2 switches automatically.
#endif
  int state = radio.transmit(payload);

  // DIO1 tambien puede activarse por TX_DONE durante transmit(). Si la bandera
  // queda activa, loop() intenta leer un RX inexistente y muestra paquetes
  // vacios o ecos truncados del announce propio.
  receivedFlag = false;

  if (state == RADIOLIB_ERR_NONE) {
    txOk++;
    Serial.println("[LoRa] TX OK");
    startReceiveMode();
    return true;
  }

  txError++;
  Serial.print("[LoRa] TX ERROR. Codigo: ");
  Serial.println(state);
  startReceiveMode();
  return false;
}

// =====================================================
// Paquetes LoRa
// =====================================================
void sendAnnounce() {
  String announce = "__announce__:" + nodeId + "|" + nodeName;

  Serial.println();
  Serial.println("[MESH] Enviando announce:");
  Serial.println(announce);

  bool ok = loraSend(announce);

  if (ok) {
    announcesSent++;
  }
}

void processAnnounce(String packet, float rssi, float snr) {
  String prefix = "__announce__:";

  if (!packet.startsWith(prefix)) {
    return;
  }

  announcesReceived++;

  String data = packet.substring(prefix.length());
  int sep = data.indexOf('|');

  String remoteId = "";
  String remoteName = "";

  if (sep >= 0) {
    remoteId = data.substring(0, sep);
    remoteName = data.substring(sep + 1);
  } else {
    remoteId = data;
    remoteName = data;
  }

  remoteId.trim();
  remoteName.trim();

  if (!isValidRemoteId(remoteId)) {
    corruptedPackets++;
    Serial.println("[MESH] Announce ignorado: remoteId invalido/corrupto -> " + remoteId);
    return;
  }

  if (!isValidNodeName(remoteName)) {
    corruptedPackets++;
    Serial.println("[MESH] Announce ignorado: nodeName invalido/corrupto -> " + remoteName);
    return;
  }

  Serial.println("[MESH] Announce recibido:");
  Serial.println("  remoteId: " + remoteId);
  Serial.println("  remoteName: " + remoteName);
  Serial.println("  localId: " + nodeId);
  Serial.print("  RSSI: ");
  Serial.print(rssi);
  Serial.print(" SNR: ");
  Serial.println(snr);

  upsertNode(remoteId, remoteName, rssi, snr);
}

void sendAck(String to, String ackFor, String nextHop = "", String route = "") {
  StaticJsonDocument<384> doc;

  // Paquete compacto:
  // t=a ACK, i=ackFor, f=from, d=destino final, l=ttl, h=hops,
  // p=lastHop, v=nextHop, r=ruta.
  doc["t"] = "a";
  doc["i"] = ackFor;
  doc["f"] = nodeId;
  doc["d"] = to;
  doc["l"] = DEFAULT_TTL;
  doc["h"] = 0;
  doc["p"] = nodeId;

  if (nextHop.length() > 0) {
    doc["v"] = nextHop;
  }

  if (route.length() > 0) {
    doc["r"] = route;
  }

  String payload;
  serializeJson(doc, payload);

  Serial.println("[ACK] Enviando ACK para: " + ackFor);
  if (nextHop.length() > 0) {
    Serial.println("[ACK] NextHop: " + nextHop);
  }
  Serial.println("[ACK] Bytes: " + String(payload.length()));
  Serial.println(payload);

  bool ok = loraSend(payload);

  if (ok) {
    ackSent++;
    lastPriorityTxAt = millis();
  }
}

void sendMeshMessageDirect(String to, String text, bool sos) {
  SecurityTxMetrics securityMetrics = {};
  securityMetrics.available = true;
  securityMetrics.plaintextSizeBytes = text.length();
  securityMetrics.ciphertextSizeBytes = text.length();
  securityMetrics.encodedCiphertextSizeBytes = text.length();
  sendMeshPayloadDirect(to, text, false, sos, securityMetrics);
}

void sendMeshPayloadDirect(String to, String data, bool encrypted, bool sos, const SecurityTxMetrics &securityMetrics) {
  to.trim();

  if (to == nodeId) {
    Serial.println("[MSG] Envio cancelado: el destino es este mismo nodo");
    bleNotifyEvent("error", "No se puede enviar al mismo nodo");
    return;
  }

  if (!encrypted) {
    data = limitUtf8Bytes(data, MAX_TEXT_BYTES);
  }

  String msgId = createMsgId();
  bool isBroadcast = (to == "broadcast");
  bool needAck = !isBroadcast;

  StaticJsonDocument<512> doc;

  // Paquete compacto:
  // t=m mensaje, i=msgId, f=from, d=destino, x=texto, s=sos, a=ack,
  // l=ttl, h=hops, p=lastHop.
  doc["t"] = "m";
  doc["i"] = msgId;
  doc["f"] = nodeId;
  doc["d"] = to;
  doc["x"] = data;

  if (encrypted) {
    // Use a JSON boolean on the wire. Some ArduinoJson versions do not apply
    // the `| false` fallback to numeric 1 consistently, which can make the
    // receiving app display Base64 ciphertext as if it were plain text.
    doc["e"] = true;
  }

  if (sos) {
    doc["s"] = true;
  }

  if (needAck) {
    doc["a"] = true;
  }

  doc["l"] = DEFAULT_TTL;

  String payload;
  serializeJson(doc, payload);

  if (doc.overflowed()) {
    Serial.println("[MSG] Envio cancelado: buffer JSON insuficiente");
    bleNotifyEvent("txError", "Buffer JSON insuficiente");
    return;
  }

  Serial.println();
  Serial.println("[MSG] Enviando mensaje:");
  Serial.println("[MSG] Bytes: " + String(payload.length()));
  Serial.println(payload);
  recordTxSecurityMetric(msgId, encrypted, securityMetrics, payload.length());

  bool ok = loraSend(payload);
  bleNotifyTxResult(msgId, to, isBroadcast ? "broadcast" : "direct", ok, payload.length(), encrypted);

  if (ok) {
    messagesSent++;
    if (encrypted) encryptedMessagesSent++;
    lastPriorityTxAt = millis();
    scheduleNextAnnounce();

    if (isBroadcast) {
      broadcastSent++;
    } else {
      directMessagesSent++;
      directPathSent++;
      trackPendingAck(msgId, to, encrypted);
    }
  }
}

void sendMeshMessageAuto(String to, String text, bool sos) {
  SecurityTxMetrics securityMetrics = {};
  securityMetrics.available = true;
  securityMetrics.plaintextSizeBytes = text.length();
  securityMetrics.ciphertextSizeBytes = text.length();
  securityMetrics.encodedCiphertextSizeBytes = text.length();
  sendMeshPayloadAuto(to, text, false, sos, securityMetrics);
}

void sendMeshPayloadAuto(String to, String data, bool encrypted, bool sos, const SecurityTxMetrics &securityMetrics) {
  to.trim();

  if (to == "broadcast") {
    sendMeshPayloadDirect(to, data, encrypted, sos, securityMetrics);
    return;
  }

  if (!isValidRemoteId(to)) {
    Serial.println("[MSG] Envio automatico cancelado: destino invalido");
    bleNotifyEvent("error", "Destino invalido");
    return;
  }

  String relay = "";

  if (AUTO_ROUTE_PREFER_RELAY) {
    relay = selectBestRelay(to);
  }

  if (relay.length() > 0) {
    autoRelaySelected++;
    Serial.println("[ROUTE] Relay automatico seleccionado: " + getNodeNameById(relay) + " (" + relay + ")");
    sendMeshPayloadVia(relay, to, data, encrypted, sos, securityMetrics, "auto", "auto");
    return;
  }

  autoRelayNotFound++;
  Serial.println("[ROUTE] Sin relay automatico disponible. Envio directo hacia: " + to);
  sendMeshPayloadDirect(to, data, encrypted, sos, securityMetrics);
}

// Mantiene compatibilidad: el comando send ahora usa enrutamiento automatico.
void sendMeshMessage(String to, String text, bool sos) {
  sendMeshMessageAuto(to, text, sos);
}

void sendMeshMessageVia(String relayNodeId, String finalTo, String text, bool sos, String routeLabel, String modeLabel) {
  SecurityTxMetrics securityMetrics = {};
  securityMetrics.available = true;
  securityMetrics.plaintextSizeBytes = text.length();
  securityMetrics.ciphertextSizeBytes = text.length();
  securityMetrics.encodedCiphertextSizeBytes = text.length();
  sendMeshPayloadVia(relayNodeId, finalTo, text, false, sos, securityMetrics, routeLabel, modeLabel);
}

void sendMeshPayloadVia(String relayNodeId, String finalTo, String data, bool encrypted, bool sos, const SecurityTxMetrics &securityMetrics, String routeLabel, String modeLabel) {
  relayNodeId.trim();
  finalTo.trim();

  if (!encrypted) {
    data = limitUtf8Bytes(data, MAX_TEXT_BYTES);
  }

  if (!isValidRemoteId(relayNodeId) || !isValidRemoteId(finalTo)) {
    Serial.println("[MSG] sendvia cancelado: relay o destino invalido");
    return;
  }

  if (relayNodeId == nodeId || finalTo == nodeId || relayNodeId == finalTo) {
    Serial.println("[MSG] sendvia cancelado: relay/destino no validos para ruta");
    return;
  }

  String msgId = createMsgId();

  StaticJsonDocument<512> doc;

  // Paquete compacto para que entre en LoRa:
  // v = nextHop / relay, r = ruta (auto o via).
  doc["t"] = "m";
  doc["i"] = msgId;
  doc["f"] = nodeId;
  doc["d"] = finalTo;
  doc["x"] = data;

  if (encrypted) {
    doc["e"] = true;
  }

  if (sos) {
    doc["s"] = true;
  }

  doc["a"] = true;
  doc["l"] = DEFAULT_TTL;
  doc["h"] = 0;
  doc["v"] = relayNodeId;
  doc["r"] = routeLabel;

  String payload;
  serializeJson(doc, payload);

  if (doc.overflowed()) {
    Serial.println("[MSG] sendvia cancelado: buffer JSON insuficiente");
    bleNotifyEvent("txError", "Buffer JSON insuficiente");
    return;
  }

  Serial.println();
  Serial.println(modeLabel == "auto" ? "[MSG] Enviando mensaje MULTIHOP AUTOMATICO:" : "[MSG] Enviando mensaje FORZADO VIA RELAY:");
  Serial.println("  relay: " + relayNodeId);
  Serial.println("  destino final: " + finalTo);
  Serial.println("[MSG] Bytes: " + String(payload.length()));
  Serial.println(payload);
  recordTxSecurityMetric(msgId, encrypted, securityMetrics, payload.length());

  bool ok = loraSend(payload);
  bleNotifyTxResult(msgId, finalTo, modeLabel, ok, payload.length(), encrypted);

  if (ok) {
    messagesSent++;
    if (encrypted) encryptedMessagesSent++;
    directMessagesSent++;

    if (modeLabel == "auto") {
      autoMultihopSent++;
    } else {
      forcedMultihopSent++;
    }

    lastPriorityTxAt = millis();
    scheduleNextAnnounce();
    trackPendingAck(msgId, finalTo, encrypted);
  }
}

void forwardMessage(StaticJsonDocument<512> &doc) {
  String msgId = doc["i"] | "";
  String to = doc["d"] | "";
  String route = doc["r"] | "";
  int ttl = doc["l"] | 0;
  int hops = doc["h"] | 0;

  if (ttl <= 0) {
    droppedByTtl++;
    Serial.println("[FWD] Mensaje descartado por TTL agotado: " + msgId);
    return;
  }

  delay(FORWARD_DELAY_MIN_MS + random(0, FORWARD_DELAY_JITTER_MS));

  doc["l"] = ttl - 1;
  doc["h"] = hops + 1;
  doc["p"] = nodeId;

  // En esta ruta de dos saltos, el relay retira nextHop y agrega lastHop.
  // Como v y p contienen IDs del mismo tamano, el paquete no crece.
  if (route == "via" || route == "auto") {
    doc.remove("v");
    doc.remove("nextHop");
  } else {
    doc.remove("v");
    doc.remove("nextHop");
  }

  // Limpieza de campos largos antiguos si llegara un paquete legacy.
  doc.remove("type");
  doc.remove("msgId");
  doc.remove("from");
  doc.remove("fromName");
  doc.remove("to");
  doc.remove("text");
  doc.remove("sos");
  doc.remove("ack");
  doc.remove("ttl");
  doc.remove("hops");
  doc.remove("lastHop");
  doc.remove("nextHop");
  doc.remove("route");

  String payload;
  serializeJson(doc, payload);

  Serial.println();
  Serial.println("[FWD] Reenviando mensaje multihop");
  Serial.println("  msgId: " + msgId);
  Serial.println("  destino final: " + to);
  Serial.println("  ttl: " + String(ttl) + " -> " + String(ttl - 1));
  Serial.println("  hops: " + String(hops) + " -> " + String(hops + 1));
  Serial.println("[FWD] Bytes: " + String(payload.length()));
  Serial.println(payload);

  bool ok = loraSend(payload);

  if (ok) {
    forwardedMessages++;
    lastPriorityTxAt = millis();
    scheduleNextAnnounce();
  }
}

void forwardAck(StaticJsonDocument<512> &doc) {
  String ackFor = doc["i"] | "";
  String to = doc["d"] | "";
  String route = doc["r"] | "";
  int ttl = doc["l"] | 0;
  int hops = doc["h"] | 0;

  if (ttl <= 0) {
    droppedByTtl++;
    Serial.println("[FWD] ACK descartado por TTL agotado: " + ackFor);
    return;
  }

  delay(FORWARD_DELAY_MIN_MS + random(0, FORWARD_DELAY_JITTER_MS));

  doc["l"] = ttl - 1;
  doc["h"] = hops + 1;
  doc["p"] = nodeId;

  if (route == "via" || route == "auto") {
    doc["v"] = to;
  } else {
    doc.remove("v");
    doc.remove("nextHop");
  }

  // Limpieza de campos largos antiguos si llegara un paquete legacy.
  doc.remove("type");
  doc.remove("ackFor");
  doc.remove("from");
  doc.remove("fromName");
  doc.remove("to");
  doc.remove("ttl");
  doc.remove("hops");
  doc.remove("lastHop");
  doc.remove("nextHop");
  doc.remove("route");

  String payload;
  serializeJson(doc, payload);

  Serial.println();
  Serial.println("[FWD] Reenviando ACK multihop");
  Serial.println("  ackFor: " + ackFor);
  Serial.println("  destino final ACK: " + to);
  Serial.println("  ttl: " + String(ttl) + " -> " + String(ttl - 1));
  Serial.println("  hops: " + String(hops) + " -> " + String(hops + 1));
  Serial.println("[FWD] Bytes: " + String(payload.length()));
  Serial.println(payload);

  bool ok = loraSend(payload);

  if (ok) {
    forwardedAcks++;
    lastPriorityTxAt = millis();
    scheduleNextAnnounce();
  }
}

void handleAck(StaticJsonDocument<512> &doc) {
  String to = doc["d"] | "";
  String from = doc["f"] | "";
  String ackFor = doc["i"] | "";
  String lastHop = doc["p"] | "";
  String nextHop = doc["v"] | "";

  touchNode(from, getNodeNameById(from), lastRssi, lastSnr);
  if (lastHop.length() > 0) {
    touchNode(lastHop, getNodeNameById(lastHop), lastRssi, lastSnr);
  }

  if (lastHop == nodeId) {
    selfLoopIgnored++;
    Serial.println("[ACK] Eco propio ignorado");
    return;
  }

  // A matching final recipient may hear the ACK before its relay forwards it.
  // Accept it only for a pending message to that sender; other nodes still
  // respect nextHop. This is evidence of radio receipt, not app decryption.
  bool matchesPendingSender = false;
  for (int i = 0; i < MAX_PENDING_ACKS; i++) {
    if (pendingAcks[i].active && pendingAcks[i].msgId == ackFor && pendingAcks[i].to == from) {
      matchesPendingSender = true;
      break;
    }
  }
  if (!meshAckAllows(to == nodeId, matchesPendingSender, nextHop.length() > 0, nextHop == nodeId)) {
    if (to == nodeId) {
      Serial.println("[ACK] Ignorado: sin mensaje pendiente para ese ID y remitente");
    } else {
      notNextHopIgnored++;
      Serial.println("[ACK] Ignorado: nextHop es " + nextHop + " y este nodo es " + nodeId);
    }
    return;
  }

  String ackSeenKey = "ACK-" + ackFor + "-" + from;

  if (wasSeen(ackSeenKey)) {
    duplicatePackets++;
    Serial.println("[ACK] ACK duplicado descartado: " + ackSeenKey);
    return;
  }

  markSeen(ackSeenKey);

  if (to == nodeId) {
    ackReceived++;

    if (resolvePendingAck(ackFor)) {
      messagesWithAck++;

      Serial.println("[ACK] Recibido desde " + from + " para " + ackFor);
      Serial.println("[ACK] Latencia ultima: " + String(lastLatencyMs) + " ms");
      Serial.println("[ACK] PDR ACK: " + String(getPdrAck(), 2) + "%");
      bleNotifyAckReceived(from, ackFor);
    } else {
      Serial.println("[ACK] Recibido sin pending match: " + ackFor);
    }

    return;
  }

  Serial.println("[ACK] ACK no es para este nodo. Intentando reenviar hacia: " + to);
  forwardAck(doc);
}

void handleMessage(StaticJsonDocument<512> &doc) {
  String msgId = doc["i"] | "";
  String from = doc["f"] | "";
  String fromName = doc["fromName"] | "";
  if (fromName.length() == 0) {
    fromName = getNodeNameById(from);
  }
  String to = doc["d"] | "";
  String data = doc["x"] | "";
  bool encrypted = readJsonFlag(doc["e"]);
  bool sos = doc["s"] | false;
  bool needAck = doc["a"] | false;
  String lastHop = doc["p"] | "";
  String nextHop = doc["v"] | "";
  String route = doc["r"] | "";

  bool isBroadcast = (to == "broadcast");
  bool isForMe = (to == nodeId);

  if (encrypted && data.length() == 0) {
    corruptedPackets++;
    Serial.println("[CRYPTO] Mensaje cifrado descartado: data vacio");
    return;
  }

  touchNode(from, fromName, lastRssi, lastSnr);
  if (lastHop.length() > 0) {
    touchNode(lastHop, getNodeNameById(lastHop), lastRssi, lastSnr);
  }

  if (from == nodeId || lastHop == nodeId) {
    selfLoopIgnored++;
    Serial.println("[MESH] Eco propio de mensaje ignorado: " + msgId);
    return;
  }

  if (!meshNextHopAllows(isForMe, nextHop.length() > 0, nextHop == nodeId)) {
    notNextHopIgnored++;
    Serial.println("[MESH] Mensaje ignorado: nextHop es " + nextHop + " y este nodo es " + nodeId);
    return;
  }

  if (msgId.length() > 0 && wasSeen(msgId)) {
    duplicatePackets++;
    Serial.println("[MESH] Mensaje duplicado descartado: " + msgId);
    // Re-acknowledge a repeated addressed frame without showing it twice.
    if (isForMe && needAck) {
      String ackHop = ((route == "via" || route == "auto") && lastHop.length() > 0)
        ? lastHop : "";
      sendAck(from, msgId, ackHop, route);
    }
    return;
  }

  markSeen(msgId);

  if (isForMe || isBroadcast) {
    messagesReceived++;

    if (isBroadcast) {
      broadcastReceived++;
    } else {
      directMessagesReceived++;

      if (route == "auto") {
        autoMultihopReceived++;
      }
    }

    if (encrypted) {
      encryptedMessagesReceived++;
    }

    Serial.println();
    Serial.println("[MSG] Mensaje recibido");
    Serial.println("  from: " + fromName + " (" + from + ")");
    Serial.println("  to: " + to);
    Serial.println(encrypted ? "  payload: [CIFRADO OPACO]" : "  text: " + data);
    Serial.println("  sos: " + String(sos ? "true" : "false"));
    Serial.println("  lastHop: " + lastHop);
    Serial.println("  route: " + route);

    lastMessageLine = encrypted ? fromName + ": [Cifrado]" : fromName + ": " + data;
    bleNotifyMessageReceived(msgId, from, fromName, to, data, encrypted, sos, isBroadcast, route);

    if (isForMe && needAck && msgId.length() > 0) {
      String ackNextHop = "";

      if ((route == "via" || route == "auto") && lastHop.length() > 0 && lastHop != nodeId) {
        ackNextHop = lastHop;
      }

      sendAck(from, msgId, ackNextHop, route);
    }

    return;
  }

  if ((route == "via" || route == "auto") && nextHop.length() > 0) {
    Serial.println("[MESH] Mensaje no es para este nodo. Activando reenvio multihop.");
    forwardMessage(doc);
  } else {
    notNextHopIgnored++;
    Serial.println("[MESH] Mensaje no es para este nodo. Ignorado sin reenviar.");
  }
}

void processJsonPacket(String packet) {
  packet.trim();

  // Cuando los nodos estan muy cerca o hay colision, a veces el radio escucha
  // un fragmento de un mensaje propio. No debe afectar las metricas de JSON.
  String ownIdPrefix = nodeId;
  if (ownIdPrefix.length() > 6) {
    ownIdPrefix = ownIdPrefix.substring(ownIdPrefix.length() - 6);
  }
  String ownMsgPrefix = "{\"t\":\"m\",\"i\":\"" + ownIdPrefix + "-";
  String ownAckPrefix = "{\"t\":\"a\",\"i\":\"" + ownIdPrefix + "-";

  if (!packet.endsWith("}")) {
    if (packet.startsWith(ownMsgPrefix) || packet.startsWith(ownAckPrefix)) {
      ownEchoIgnored++;
      Serial.println("[LoRa] Fragmento propio/incompleto ignorado");
    } else {
      corruptedPackets++;
      Serial.println("[LoRa] Paquete JSON incompleto descartado");
    }
    return;
  }

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, packet);

  if (error) {
    invalidJsonPackets++;
    Serial.print("[LoRa] JSON invalido: ");
    Serial.println(error.c_str());
    return;
  }

  String type = doc["t"] | "";

  if (type == "a" || type == "ack") {
    handleAck(doc);
    return;
  }

  if (type == "m" || type == "message") {
    // Reuse the packet length already available at this receive boundary.
    lastTransmittedSizeBytes = packet.length();
    handleMessage(doc);
    return;
  }

  Serial.println("[LoRa] Tipo JSON desconocido: " + type);
}

void handleReceivedPacket() {
  receivedFlag = false;

  String packet;
  int state = radio.readData(packet);

  if (state == RADIOLIB_ERR_NONE) {
    rxPackets++;
    lastPacketRxAt = millis();

    if (packet.length() > MAX_PACKET_BYTES) {
      sizeDroppedPackets++;
      Serial.println("[LoRa] RX descartado: paquete supera " +
                     String(MAX_PACKET_BYTES) + " bytes");
      startReceiveMode();
      return;
    }

    float rssi = radio.getRSSI();
    float snr = radio.getSNR();

    lastRssi = rssi;
    lastSnr = snr;

    Serial.println();
    Serial.println("[LoRa] RX:");
    Serial.println(packet);
    Serial.print("[LoRa] RSSI: ");
    Serial.print(rssi);
    Serial.print(" SNR: ");
    Serial.println(snr);

    if (packet.startsWith("__announce__:")) {
      processAnnounce(packet, rssi, snr);
    } else if (packet.startsWith("{")) {
      processJsonPacket(packet);
    } else {
      Serial.println("[LoRa] Paquete desconocido");
    }
  } else {
    Serial.print("[LoRa] RX ERROR. Codigo: ");
    Serial.println(state);
  }

  startReceiveMode();
}

// =====================================================
// Status y comandos Serial
// =====================================================
void printStatus() {
  Serial.println();
  Serial.println("----- STATUS -----");
  Serial.println("Node ID: " + nodeId);
  Serial.println("Node Name: " + nodeName);
  Serial.println("Nodos detectados: " + String(getOnlineNodeCount()) + " / " + String(EXPECTED_NODES));
  Serial.println("RSSI ultimo: " + String(lastRssi));
  Serial.println("SNR ultimo: " + String(lastSnr));
  Serial.println("TX paquetes: " + String(txPackets));
  Serial.println("TX OK: " + String(txOk));
  Serial.println("TX ERROR: " + String(txError));
  Serial.println("RX paquetes: " + String(rxPackets));
  Serial.println("Announces enviados: " + String(announcesSent));
  Serial.println("Announces recibidos: " + String(announcesReceived));
  Serial.println("Mensajes enviados: " + String(messagesSent));
  Serial.println("Mensajes recibidos: " + String(messagesReceived));
  Serial.println("Mensajes cifrados enviados: " + String(encryptedMessagesSent));
  Serial.println("Mensajes cifrados recibidos: " + String(encryptedMessagesReceived));
  Serial.println("Broadcast enviados: " + String(broadcastSent));
  Serial.println("Broadcast recibidos: " + String(broadcastReceived));
  Serial.println("Directos enviados: " + String(directMessagesSent));
  Serial.println("Directos recibidos: " + String(directMessagesReceived));
  Serial.println("Envios directos reales: " + String(directPathSent));
  Serial.println("Multihop automaticos enviados: " + String(autoMultihopSent));
  Serial.println("Multihop automaticos recibidos: " + String(autoMultihopReceived));
  Serial.println("Multihop forzados/debug enviados: " + String(forcedMultihopSent));
  Serial.println("Relays automaticos seleccionados: " + String(autoRelaySelected));
  Serial.println("Relays automaticos no encontrados: " + String(autoRelayNotFound));
  Serial.println("ACK enviados: " + String(ackSent));
  Serial.println("ACK recibidos: " + String(ackReceived));
  Serial.println("Mensajes con ACK: " + String(messagesWithAck));
  Serial.println("ACK timeouts: " + String(ackTimeouts));
  Serial.println("PDR ACK: " + String(getPdrAck(), 2) + "%");
  Serial.println("Latencia ultima: " + String(lastLatencyMs) + " ms");
  Serial.println("Latencia promedio: " + String(getAvgLatency(), 2) + " ms");
  Serial.println("Latencia min/max: " + String(minLatencyMs) + " / " + String(maxLatencyMs) + " ms");
  Serial.println("Modo de seguridad ultimo: " + lastSecurityMode);
  Serial.println("Bytes texto/cifrado/encoded/TX: " +
                 String(lastPlaintextSizeBytes) + " / " +
                 String(lastCiphertextSizeBytes) + " / " +
                 String(lastEncodedCiphertextSizeBytes) + " / " +
                 String(lastTransmittedSizeBytes));
  Serial.println("Overhead AES ultimo: " + String(lastCryptoOverheadBytes) +
                 " bytes (" + String(lastCryptoOverheadPercent, 2) + "%)");
  Serial.println("Cifrado AES ultimo/promedio: " + String(lastEncryptionTimeUs) +
                 " / " + String(getAvgEncryptionTimeUs(), 2) + " us");
  Serial.println("Descifrado AES ultimo/promedio: " + String(lastDecryptionTimeUs) +
                 " / " + String(getAvgDecryptionTimeUs(), 2) + " us");
  Serial.println("Descifrado ultimo/exitos/fallos: " +
                 String(lastDecryptSuccess ? "OK" : "FALLO") + " / " +
                 String(decryptSuccessCount) + " / " + String(decryptFailureCount));
  Serial.println("Modo de seguridad de latencia ultima: " +
                 String(lastLatencySecurityAes128 ? "AES128" : "NONE"));
  Serial.println("Duplicados: " + String(duplicatePackets));
  Serial.println("JSON invalidos: " + String(invalidJsonPackets));
  Serial.println("Paquetes corruptos/incompletos: " + String(corruptedPackets));
  Serial.println("Fragmentos propios ignorados: " + String(ownEchoIgnored));
  Serial.println("Mensajes reenviados: " + String(forwardedMessages));
  Serial.println("ACK reenviados: " + String(forwardedAcks));
  Serial.println("Descartados por TTL: " + String(droppedByTtl));
  Serial.println("Ignorados por nextHop: " + String(notNextHopIgnored));
  Serial.println("Ecos propios ignorados: " + String(selfLoopIgnored));
  Serial.println("Announces pospuestos por guarda: " + String(guardedAnnounceSkips));
  Serial.println("BLE conectado: " + String(bleConnected ? "Si" : "No"));
  Serial.println("BLE comandos recibidos: " + String(bleCommandsReceived));
  Serial.println("BLE notificaciones enviadas: " + String(bleNotificationsSent));
  Serial.println("Ultimo comando BLE: " + lastBleCommand);
  Serial.println("Ultimo mensaje: " + lastMessageLine);
  Serial.println("------------------");

  printNodes();
}

void printHelp() {
  Serial.println();
  Serial.println("----- COMANDOS -----");
  Serial.println("help");
  Serial.println("info");
  Serial.println("status");
  Serial.println("nodes");
  Serial.println("name <nuevo nombre>");
  Serial.println("resetName");
  Serial.println("resetMetrics");
  Serial.println("broadcast <texto>");
  Serial.println("send <indiceNodo> <texto>  // automatico: elige relay si existe");
  Serial.println("sendid <nodeId> <texto>  // automatico: elige relay si existe");
  Serial.println("sendDirect <indiceNodo> <texto>  // debug: sin relay");
  Serial.println("sendvia <relayIndex> <destIndex> <texto>  // debug: relay manual");
  Serial.println("sendidvia <relayNodeId> <destNodeId> <texto>");
  Serial.println("JSON BLE/Serial auto: {\"cmd\":\"send\",\"to\":\"nodeId\",\"text\":\"hola\",\"sos\":false}");
  Serial.println("JSON cifrado: {\"cmd\":\"send\",\"to\":\"nodeId\",\"payload\":{\"encrypted\":true,\"data\":\"M2:BASE64\"}}");
  Serial.println("JSON debug direct: {\"cmd\":\"sendDirect\",\"to\":\"nodeId\",\"text\":\"hola\"}");
  Serial.println("JSON debug via: {\"cmd\":\"sendvia\",\"relay\":\"nodeIdRelay\",\"to\":\"nodeIdFinal\",\"text\":\"hola\"}");
  Serial.println("gps / gps on / gps off (V4 con GPS; no transmite coordenadas por LoRa)");
  Serial.println("health / health on / health off (MAX30102 experimental, solo V4.3.1)");
#if MESH_HAS_MAX30102
  Serial.println("health diag on / health diag off (diagnostico r3 cada 2 s, sin datos fisiologicos)");
#endif
  Serial.println("BLE TX write: " + String(BLE_TX_UUID));
  Serial.println("BLE RX notify: " + String(BLE_RX_UUID));
  Serial.println("La app debe reconstruir notificaciones hasta encontrar \\n.");
  Serial.println("La app tambien puede fragmentar comandos BLE y terminarlos con \\n.");
  Serial.println("Nota: paquetes LoRa usan JSON compacto interno para no superar 240 bytes.");
  Serial.println("Nota: el texto cifrado nunca se trunca; si no cabe, el envio falla.");
  Serial.println("--------------------");
}

void pollGps() {
#if MESH_HAS_GPS
  if (!gpsEnabled || !gpsUartReady) return;
  unsigned budget = 512;
  while (budget-- && gpsSerial.available()) gpsReader.feed(char(gpsSerial.read()), millis());
#endif
}

void setGpsEnabled(bool enabled) {
#if MESH_HAS_GPS
  gpsEnabled = enabled;
  gpsReader.clearFix();
  if (gpsUartReady) gpsSerial.end();
  gpsUartReady = false;
  pinMode(MESH_GPS_POWER_PIN, OUTPUT);
  digitalWrite(MESH_GPS_POWER_PIN, enabled ? LOW : HIGH);
#if MESH_GPS_RESET_PIN >= 0
  pinMode(MESH_GPS_RESET_PIN, OUTPUT);
  digitalWrite(MESH_GPS_RESET_PIN, HIGH);
#endif
#if MESH_GPS_WAKE_PIN >= 0
  pinMode(MESH_GPS_WAKE_PIN, OUTPUT);
  digitalWrite(MESH_GPS_WAKE_PIN, enabled ? HIGH : LOW);
#endif
  if (enabled) {
    gpsSerial.setRxBufferSize(2048);
    gpsSerial.begin(MESH_GPS_BAUD, SERIAL_8N1, MESH_GPS_RX_PIN, MESH_GPS_TX_PIN);
    gpsUartReady = true;
  }
  prefs.putBool("gpsEnabled", enabled);
#else
  gpsEnabled = false;
#endif
}

void sendBleGps(String requestId) {
  pollGps();
  bool fresh = gpsEnabled && gpsReader.fresh(millis());
  StaticJsonDocument<768> doc;
  doc["type"] = "gps";
  doc["nodeId"] = nodeId;
  doc["requestId"] = requestId.substring(0, 64);
  doc["supported"] = bool(MESH_HAS_GPS);
  doc["enabled"] = gpsEnabled;
  doc["hasFix"] = fresh;
  doc["satellites"] = gpsReader.satellites;
  doc["ageMs"] = gpsReader.hasPosition ? long(uint32_t(millis() - gpsReader.lastFixAt)) : -1L;
  if (fresh) {
    doc["latitude"] = gpsReader.latitude;
    doc["longitude"] = gpsReader.longitude;
  } // Never expose stale coordinates as a current fix.
  doc["bytesReceived"] = gpsReader.bytesReceived;
  doc["validSentences"] = gpsReader.validSentences;
  doc["badSentences"] = gpsReader.badSentences;
  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
  Serial.printf("[GPS] supported=%d enabled=%d fix=%d sats=%u bytes=%lu nmea_ok=%lu nmea_bad=%lu\n",
    MESH_HAS_GPS, gpsEnabled, fresh, gpsReader.satellites,
    (unsigned long)gpsReader.bytesReceived, (unsigned long)gpsReader.validSentences,
    (unsigned long)gpsReader.badSentences);
}

void printHealthDiagnostics() {
  MeshHealthSnapshot h = healthSensor.snapshot();
  Serial.printf("[HEALTH] EXP state=%s enabled=%d present=%d samples=%lu resets=%lu i2c=%lu\n",
    h.state, h.enabled, h.present, (unsigned long)h.samples,
    (unsigned long)h.fifoResets, (unsigned long)h.i2cErrors);
#if MESH_HAS_MAX30102
  Serial.printf("[HEALTH-DIAG r3] sda=%d scl=%d addr=0x57 lastFault=%s faultAt=%lu window=%u sampleAgeMs=%ld\n",
    MESH_MAX_SDA_PIN, MESH_MAX_SCL_PIN, h.lastFault, (unsigned long)h.lastFaultAt,
    h.windowSamples, h.sampleSeen ? long(uint32_t(millis() - h.lastSampleAt)) : -1L);
  Serial.printf("[HEALTH-DIAG] configAttempts=%lu configFailures=%lu ambient=%lu fifoOverflow=%lu noSamples=%lu gaps=%lu powerEvents=%lu\n",
    (unsigned long)h.configAttempts, (unsigned long)h.configFailures,
    (unsigned long)h.ambientOverflows, (unsigned long)h.fifoOverflows,
    (unsigned long)h.sampleTimeouts, (unsigned long)h.sampleGaps, (unsigned long)h.powerEvents);
  // Decimal register values; -1 means not observed in the current attempt.
  Serial.printf("[HEALTH-REG] part=%d mode=%d spo2Config=%d fifoConfig=%d status=%d wr=%d ovf=%d rd=%d\n",
    h.partId, h.modeRegister, h.configRegister, h.fifoConfigRegister,
    h.statusRegister, h.fifoWrite, h.fifoOverflow, h.fifoRead);
  Serial.printf("[HEALTH-I2C] lastOp=%s reg=%d wireCode=%d expected=%u received=%u\n",
    h.lastI2cOperation, h.lastI2cRegister, h.lastI2cCode, h.lastI2cExpected, h.lastI2cReceived);
  Serial.printf("[HEALTH-FIFO] verified=%lu failed=%lu limitHits=%lu pausedMode=%d clearWr=%d clearOvf=%d clearRd=%d resumedMode=%d\n",
    (unsigned long)h.fifoResetsVerified, (unsigned long)h.fifoResetFailures,
    (unsigned long)h.recoveryLimitHits, h.pausedMode, h.resetWrite,
    h.resetOverflow, h.resetRead, h.resumedMode);
#endif
}

void sendBleHealth(String requestId) {
  MeshHealthSnapshot health = healthSensor.snapshot();
  uint32_t now = millis();
  bool samplesFresh = health.sampleSeen && uint32_t(now - health.lastSampleAt) <= 500;
  bool fresh = health.enabled && health.present && health.contact && samplesFresh &&
    health.valueSeen && uint32_t(now - health.lastValueAt) <= 2500;
  StaticJsonDocument<2048> doc;
  addTelemetryFields(doc);
  doc["type"] = "health";
  doc["nodeId"] = nodeId;
  doc["requestId"] = requestId.substring(0, 64);
  doc["supported"] = bool(MESH_HAS_MAX30102);
  doc["enabled"] = health.enabled;
  doc["present"] = health.present;
  doc["experimental"] = true;
  doc["diagnosticRevision"] = 3;
  doc["state"] = health.state;
  doc["contact"] = health.contact && samplesFresh;
  doc["heartRateValid"] = fresh && health.heartValid;
  doc["spo2Valid"] = fresh && health.spo2Valid;
  if (fresh && health.heartValid) doc["heartRateBpm"] = health.heartRate;
  if (fresh && health.spo2Valid) doc["spo2Percent"] = health.spo2;
  doc["ageMs"] = health.valueSeen ? long(uint32_t(now - health.lastValueAt)) : -1L;
  doc["sampleAgeMs"] = health.sampleSeen ? long(uint32_t(now - health.lastSampleAt)) : -1L;
  if (health.enabled && samplesFresh) {
    doc["red"] = health.red;
    doc["infrared"] = health.infrared;
  }
  doc["windowSamples"] = health.windowSamples;
  doc["samplesReceived"] = health.samples;
  doc["fifoResets"] = health.fifoResets;
  doc["i2cErrors"] = health.i2cErrors;
  doc["sdaPin"] = MESH_MAX_SDA_PIN;
  doc["sclPin"] = MESH_MAX_SCL_PIN;
  doc["configAttempts"] = health.configAttempts;
  doc["configFailures"] = health.configFailures;
  doc["ambientOverflows"] = health.ambientOverflows;
  doc["fifoOverflows"] = health.fifoOverflows;
  doc["sampleTimeouts"] = health.sampleTimeouts;
  doc["sampleGaps"] = health.sampleGaps;
  doc["powerEvents"] = health.powerEvents;
  doc["fifoResetsVerified"] = health.fifoResetsVerified;
  doc["fifoResetFailures"] = health.fifoResetFailures;
  doc["recoveryLimitHits"] = health.recoveryLimitHits;
  doc["lastFault"] = health.lastFault;
  doc["lastFaultAt"] = health.lastFaultAt;
  doc["lastI2cOperation"] = health.lastI2cOperation;
  doc["lastI2cRegister"] = health.lastI2cRegister;
  doc["lastI2cCode"] = health.lastI2cCode;
  doc["lastI2cExpected"] = health.lastI2cExpected;
  doc["lastI2cReceived"] = health.lastI2cReceived;
  doc["partId"] = health.partId;
  doc["modeRegister"] = health.modeRegister;
  doc["configRegister"] = health.configRegister;
  doc["fifoConfigRegister"] = health.fifoConfigRegister;
  doc["statusRegister"] = health.statusRegister;
  doc["fifoWrite"] = health.fifoWrite;
  doc["fifoOverflow"] = health.fifoOverflow;
  doc["fifoRead"] = health.fifoRead;
  doc["resetWrite"] = health.resetWrite;
  doc["resetOverflow"] = health.resetOverflow;
  doc["resetRead"] = health.resetRead;
  doc["pausedMode"] = health.pausedMode;
  doc["resumedMode"] = health.resumedMode;
  if (doc.overflowed()) {
    // Fail closed: do not send an incomplete physiological snapshot.
    bleNotifyEvent("error", "Health JSON capacity exceeded");
    return;
  }
  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
  // Deliberately no health values on the automatic serial status or LoRa.
}

bool handleHealthCommand(StaticJsonDocument<768> &doc) {
  String cmd = doc["cmd"] | "";
  if (cmd != "health" && cmd != "setHealth") return false;
  if (cmd == "setHealth") {
    if (!MESH_HAS_MAX30102 || !doc["enabled"].is<bool>() ||
        !healthSensor.setEnabled(doc["enabled"].as<bool>())) {
      bleNotifyEvent("error", "MAX30102 no disponible o enabled invalido");
      return true;
    }
  }
  sendBleHealth(doc["requestId"] | "");
  return true;
}

bool handleGpsCommand(StaticJsonDocument<768> &doc) {
  String cmd = doc["cmd"] | "";
  if (cmd != "gps" && cmd != "setGps") return false;
  if (cmd == "setGps") {
    if (!MESH_HAS_GPS || !doc["enabled"].is<bool>()) {
      bleNotifyEvent("error", "GPS no soportado o enabled no es booleano");
      return true;
    }
    setGpsEnabled(doc["enabled"].as<bool>());
  }
  sendBleGps(doc["requestId"] | "");
  return true;
}

void handleJsonCommand(String input) {
  StaticJsonDocument<768> doc;
  DeserializationError error = deserializeJson(doc, input);

  if (error) {
    Serial.print("[CMD] JSON invalido: ");
    Serial.println(error.c_str());
    return;
  }

  String cmd = doc["cmd"] | "";

  if (handleGpsCommand(doc)) return;
  if (handleHealthCommand(doc)) return;
  if (cmd == "info") {
    Serial.println("[INFO] Node ID: " + nodeId);
    Serial.println("[INFO] Node Name: " + nodeName);
  } else if (cmd == "status") {
    printStatus();
  } else if (cmd == "nodes") {
    printNodes();
  } else if (cmd == "setName") {
    String newName = doc["name"] | "";
    setNodeName(newName);
  } else if (cmd == "resetName") {
    resetNodeName();
  } else if (cmd == "resetMetrics") {
    resetMetrics();
  } else if (cmd == "broadcast") {
    String data;
    bool encrypted;
    SecurityTxMetrics securityMetrics;
    if (!extractCommandPayload(doc, data, encrypted, securityMetrics)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadAuto("broadcast", data, encrypted, sos, securityMetrics);
  } else if (cmd == "sendDirect") {
    String to = doc["to"] | "broadcast";
    String data;
    bool encrypted;
    SecurityTxMetrics securityMetrics;
    if (!extractCommandPayload(doc, data, encrypted, securityMetrics)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadDirect(to, data, encrypted, sos, securityMetrics);
  } else if (cmd == "send") {
    String to = doc["to"] | "broadcast";
    String data;
    bool encrypted;
    SecurityTxMetrics securityMetrics;
    if (!extractCommandPayload(doc, data, encrypted, securityMetrics)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadAuto(to, data, encrypted, sos, securityMetrics);
  } else if (cmd == "sendvia") {
    String relay = doc["relay"] | "";
    String to = doc["to"] | "";
    String data;
    bool encrypted;
    SecurityTxMetrics securityMetrics;
    if (!extractCommandPayload(doc, data, encrypted, securityMetrics)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadVia(relay, to, data, encrypted, sos, securityMetrics);
  } else if (cmd == "cryptoMetric") {
    recordDecryptionMetric(doc);
  } else {
    Serial.println("[CMD] Comando JSON desconocido: " + cmd);
  }
}

void dispatchBleCommand(String input) {
  input.trim();

  if (input.length() == 0) {
    return;
  }

  MeshCommand queued = {};
  input.toCharArray(queued.text, sizeof(queued.text));
  if (!commandQueue || xQueueSend(commandQueue, &queued, 0) != pdTRUE) commandQueueOverflow = true;
}

void handleBleWriteChunk(String chunk) {
  if (bleCommandBuffer.length() + chunk.length() > MAX_BLE_COMMAND_BYTES) {
    bleCommandBuffer = "";
    Serial.println("[BLE] Comando descartado: buffer excedido");
    commandBufferOverflow = true;
    return;
  }

  bleCommandBuffer += chunk;

  int newlineAt = bleCommandBuffer.indexOf('\n');
  while (newlineAt >= 0) {
    String complete = bleCommandBuffer.substring(0, newlineAt);
    bleCommandBuffer = bleCommandBuffer.substring(newlineAt + 1);
    dispatchBleCommand(complete);
    newlineAt = bleCommandBuffer.indexOf('\n');
  }

  String candidate = bleCommandBuffer;
  candidate.trim();

  if (candidate.length() == 0) {
    bleCommandBuffer = "";
    return;
  }

  // Conserva compatibilidad con comandos cortos sin salto de linea.
  if (!candidate.startsWith("{")) {
    bleCommandBuffer = "";
    dispatchBleCommand(candidate);
    return;
  }

  // Para JSON fragmentado, espera hasta cerrar correctamente todas las llaves.
  if (isCompleteJsonObject(candidate)) {
    bleCommandBuffer = "";
    dispatchBleCommand(candidate);
  }
}

void handleBleCommand(String input) {
  input.trim();

  if (input.length() == 0) {
    return;
  }

  if (!input.startsWith("{")) {
    handleSerialCommand(input);
    return;
  }

  StaticJsonDocument<768> doc;
  DeserializationError error = deserializeJson(doc, input);

  if (error) {
    bleNotifyEvent("error", String("JSON invalido: ") + error.c_str());
    Serial.print("[BLE] JSON invalido: ");
    Serial.println(error.c_str());
    return;
  }

  String cmd = doc["cmd"] | "";
  MeshRequestScope requestScope(String(doc["requestId"] | ""));
  if (handleGpsCommand(doc)) return;
  if (handleHealthCommand(doc)) return;
  if (cmd == "info") {
    sendBleInfo();
  } else if (cmd == "status") {
    sendBleStatus();
  } else if (cmd == "nodes") {
    sendBleNodes();
  } else if (cmd == "setName") {
    String newName = doc["name"] | "";
    setNodeName(newName);
  } else if (cmd == "resetName") {
    resetNodeName();
  } else if (cmd == "resetMetrics") {
    resetMetrics();
  } else if (cmd == "broadcast") {
    String data;
    bool encrypted;
    SecurityTxMetrics securityMetrics;
    if (!extractCommandPayload(doc, data, encrypted, securityMetrics)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadAuto("broadcast", data, encrypted, sos, securityMetrics);
  } else if (cmd == "sendDirect") {
    String to = doc["to"] | "broadcast";
    String data;
    bool encrypted;
    SecurityTxMetrics securityMetrics;
    if (!extractCommandPayload(doc, data, encrypted, securityMetrics)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadDirect(to, data, encrypted, sos, securityMetrics);
  } else if (cmd == "send") {
    String to = doc["to"] | "broadcast";
    String data;
    bool encrypted;
    SecurityTxMetrics securityMetrics;
    if (!extractCommandPayload(doc, data, encrypted, securityMetrics)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadAuto(to, data, encrypted, sos, securityMetrics);
  } else if (cmd == "sendvia") {
    String relay = doc["relay"] | "";
    String to = doc["to"] | "";
    String data;
    bool encrypted;
    SecurityTxMetrics securityMetrics;
    if (!extractCommandPayload(doc, data, encrypted, securityMetrics)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadVia(relay, to, data, encrypted, sos, securityMetrics);
  } else if (cmd == "cryptoMetric") {
    recordDecryptionMetric(doc);
  } else {
    bleNotifyEvent("error", "Comando BLE desconocido: " + cmd);
    Serial.println("[BLE] Comando desconocido: " + cmd);
  }
}

void handleSerialCommand(String input) {
  input.trim();

  if (input.length() == 0) return;

  if (input.startsWith("{")) {
    handleJsonCommand(input);
    return;
  }

  if (input == "help") {
    printHelp();
    return;
  }

  if (input == "gps") { sendBleGps(); return; }
  if (input == "health") {
    sendBleHealth();
    printHealthDiagnostics();
    return;
  }
#if MESH_HAS_MAX30102
  if (input == "health diag on" || input == "health diag off") {
    healthDiagnosticSerial = input == "health diag on";
    Serial.printf("[HEALTH-DIAG r3] stream=%s (solo diagnostico; no activa el sensor)\n",
      healthDiagnosticSerial ? "on" : "off");
    printHealthDiagnostics();
    return;
  }
#endif
  if (input == "health on" || input == "health off") {
    if (!healthSensor.setEnabled(input == "health on")) {
      Serial.println("[HEALTH] MAX30102 no disponible en este perfil");
    }
    sendBleHealth();
    return;
  }
  if (input == "gps on" || input == "gps off") {
    if (!MESH_HAS_GPS) { Serial.println("[GPS] Perfil V3 sin GPS"); return; }
    setGpsEnabled(input == "gps on");
    sendBleGps();
    return;
  }

  if (input == "info") {
    Serial.println("[INFO] Node ID: " + nodeId);
    Serial.println("[INFO] Node Name: " + nodeName);
    return;
  }

  if (input == "status") {
    printStatus();
    return;
  }

  if (input == "nodes") {
    printNodes();
    return;
  }

  if (input == "resetName") {
    resetNodeName();
    return;
  }

  if (input == "resetMetrics") {
    resetMetrics();
    return;
  }

  if (input.startsWith("name ")) {
    String newName = input.substring(5);
    setNodeName(newName);
    return;
  }

  if (input.startsWith("broadcast ")) {
    String text = input.substring(10);
    sendMeshMessage("broadcast", text, false);
    return;
  }

  if (input.startsWith("sendDirect ")) {
    String rest = input.substring(11);
    int sep = rest.indexOf(' ');

    if (sep < 0) {
      Serial.println("[CMD] Uso: sendDirect <indiceNodo> <texto>");
      return;
    }

    int index = rest.substring(0, sep).toInt();
    String text = rest.substring(sep + 1);
    String to = getNodeIdByIndex(index);

    if (to.length() == 0) {
      Serial.println("[CMD] Indice de nodo invalido. Usa el comando nodes.");
      return;
    }

    sendMeshMessageDirect(to, text, false);
    return;
  }

  if (input.startsWith("sendidvia ")) {
    String rest = input.substring(10);
    int sep1 = rest.indexOf(' ');

    if (sep1 < 0) {
      Serial.println("[CMD] Uso: sendidvia <relayNodeId> <destNodeId> <texto>");
      return;
    }

    String relay = rest.substring(0, sep1);
    String rest2 = rest.substring(sep1 + 1);
    int sep2 = rest2.indexOf(' ');

    if (sep2 < 0) {
      Serial.println("[CMD] Uso: sendidvia <relayNodeId> <destNodeId> <texto>");
      return;
    }

    String to = rest2.substring(0, sep2);
    String text = rest2.substring(sep2 + 1);
    sendMeshMessageVia(relay, to, text, false);
    return;
  }

  if (input.startsWith("sendvia ")) {
    String rest = input.substring(8);
    int sep1 = rest.indexOf(' ');

    if (sep1 < 0) {
      Serial.println("[CMD] Uso: sendvia <relayIndex> <destIndex> <texto>");
      return;
    }

    int relayIndex = rest.substring(0, sep1).toInt();
    String rest2 = rest.substring(sep1 + 1);
    int sep2 = rest2.indexOf(' ');

    if (sep2 < 0) {
      Serial.println("[CMD] Uso: sendvia <relayIndex> <destIndex> <texto>");
      return;
    }

    int destIndex = rest2.substring(0, sep2).toInt();
    String text = rest2.substring(sep2 + 1);

    String relay = getNodeIdByIndex(relayIndex);
    String to = getNodeIdByIndex(destIndex);

    if (relay.length() == 0 || to.length() == 0) {
      Serial.println("[CMD] Indices invalidos. Usa el comando nodes.");
      return;
    }

    sendMeshMessageVia(relay, to, text, false);
    return;
  }

  if (input.startsWith("sendid ")) {
    String rest = input.substring(7);
    int sep = rest.indexOf(' ');

    if (sep < 0) {
      Serial.println("[CMD] Uso: sendid <nodeId> <texto>");
      return;
    }

    String to = rest.substring(0, sep);
    String text = rest.substring(sep + 1);
    sendMeshMessage(to, text, false);
    return;
  }

  if (input.startsWith("send ")) {
    String rest = input.substring(5);
    int sep = rest.indexOf(' ');

    if (sep < 0) {
      Serial.println("[CMD] Uso: send <indiceNodo> <texto>");
      return;
    }

    int index = rest.substring(0, sep).toInt();
    String text = rest.substring(sep + 1);
    String to = getNodeIdByIndex(index);

    if (to.length() == 0) {
      Serial.println("[CMD] Indice de nodo invalido. Usa el comando nodes.");
      return;
    }

    sendMeshMessage(to, text, false);
    return;
  }

  Serial.println("[CMD] Comando desconocido. Escribe help.");
}

void handleSerialInput() {
  static String serialBuffer;
  static bool discard = false;
  unsigned budget = 256;
  while (budget-- && Serial.available()) {
    char c = char(Serial.read());
    if (c == '\r') continue;
    if (c == '\n') {
      if (!discard) handleSerialCommand(serialBuffer);
      serialBuffer = "";
      discard = false;
    } else if (!discard) {
      if (serialBuffer.length() < MAX_BLE_COMMAND_BYTES) serialBuffer += c;
      else { serialBuffer = ""; discard = true; Serial.println("[CMD] Linea demasiado larga"); }
    }
  }
}

void initBoardHardware() {
#if MESH_HAS_GPS
  pinMode(MESH_FEM_POWER_PIN, OUTPUT);
  digitalWrite(MESH_FEM_POWER_PIN, HIGH);
  pinMode(MESH_FEM_ENABLE_PIN, OUTPUT);
  digitalWrite(MESH_FEM_ENABLE_PIN, HIGH);
  pinMode(MESH_FEM_MODE_PIN, OUTPUT);
  digitalWrite(MESH_FEM_MODE_PIN, LOW);
  delay(2); // Power the FEM before SX1262 image calibration.
#endif
  uint8_t *storage = nullptr;
#if MESH_HAS_GPS
  storage = static_cast<uint8_t *>(heap_caps_malloc(
    MESH_COMMAND_QUEUE_SIZE * sizeof(MeshCommand), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
#endif
  if (storage) commandQueue = xQueueCreateStatic(MESH_COMMAND_QUEUE_SIZE, sizeof(MeshCommand), storage, &commandQueueControl);
  else commandQueue = xQueueCreate(MESH_COMMAND_QUEUE_SIZE, sizeof(MeshCommand));
  if (!commandQueue) {
    Serial.println("[SYS] ERROR: no se pudo reservar la cola BLE");
    while (true) delay(1000);
  }
}

void processQueuedCommand() {
  if (commandQueueOverflow || commandBufferOverflow) {
    commandQueueOverflow = commandBufferOverflow = false;
    ++commandQueueDrops;
    bleNotifyEvent("txError", "Cola BLE llena o comando demasiado grande; vuelve a intentar");
  }
  MeshCommand queued;
  if (xQueueReceive(commandQueue, &queued, 0) == pdTRUE) {
    ++bleCommandsReceived;
    // Do not log decrypted text, coordinates, ciphertext, or crypto keys.
    lastBleCommand = "Comando BLE procesado";
    handleBleCommand(String(queued.text));
  }
}

// =====================================================
// Setup / Loop
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("=================================");
  Serial.println("CAPA 5.1 - BLE APP + MULTIHOP AUTOMATICO + ACK");
  Serial.println(String("MeshLink 5.6.0 / RadioLib + ") + MESH_BOARD_NAME);
#if MESH_HAS_MAX30102
  Serial.println("[HEALTH-DIAG r3] MAX30102 FIFO r2 + metadatos BLE para registro local; sin envio automatico LoRa");
#endif
  Serial.println("Sin Mcu.begin / Sin licencia Heltec");
  Serial.println("=================================");

  initOled();
  setupIdentity();
  char bootBuffer[33];
  snprintf(bootBuffer, sizeof(bootBuffer), "%08lx%08lx%08lx%08lx",
    (unsigned long)esp_random(), (unsigned long)esp_random(),
    (unsigned long)esp_random(), (unsigned long)esp_random());
  bootId = bootBuffer;
  initBoardHardware();
  setGpsEnabled(MESH_HAS_GPS && prefs.getBool("gpsEnabled", true));
  initBle();
  randomSeed((uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFF));
  scheduleNextAnnounce();

  drawScreen("LoRa Mesh", "Identidad OK", nodeName, nodeId.substring(0, 16));

  Serial.println("[SPI] Iniciando SPI...");
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);

  Serial.println("[LoRa] Iniciando SX1262...");

  int state = radio.begin(
    LORA_FREQ,
    LORA_BW,
    LORA_SF,
    LORA_CR,
    LORA_SYNC_WORD,
    LORA_POWER,
    LORA_PREAMBLE,
    MESH_TCXO_VOLTAGE
  );

  if (state == RADIOLIB_ERR_NONE) {
    Serial.println("[LoRa] SX1262 iniciado correctamente");
    drawScreen("LoRa Mesh", "Radio OK", "Esperando nodos", "");
  } else {
    Serial.print("[LoRa] Error al iniciar. Codigo: ");
    Serial.println(state);
    drawScreen("LoRa Mesh", "LoRa ERROR", "Code: " + String(state), "");

    while (true) {
      delay(1000);
    }
  }

  radio.setDio1Action(setFlag);
  // DIO2 drives the onboard RF switch / FEM TX-RX selection on V3 and V4.
  state = radio.setDio2AsRfSwitch(true);
  if (state != RADIOLIB_ERR_NONE) Serial.printf("[LoRa] RF switch error: %d\n", state);
  startReceiveMode();

  healthSensor.begin(); // OFF at every boot, even if it was enabled previously.
  Serial.println("[SYS] Setup completo");
  printHelp();
  updateDisplay();
}

void loop() {
  pollGps();
  if (receivedFlag) {
    handleReceivedPacket();
  }

  handleSerialInput();
  checkAckTimeouts();
  // Handle at most one queued BLE frame per pass, after pending radio RX.
  processQueuedCommand();
  pollGps();

  if (bleConnected != oldBleConnected) {
    oldBleConnected = bleConnected;

    if (bleConnected) {
      sendBleReady();
      sendBleInfo();
      sendBleNodes();
      sendBleStatus();
      sendBleGps();
      sendBleHealth();
    }
  }

  unsigned long now = millis();
#if MESH_HAS_MAX30102
  static unsigned long lastHealthDiagnosticAt = 0;
  if (healthDiagnosticSerial && uint32_t(now - lastHealthDiagnosticAt) >= 2000) {
    lastHealthDiagnosticAt = now;
    printHealthDiagnostics();
  }
#endif
  static unsigned long lastHealthAt = 0;
  if (bleConnected && MESH_HAS_MAX30102) {
    // Full diagnostics only need 1 Hz while acquiring. Avoid increasing idle
    // BLE framing load during network trials when the sensor is disabled.
    const uint32_t interval = healthSensor.snapshot().enabled ? 1000 : 10000;
    if (uint32_t(now - lastHealthAt) >= interval) {
      lastHealthAt = now;
      sendBleHealth();
    }
  }

  if ((long)(now - nextAnnounceAt) >= 0) {
    bool quietAfterTx = (now - lastPriorityTxAt) > TX_GUARD_AFTER_MESSAGE_MS;
    bool quietAfterRx = (now - lastPacketRxAt) > RX_GUARD_BEFORE_ANNOUNCE_MS;

    if (quietAfterTx && quietAfterRx) {
      sendAnnounce();
      scheduleNextAnnounce();
    } else {
      guardedAnnounceSkips++;
      nextAnnounceAt = now + 1000 + random(0, 1000);
      Serial.println("[MESH] Announce pospuesto para evitar colision");
    }
  }

  pruneNodes();

  static unsigned long lastStatus = 0;
  if (millis() - lastStatus >= 5000) {
    lastStatus = millis();
    printStatus();
    updateDisplay();

    if (bleConnected && millis() - lastBleStatusAt >= BLE_STATUS_INTERVAL_MS) {
      lastBleStatusAt = millis();
      sendBleStatus();
      sendBleGps();
    }
  }
}
