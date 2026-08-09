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

// =====================================================
// LoRa Mesh - Capa 5.1
// Heltec WiFi LoRa 32 V3 + RadioLib
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
#define VEXT_PIN 36

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
#define LORA_POWER     14
#define LORA_PREAMBLE  8

// =====================
// Limites
// =====================
#define MAX_NODES 10
#define EXPECTED_NODES 2
#define NODE_TIMEOUT_MS 90000

#define MAX_TEXT_BYTES 40
#define MAX_PACKET_BYTES 240
#define MAX_BLE_COMMAND_BYTES 768
#define MAX_SEEN_MESSAGES 30
#define MAX_PENDING_ACKS 10

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

// =====================
// Identidad
// =====================
Preferences prefs;

String nodeId = "";
String nodeName = "";

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
  bool active;
};

PendingAck pendingAcks[MAX_PENDING_ACKS];

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
void sendMeshPayloadDirect(String to, String data, bool encrypted, bool sos);
void sendMeshPayloadAuto(String to, String data, bool encrypted, bool sos);
void sendMeshPayloadVia(String relayNodeId, String finalTo, String data, bool encrypted, bool sos, String routeLabel = "via", String modeLabel = "via");
bool extractCommandPayload(StaticJsonDocument<512> &doc, String &data, bool &encrypted);

class MeshBleServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) {
    bleConnected = true;
    Serial.println("[BLE] App conectada");
  }

  void onDisconnect(BLEServer *server) {
    bleConnected = false;
    bleCommandBuffer = "";
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
//    {"cmd":"send","to":"N-...","payload":{"encrypted":true,"data":"BASE64"}}
// 2) Compatible:
//    {"cmd":"send","to":"N-...","encrypted":true,"data":"BASE64"}
// 3) Texto existente:
//    {"cmd":"send","to":"N-...","text":"hola"}
//
// El firmware nunca descifra ni altera data. En LoRa se usan las claves
// compactas x=data y e=1 para ahorrar bytes.
bool extractCommandPayload(StaticJsonDocument<512> &doc, String &data, bool &encrypted) {
  data = "";
  encrypted = false;

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
void trackPendingAck(String msgId, String to) {
  for (int i = 0; i < MAX_PENDING_ACKS; i++) {
    if (!pendingAcks[i].active) {
      pendingAcks[i].msgId = msgId;
      pendingAcks[i].to = to;
      pendingAcks[i].sentAt = millis();
      pendingAcks[i].active = true;
      return;
    }
  }

  pendingAcks[0].msgId = msgId;
  pendingAcks[0].to = to;
  pendingAcks[0].sentAt = millis();
  pendingAcks[0].active = true;
}

bool resolvePendingAck(String ackFor) {
  for (int i = 0; i < MAX_PENDING_ACKS; i++) {
    if (pendingAcks[i].active && pendingAcks[i].msgId == ackFor) {
      unsigned long latency = millis() - pendingAcks[i].sentAt;
      updateLatencyStats(latency);

      pendingAcks[i].active = false;
      pendingAcks[i].msgId = "";
      pendingAcks[i].to = "";
      pendingAcks[i].sentAt = 0;

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

      ackTimeouts++;
      bleNotifyAckTimeout(timeoutMsgId, timeoutTo);
    }
  }
}

void resetMetrics() {
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

  messageCounter = 0;
  lastMessageLine = "Sin mensajes";

  for (int i = 0; i < MAX_PENDING_ACKS; i++) {
    pendingAcks[i].msgId = "";
    pendingAcks[i].to = "";
    pendingAcks[i].sentAt = 0;
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
  doc["message"] = message;
  doc["nodeId"] = nodeId;
  doc["nodeName"] = nodeName;

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void sendBleInfo() {
  StaticJsonDocument<384> doc;
  doc["type"] = "info";
  doc["nodeId"] = nodeId;
  doc["nodeName"] = nodeName;
  doc["bleConnected"] = bleConnected;
  doc["layer"] = "5.1";
  doc["radio"] = "SX1262-RadioLib";

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void sendBleReady() {
  StaticJsonDocument<512> doc;
  doc["type"] = "ready";
  doc["nodeId"] = nodeId;
  doc["nodeName"] = nodeName;
  doc["serviceUuid"] = BLE_SERVICE_UUID;
  doc["txUuid"] = BLE_TX_UUID;
  doc["rxUuid"] = BLE_RX_UUID;
  doc["commands"] = "info,status,nodes,setName,resetName,resetMetrics,send,broadcast,sendDirect,sendvia(debug)";

  String payload;
  serializeJson(doc, payload);
  bleNotifyLine(payload);
}

void sendBleStatus() {
  StaticJsonDocument<1536> doc;

  doc["type"] = "status";
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
  DynamicJsonDocument doc(4096);
  doc["type"] = "nodes";
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
  sendMeshPayloadDirect(to, text, false, sos);
}

void sendMeshPayloadDirect(String to, String data, bool encrypted, bool sos) {
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
      trackPendingAck(msgId, to);
    }
  }
}

void sendMeshMessageAuto(String to, String text, bool sos) {
  sendMeshPayloadAuto(to, text, false, sos);
}

void sendMeshPayloadAuto(String to, String data, bool encrypted, bool sos) {
  to.trim();

  if (to == "broadcast") {
    sendMeshPayloadDirect(to, data, encrypted, sos);
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
    sendMeshPayloadVia(relay, to, data, encrypted, sos, "auto", "auto");
    return;
  }

  autoRelayNotFound++;
  Serial.println("[ROUTE] Sin relay automatico disponible. Envio directo hacia: " + to);
  sendMeshPayloadDirect(to, data, encrypted, sos);
}

// Mantiene compatibilidad: el comando send ahora usa enrutamiento automatico.
void sendMeshMessage(String to, String text, bool sos) {
  sendMeshMessageAuto(to, text, sos);
}

void sendMeshMessageVia(String relayNodeId, String finalTo, String text, bool sos, String routeLabel, String modeLabel) {
  sendMeshPayloadVia(relayNodeId, finalTo, text, false, sos, routeLabel, modeLabel);
}

void sendMeshPayloadVia(String relayNodeId, String finalTo, String data, bool encrypted, bool sos, String routeLabel, String modeLabel) {
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
    trackPendingAck(msgId, finalTo);
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

  if (nextHop.length() > 0 && nextHop != nodeId) {
    notNextHopIgnored++;
    Serial.println("[ACK] Ignorado: nextHop es " + nextHop + " y este nodo es " + nodeId);
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

  if (nextHop.length() > 0 && nextHop != nodeId) {
    notNextHopIgnored++;
    Serial.println("[MESH] Mensaje ignorado: nextHop es " + nextHop + " y este nodo es " + nodeId);
    return;
  }

  if (msgId.length() > 0 && wasSeen(msgId)) {
    duplicatePackets++;
    Serial.println("[MESH] Mensaje duplicado descartado: " + msgId);
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
  Serial.println("JSON cifrado: {\"cmd\":\"send\",\"to\":\"nodeId\",\"payload\":{\"encrypted\":true,\"data\":\"BASE64\"}}");
  Serial.println("JSON debug direct: {\"cmd\":\"sendDirect\",\"to\":\"nodeId\",\"text\":\"hola\"}");
  Serial.println("JSON debug via: {\"cmd\":\"sendvia\",\"relay\":\"nodeIdRelay\",\"to\":\"nodeIdFinal\",\"text\":\"hola\"}");
  Serial.println("BLE TX write: " + String(BLE_TX_UUID));
  Serial.println("BLE RX notify: " + String(BLE_RX_UUID));
  Serial.println("La app debe reconstruir notificaciones hasta encontrar \\n.");
  Serial.println("La app tambien puede fragmentar comandos BLE y terminarlos con \\n.");
  Serial.println("Nota: paquetes LoRa usan JSON compacto interno para no superar 240 bytes.");
  Serial.println("Nota: el texto cifrado nunca se trunca; si no cabe, el envio falla.");
  Serial.println("--------------------");
}

void handleJsonCommand(String input) {
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, input);

  if (error) {
    Serial.print("[CMD] JSON invalido: ");
    Serial.println(error.c_str());
    return;
  }

  String cmd = doc["cmd"] | "";

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
    if (!extractCommandPayload(doc, data, encrypted)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadAuto("broadcast", data, encrypted, sos);
  } else if (cmd == "sendDirect") {
    String to = doc["to"] | "broadcast";
    String data;
    bool encrypted;
    if (!extractCommandPayload(doc, data, encrypted)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadDirect(to, data, encrypted, sos);
  } else if (cmd == "send") {
    String to = doc["to"] | "broadcast";
    String data;
    bool encrypted;
    if (!extractCommandPayload(doc, data, encrypted)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadAuto(to, data, encrypted, sos);
  } else if (cmd == "sendvia") {
    String relay = doc["relay"] | "";
    String to = doc["to"] | "";
    String data;
    bool encrypted;
    if (!extractCommandPayload(doc, data, encrypted)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadVia(relay, to, data, encrypted, sos);
  } else {
    Serial.println("[CMD] Comando JSON desconocido: " + cmd);
  }
}

void dispatchBleCommand(String input) {
  input.trim();

  if (input.length() == 0) {
    return;
  }

  bleCommandsReceived++;
  lastBleCommand = input.substring(0, 80);

  Serial.println();
  Serial.println("[BLE] Comando completo recibido:");
  Serial.println(input);

  handleBleCommand(input);
}

void handleBleWriteChunk(String chunk) {
  if (bleCommandBuffer.length() + chunk.length() > MAX_BLE_COMMAND_BYTES) {
    bleCommandBuffer = "";
    Serial.println("[BLE] Comando descartado: buffer excedido");
    bleNotifyEvent("error", "Comando BLE demasiado grande");
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

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, input);

  if (error) {
    bleNotifyEvent("error", String("JSON invalido: ") + error.c_str());
    Serial.print("[BLE] JSON invalido: ");
    Serial.println(error.c_str());
    return;
  }

  String cmd = doc["cmd"] | "";

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
    if (!extractCommandPayload(doc, data, encrypted)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadAuto("broadcast", data, encrypted, sos);
  } else if (cmd == "sendDirect") {
    String to = doc["to"] | "broadcast";
    String data;
    bool encrypted;
    if (!extractCommandPayload(doc, data, encrypted)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadDirect(to, data, encrypted, sos);
  } else if (cmd == "send") {
    String to = doc["to"] | "broadcast";
    String data;
    bool encrypted;
    if (!extractCommandPayload(doc, data, encrypted)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadAuto(to, data, encrypted, sos);
  } else if (cmd == "sendvia") {
    String relay = doc["relay"] | "";
    String to = doc["to"] | "";
    String data;
    bool encrypted;
    if (!extractCommandPayload(doc, data, encrypted)) return;
    bool sos = doc["sos"] | false;
    sendMeshPayloadVia(relay, to, data, encrypted, sos);
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
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    handleSerialCommand(input);
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
  Serial.println("RadioLib + Heltec WiFi LoRa 32 V3");
  Serial.println("Sin Mcu.begin / Sin licencia Heltec");
  Serial.println("=================================");

  initOled();
  setupIdentity();
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
    LORA_PREAMBLE
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
  startReceiveMode();

  Serial.println("[SYS] Setup completo");
  printHelp();
  updateDisplay();
}

void loop() {
  if (receivedFlag) {
    handleReceivedPacket();
  }

  handleSerialInput();
  checkAckTimeouts();

  if (bleConnected != oldBleConnected) {
    oldBleConnected = bleConnected;

    if (bleConnected) {
      sendBleReady();
      sendBleInfo();
      sendBleNodes();
      sendBleStatus();
    }
  }

  unsigned long now = millis();

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
    }
  }
}
