# MeshLink

MeshLink is an offline-first emergency messenger for the Heltec WiFi LoRa 32 V3 firmware protocol 5.1. A phone connects to its local ESP32 over BLE, while direct, broadcast, and automatic relay messages travel over LoRa.

## Included in this MVP

- BLE discovery and connection for devices advertised as `LoRaMesh-*`
- Firmware UUIDs, 180-byte BLE chunking, and newline-delimited JSON framing
- Direct and one-hop-relayed messaging through the firmware `send` command
- Direct-range broadcasts
- SOS presets and optional GPS coordinates
- AES-256-GCM authenticated encryption performed on the phone
- Persistent local conversations and delivery states from `sent`, `ack`, and `ackTimeout`
- Node presence, RSSI/SNR, and radio diagnostics
- Node naming and secure network-key settings
- Browser demo adapter for UI testing without physical hardware

## Requirements

- Node.js 22.13 or newer
- Android 7 or newer, or iOS 16.4 or newer
- A native Expo development build; Expo Go cannot load `react-native-ble-plx`
- Heltec firmware using protocol layer 5.1 and the BLE UUIDs in `src/constants/mesh.ts`

## Run

```bash
npm install
npm run android
```

For the browser demo:

```bash
npm run web
```

For a distributable Android test APK, install EAS CLI and run:

```bash
npx eas build --profile preview --platform android
```

## Field-test warning

The bundled prototype network key is intentionally easy to identify. Change it on every participating phone before a field test. All users in the same encrypted network must enter the same key.

The current firmware does not provide store-and-forward, generalized multi-hop routing, mesh-wide broadcast forwarding, automatic retry, or real radio-level SOS preemption. The app reports these limitations honestly in its status and delivery language.

