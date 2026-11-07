# GPS-DIAG r2

Diagnóstico aislado para Heltec WiFi LoRa 32 V4.3/4.3.1 y Quectel L76K.

Abrir `gps_v4_l76k.ino` conservando `gps_diagnostic_core.h` en la misma carpeta.
En Arduino IDE, cerrar y volver a abrir el sketch si todavía se ve r1.

Arranca en modo medición: GPS ordenado ON, GPIO40/42 como entradas con pull-up
interno débil, sin UART TX ni salida HIGH fuerte en esos controles. Solo el
pulso de reset utiliza una salida open-drain LOW. No puentear pines a 3,3 V.

- Monitor serie: 115200 baudios, USB CDC al arrancar habilitado.
- `r`: alimentación/reset y barrido UART, igual que r1 pero con pull-ups débiles.
- `m`: detiene la UART y mantiene los controles estables para medir.
- `?`: estado; `[CTRL r2]` informa niveles digitales, no voltajes.
- Antes de conectar o retirar el GPS: desconectar USB y batería. Comparar las
  lecturas de GPIO34/40/42 con y sin GPS, alimentando de nuevo cada vez.

**Cargar este sketch sustituye temporalmente MeshLink.** No se carga ninguna placa automáticamente. No usar con V3 o V4-R8.

Consultar la [guía de uso, interpretación y restauración](../../docs/DIAGNOSTICO_GPS_L76K.md) antes de cargar.
