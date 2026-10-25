# Firmware protocol 5.1

## Optional 5.6 physiological snapshot extension

Firmware 5.6.0 retains the r2 acquisition/FIFO recovery and radio protocol.
V4 health BLE snapshots add bootId, uptimeMs, metricsEpoch and diagnostic
revision 3 plus checked sensor counters/registers. They remain opt-in and are
not automatically sent over LoRa. App 1.4.0 records only in explicitly opened
MAX30102 sessions, separately from network trials.

Manual physiological sharing is a <=32-byte ASCII application text:
`H1:<epoch-seconds-base36-7>:<HR-or-dash>:<SpO2-or-dash>:<N|A|B>:<reference-hex-6>`.
N=no declaration; A=person requests help; B=person reports feeling well.
No code is a medical classification. A sets the existing SOS flag only after
user confirmation. All such sends require AES-128-GCM and a non-demo shared
key. Plaintext H1 reports are rejected by the new receiving app.

Both apps should be 1.4.0 to display structured reports. Any compatible V3
may receive/relay an opaque report; only V4_3 acquires this sensor. The
reference is a short local-session hint, not global identity/authentication.
The clock is declared by the sender, not synchronized or proof of current
condition. BLE submission, radio ACK and remote human attention are distinct;
broadcast is direct-range without ACK. See [Mediciones MAX30102](MEDICIONES_MAX30102.md).

## Optional 5.5 coordinated trial extension

Firmware 5.5.0 advertises `info.snapshotCorrelation: true` and echoes the
active BLE command's `requestId` in info/nodes/status through `addTelemetryFields`.
The phone uses these exact responses for baseline/final snapshots. App 1.3
records only within a trial, not continuously while merely connected.

Both phones must keep the Ensayos screen visible. The source sends a reserved
`E1:S:<12-hex-id>:100:<2-digit-pause-seconds>` text; the receiver persists its
baseline and then sends `E1:R:<id>`. Only then are the 100 existing `T:` data
texts transmitted. Source completion uses `E1:F:<id>:<attempts-3>:<tx-ok-3>:C`;
receiver persists final snapshots/end and responds `E1:D:<id>:<unique-rx-3>`.
`E1:X:<id>` is a best-effort stop. `I` is a partial finish marker accepted by
the codec; current cancellation uses STOP and does not claim complete counts.
Controls fit 32 UTF-8 bytes and use the existing optional message encryption.
They are not new LoRa packet fields and are excluded from the 100-data metrics.
Their traffic remains in the node's cumulative counters.

Node ACK is not receiver-app readiness/persistence confirmation. If READY or
SAVED is missing, the app never reports coordinated success. Each endpoint
exports its own trial-scoped data under the same run ID and its own node/boot ID.
No offline replay, physical flash journal or global clock synchronization is added.
See [PRUEBAS_Y_METRICAS.md](PRUEBAS_Y_METRICAS.md).

## Optional 5.4 telemetry / field-test extension

Firmware source 5.4.0 adds `bootId` (random 128-bit hex ID for this boot),
`uptimeMs` (64-bit monotonic milliseconds), `metricsEpoch` and `nodeId` to
info/ready/status/nodes/sent/message/ack/ackTimeout and generic BLE events.
`metricsEpoch` increments on explicit reset; a reconnect does not change boot ID.
`info` / `ready` advertise `requestCorrelation: true`; info includes `ackTimeoutMs`.
`sent` and synchronous command errors echo optional `requestId` (max 64 chars).
ACKs correlate through their existing firmware message ID, not current command ID.
Message RX additionally reports serialized radio `bytes`; ACK adds its RSSI/SNR.
Status includes `commandQueueDrops` alongside the existing metrics.

No new LoRa fields or radio-side batch command are added. The phone runs the
foreground-only sequential test and persists BLE-observed metrics by boot.
No flash journal/offline event replay is implemented in the node. See
[PRUEBAS_Y_METRICAS.md](PRUEBAS_Y_METRICAS.md) for coverage and metric definitions.

## Optional 5.2 hardware / GPS extension

