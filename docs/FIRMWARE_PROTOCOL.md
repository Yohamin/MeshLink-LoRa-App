# Firmware protocol 5.1

## BLE transport

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
{"cmd":"send","to":"N-CAFE00000002","payload":{"encrypted":true,"data":"BASE64"},"sos":false}
```

The normal `send` command lets the firmware choose a relay. `sendDirect` and `sendvia` are intentionally reserved for diagnostics.

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

