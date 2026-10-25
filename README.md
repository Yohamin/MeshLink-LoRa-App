# MeshLink

MeshLink is an offline-first emergency messenger for the Heltec WiFi LoRa 32 V3/V4 using firmware protocol 5.1. A phone connects to its local ESP32 over BLE, while direct, broadcast, and automatic relay messages travel over LoRa.

## Emergency support — app 1.4.1 / firmware 5.6.0

Local opt-in sessions, CSV/JSON export and manually confirmed encrypted
direct/broadcast reports are implemented. The screen prioritizes the person's
declared condition (needs help, discomfort, feels well), measurement availability
and manually confirmed sharing. See [Mediciones MAX30102](docs/MEDICIONES_MAX30102.md)
for build steps, consent, storage limits and physical validation still required.
This experimental device does not classify a person as medically well/unwell.
The 1.4.1 ARM64 APK has been compiled locally; physical two-phone acceptance
testing remains pending. APKs, firmware binaries, build caches and local signing
keys are excluded from this source repository. Build instructions are below.
Update both phones to 1.4.1 to interpret the new discomfort declaration.

For libraries, resolved versions and exact metric definitions, see
[Detalle técnico y métricas](docs/DETALLE_TECNICO_Y_METRICAS.md).

## Included in this MVP

- BLE discovery and connection for devices advertised as `LoRaMesh-*`
- Firmware UUIDs, 180-byte BLE chunking, and newline-delimited JSON framing
- Direct and one-hop-relayed messaging through the firmware `send` command
- Direct-range broadcasts
- SOS presets and optional GPS coordinates
- AES-128-GCM authenticated encryption performed on the phone
- Backward-compatible decryption of historical AES-256-GCM messages
- Persistent local conversations and delivery states from `sent`, `ack`, and `ackTimeout`
- Node presence, RSSI/SNR, and radio diagnostics
- Node naming and secure network-key settings
- Browser demo adapter for UI testing without physical hardware

## Requirements

- Node.js 22.13 or newer
- Android 7 or newer, or iOS 16.4 or newer
- A native build (development or standalone release); Expo Go cannot load `react-native-ble-plx`
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

For a local standalone ARM64 test APK on the configured Windows environment:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-android-release.ps1
```

Output: `android/app/build/outputs/apk/release/app-release.apk`. This script
uses the configured Android SDK/JBR paths and local test signing. Review those
paths on another computer; this is not production signing.

Alternatively, for an EAS Android preview build, install EAS CLI and run:

```bash
npx eas build --profile preview --platform android
```

## Field-test warning

The bundled prototype network key is intentionally easy to identify. Change it on every participating phone before a field test. All users in the same encrypted network must enter the same key.

New encrypted payloads use the `M2:` marker and AES-128-GCM. Updated apps can still decrypt legacy unprefixed AES-256-GCM payloads, but older app builds cannot decrypt new `M2:` messages. Update every participating phone before the next field test.

The current firmware does not provide store-and-forward, generalized multi-hop routing, mesh-wide broadcast forwarding, automatic retry, or real radio-level SOS preemption. The app reports these limitations honestly in its status and delivery language.

## Heltec V4 + GPS preparation

The shared firmware now includes explicit V3, V4.2, V4.3 and V4-R8 profiles,
GPS state over BLE and user-triggered SOS coordinates from the V4 receiver.
V3 retains phone-provided location. See [the V4/GPS guide](docs/V4_GPS.md)
before selecting a profile or flashing; board revision, RF band and GNSS
hardware must be confirmed, and physical interoperability testing is required.

## Optional MAX30102 on V4.3 / V4.3.1

Firmware 5.6.0 and app 1.4.1 include an experimental MAX30102 integration on
profile `V4_3`, disabled at every boot. Acquisition is local/BLE; sharing a
compact report over LoRa requires explicit confirmation in the phone. V3 does not
enable this sensor. See [the wiring and validation guide](docs/MAX30102_V4.md).
Confirm the breakout's VIN rating and I2C voltage before powering it. Pulse
and SpO₂ estimates are not clinically validated and must not guide medical
decisions on their own. Older 5.2 firmware binaries and the 1.1.4 APK do not
include it. Physical acceptance tests remain required.

## Persistent telemetry and 100-message field tests

To build the complete experimental package (APK + V3 + V4.3.1 + verification
logs/hashes/guides), run `generar-paquete-experimental.ps1` in regular Windows
PowerShell. See [the experimental setup checklist](docs/INICIO_EXPERIMENTAL.md).
The generator never labels partial/stale binaries as a complete package.

Open **Red → Ensayos · emisor y receptor** on both phones. Firmware 5.6 identifies
each boot and correlates snapshots; app 1.4.1 starts scoped recording only when
requesting/accepting a trial. The receiver persists its baseline before READY;
100 sequential unicast data messages then wait for ACK/timeout and a pause.
The receiver confirms saved final results separately from radio ACK. Both phones
retain their own CSV/JSON-ready journal under the same trial ID. It stops on
screen exit/background/disconnect and never resumes automatically. This is not
autonomous node-side recording: details without BLE cannot be recovered. See
[the test guide and definitions](docs/PRUEBAS_Y_METRICAS.md).