Firmware 5.2 retains the 5.1 LoRa wire format and BLE UUIDs. See
[V4_GPS.md](V4_GPS.md) for board profiles and hardware acceptance tests.
`info` additionally reports `board`, `firmwareVersion`, `gpsSupported`,
`maxNodes`, `sx1262DriveDbm` and `freePsramBytes`.

Commands: `{"cmd":"gps","requestId":"optional-id"}` and
`{"cmd":"setGps","enabled":true,"requestId":"optional-id"}`.
Reply type `gps`: `nodeId`, echoed `requestId` (max 64 characters),
`supported`, `enabled`, `hasFix`, `satellites`, `ageMs`, `bytesReceived`,
`validSentences`, `badSentences`. `latitude` and `longitude` are included only
for a valid position decoded within the last 10 seconds. `ageMs` measures
time since the firmware decoded that NMEA position, not absolute GNSS UTC
measurement age. A request reads GNSS state; it does not
send a LoRa packet. The app encrypts the explicitly requested SOS location
using its existing messaging flow when encryption is enabled.

## BLE transport

### Optional 5.3 MAX30102 extension

Firmware source 5.3.0 keeps LoRa wire format 5.1. `info.healthSupported`
is true only for board profile 43. See [MAX30102_V4.md](MAX30102_V4.md).

Commands: `{"cmd":"health","requestId":"optional-id"}` and
`{"cmd":"setHealth","enabled":true,"requestId":"optional-id"}`.
The sensor is OFF at every boot; the setting is not persisted. The response
acknowledges the requested enable state, not successful sensor detection.
Poll subsequent state to confirm presence and sampling.

Reply `type: "health"`: `nodeId`, optional echoed `requestId`, `supported`,
`enabled`, `present`, `experimental: true`, `state`, `contact`,
`heartRateValid`, `spo2Valid`, `ageMs`, `sampleAgeMs`, `windowSamples`,
`samplesReceived`, `fifoResets`, `i2cErrors`, `sdaPin`, `sclPin`.
`heartRateBpm` / `spo2Percent` are present only when their independent
validity flags and freshness guards pass. Raw `red` and `infrared` are
included only for enabled, recent sampling. Negative ages mean unavailable.
Ages measure firmware processing time, not a clinical measurement timestamp.

An unsolicited update is sent at BLE connection and approximately every
second while connected on profile 43. It uses existing JSON framing. No
health payload is automatically sent over LoRa or stored by the app. BLE
does not gain authentication or encryption from the phone-side LoRa key.

These are experimental estimates, not medical measurements or alarms.

## BLE framing

- Service: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
- App-to-node write: `beb5483e-36e1-4688-b7f5-ea07361b26a8`
- Node-to-app read/notify: `beb5483e-36e1-4688-b7f5-ea07361b26a9`
- Requested MTU: 185
- Application chunk size: 180 bytes
- Encoding: UTF-8 JSON terminated by `\n`

The app must join notification chunks until a newline and must split large commands without separating UTF-8 bytes incorrectly.

## Commands used by MeshLink

```json
{"cmd":"info"}
{"cmd":"nodes"}
{"cmd":"status"}
{"cmd":"setName","name":"Rescue Team"}
{"cmd":"broadcast","text":"I AM SAFE","sos":true}
{"cmd":"send","to":"N-CAFE00000002","text":"HELLO","sos":false}
{"cmd":"send","to":"N-CAFE00000002","payload":{"encrypted":true,"data":"M2:BASE64"},"sos":false}
```

The normal `send` command lets the firmware choose a relay. `sendDirect` and `sendvia` are intentionally reserved for diagnostics.

The firmware treats encrypted data as opaque text. `M2:` identifies AES-128-GCM payloads generated by the current app; legacy unprefixed payloads use AES-256-GCM. The app, not the firmware, selects the key size and performs encryption/decryption.

## Security measurements

AES remains phone-side. The app measures only the `gcm(...).encrypt()` or `gcm(...).decrypt()` call with its high-resolution clock, then reports the result through the existing BLE command channel. Measurement metadata is never inserted into the LoRa packet.

