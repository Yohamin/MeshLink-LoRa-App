#pragma once

// Explicit profiles: 3=V3, 42=V4.2 GC1109, 43=V4.3 KCT8103L, 48=V4-R8.
// Never guess a V4 revision from the MCU: R2 boards share the same chip.
#ifndef MESH_BOARD_PROFILE
#if defined(ARDUINO_HELTEC_WIFI_LORA_32_V4) || defined(HELTEC_WIFI_LORA_32_V4)
#error "Select MESH_BOARD_PROFILE=42, 43 or 48; use build-firmware.ps1 -Board."
#else
#define MESH_BOARD_PROFILE 3
#endif
#endif

#if MESH_BOARD_PROFILE == 3
#define MESH_BOARD_NAME "Heltec V3"
#define MESH_HAS_GPS 0
#define VEXT_PIN 36
#define MAX_NODES 10
#define MAX_SEEN_MESSAGES 30
#define MAX_PENDING_ACKS 10
#define MESH_COMMAND_QUEUE_SIZE 4
#elif MESH_BOARD_PROFILE == 42 || MESH_BOARD_PROFILE == 43 || MESH_BOARD_PROFILE == 48
#define MESH_HAS_GPS 1
#define MAX_NODES 20
#define MAX_SEEN_MESSAGES 128
#define MAX_PENDING_ACKS 20
#define MESH_COMMAND_QUEUE_SIZE 8
#define MESH_FEM_POWER_PIN 7
#define MESH_FEM_ENABLE_PIN 2
#if MESH_BOARD_PROFILE == 42
#define MESH_BOARD_NAME "Heltec V4.2 / GC1109"
#define MESH_FEM_MODE_PIN 46
#else
#define MESH_BOARD_NAME "Heltec V4.3 / KCT8103L"
#define MESH_FEM_MODE_PIN 5
#endif
#if MESH_BOARD_PROFILE == 48
#undef MESH_BOARD_NAME
#define MESH_BOARD_NAME "Heltec V4-R8 / KCT8103L"
#define VEXT_PIN 40
#define MESH_GPS_POWER_PIN 42
#define MESH_GPS_RESET_PIN -1
#define MESH_GPS_WAKE_PIN -1
#else
#define VEXT_PIN 36
#define MESH_GPS_POWER_PIN 34
#define MESH_GPS_RESET_PIN 42
#define MESH_GPS_WAKE_PIN 40
#endif
// ESP32 UART direction, not the direction named on the GPS module.
#ifndef MESH_GPS_RX_PIN
#define MESH_GPS_RX_PIN 38
#endif
#ifndef MESH_GPS_TX_PIN
#define MESH_GPS_TX_PIN 39
#endif
#else
#error "Unsupported MeshLink board profile."
#endif

#ifndef MESH_GPS_BAUD
#define MESH_GPS_BAUD 9600
#endif
// Experimental MAX30102 support is prepared only for the selected V4.3/4.3.1.
// Capability does not mean the module is attached; acquisition is OFF at boot.
#define MESH_HAS_MAX30102 (MESH_BOARD_PROFILE == 43)
#ifndef MESH_MAX_SDA_PIN
#define MESH_MAX_SDA_PIN 4
#endif
#ifndef MESH_MAX_SCL_PIN
#define MESH_MAX_SCL_PIN 6
#endif
#ifndef MESH_MAX_CONTACT_IR_MIN
#define MESH_MAX_CONTACT_IR_MIN 5000u
#endif
#if MESH_BOARD_PROFILE == 3
#define MESH_TCXO_VOLTAGE 1.6f // Preserve the working V3 RadioLib default.
#else
#define MESH_TCXO_VOLTAGE 1.8f
#endif
// This is the SX1262 drive setting, NOT calibrated antenna output on V4.
// Conservative initial setting; do not pass 28 to SX1262::begin().
#ifndef MESH_RADIO_DRIVE_DBM
#if MESH_BOARD_PROFILE == 3
#define MESH_RADIO_DRIVE_DBM 14
#else
#define MESH_RADIO_DRIVE_DBM 0
#endif
#endif
static_assert(MESH_RADIO_DRIVE_DBM >= -9 && MESH_RADIO_DRIVE_DBM <= 22,
              "SX1262 drive must be -9..22 dBm; V4 external FEM adds gain.");