The existing `status.metrics` object is extended with:

- `securityModeAes128`: `1` for the most recent AES-128 sample, otherwise `0`
- `plaintextSizeBytes`: UTF-8 plaintext size
- `ciphertextSizeBytes`: raw nonce + ciphertext + authentication tag size
- `encodedCiphertextSizeBytes`: `M2:` + Base64 size
- `transmittedSizeBytes`: existing final serialized LoRa packet size
- `cryptoOverheadBytes` / `cryptoOverheadPercent`: raw cryptographic overhead relative to plaintext
- `lastEncryptionTimeUs` / `avgEncryptionTimeUs` / `encryptionTimeSamples`
- `lastDecryptionTimeUs` / `avgDecryptionTimeUs` / `decryptionTimeSamples`
- `decryptSuccess` / `decryptSuccessCount` / `decryptFailureCount`
- `latencySecurityModeAes128`: security mode associated with the existing last ACK-latency sample

Per-message Serial output uses the existing firmware message ID:

```text
[SECURITY] msg_id=ABCDEF-12345678-0001 security_mode=AES128 plaintext_size_bytes=12 ciphertext_size_bytes=40 encoded_ciphertext_size_bytes=59 transmitted_size_bytes=151 crypto_overhead_bytes=28 crypto_overhead_percent=233.33 encryption_time_us=184
[SECURITY] msg_id=ABCDEF-12345678-0001 security_mode=AES128 decryption_time_us=96 decrypt_success=true plaintext_size_bytes=12 ciphertext_size_bytes=40 encoded_ciphertext_size_bytes=59
[SECURITY] msg_id=ABCDEF-12345678-0001 security_mode=AES128 latency_ms=842
```

For AES-GCM, the raw 28-byte overhead is the 12-byte nonce plus 16-byte tag. GCM does not add padding. Base64 and `M2:` are encoding overhead; the difference between `transmittedSizeBytes` and `encodedCiphertextSizeBytes` is mesh/JSON protocol overhead.

The existing ACK latency timer is unchanged. It measures the firmware's current post-transmission ACK wait and is tagged by security mode for offline comparison; encryption and decryption computation times are reported separately.

For a controlled comparison, reset metrics, disable **Cifrado autenticado** in the app, send the test messages, and save the Serial output. Reset metrics again, enable AES-128-GCM, repeat the identical messages and physical setup, then compare samples grouped by `security_mode`. Do not change SF, bandwidth, coding rate, TX power, routing, relay placement, ACK timeout, or message text between runs.

## Notifications handled by MeshLink

- `ready`: BLE service and supported-command metadata
- `info`: local node ID, name, layer, and radio
- `nodes`: detected-node array with state, RSSI, SNR, and last-seen age
- `status`: radio, BLE, routing, ACK, latency, and packet metrics
- `sent`: local radio transmission result and firmware message ID
- `message`: direct or broadcast message received
- `ack`: recipient node acknowledged a direct message
- `ackTimeout`: no ACK was observed within eight seconds
- `nameUpdated`: persistent node name changed
- `error` / `txError`: command or radio failure

## App delivery-state mapping

| Firmware evidence | App state |
| --- | --- |
| Local message saved, command not yet confirmed | Queued |
| `sent` with `ok: true` | Sent |
| Matching `ack` | Delivered |
| Matching `ackTimeout` | Unconfirmed |
| `sent` with `ok: false`, BLE exception, or `txError` | Failed |

Broadcasts remain at **Sent** because the firmware does not request acknowledgements for them.

## Limits reflected in the UI

- LoRa packet: 240 bytes maximum
- Plain text: 40 UTF-8 bytes maximum
- MeshLink encrypted text: 32 UTF-8 bytes maximum, reserving room for AES-GCM and relay metadata
- Known-node table: 10 nodes
- Pending ACK table: 10 messages
- ACK timeout: 8 seconds
- Default TTL: 3
- Active node: seen within 30 seconds
- Offline node: not seen for 90 seconds
