# Firmware: V3 y V4

Fuente actual **5.6.1**, protocolo de mensajería **5.1**. No se usa firmware
Meshtastic/MeshCore aunque el anuncio comercial diga que la placa los soporta.

## Una fuente, perfiles separados

El sketch canónico está en `firmware/`. No existen dos copias independientes
del código V3/V4 que haya que mantener sincronizadas. Los perfiles seleccionan
capacidades y las carpetas de salida separan binarios/cachés.

| Opción del script | Perfil | Hardware/capacidades |
| --- | --- | --- |
| `V3` | 3 | Heltec V3; mensajería/repetidor; sin GPS ni MAX del nodo |
| `V4_2` | 42 | GC1109; configuración preparada, no extrapolar el GPS probado en V4.3 |
| `V4_3` | 43 | V4.3/4.3.1 KCT8103L, L76K del kit probado y MAX opcional |
| `V4_R8` | 48 | Otra variante; Vext/alimentación GPS distintos |

El usuario compró dos kits **V4.3.1, Screen With GPS, 863-928 MHz**. Las fotos
permitieron identificar serigrafía V4.3 y Quectel L76K. El perfil adecuado es
`V4_3`, no R8. V3 sigue formando parte de la red mixta con RF/protocolo compatibles.

## Archivos que se conservan juntos

- [firmware.ino](../../firmware/firmware.ino): BLE, LoRa, comandos y contadores.
- [board_profile.h](../../firmware/board_profile.h): pines/capacidades por perfil.
- [gps_hardware.h](../../firmware/gps_hardware.h): arranque GPS no bloqueante V4_3.
- [nmea_gps.h](../../firmware/nmea_gps.h): checksum, posición y vigencia NMEA.
- [routing_policy.h](../../firmware/routing_policy.h): aceptación de rutas/ACK.
- [max30102_sensor.h](../../firmware/max30102_sensor.h): adquisición y recuperación.
- [health_signal.h](../../firmware/health_signal.h): ventana y validez técnica.

Las pestañas adicionales de Arduino IDE son esos encabezados. Para un amigo,
compartir la carpeta completa `firmware`, no solo el `.ino`. Confirmar perfil
y opciones; la selección V4 exige perfil explícito. Usar preferentemente el
script de compilación para evitar una selección ambigua.

## Entorno y radio

Entorno local revisado: core Heltec ESP32 3.3.8; RadioLib 7.8.1;
ArduinoJson 7.4.3; U8g2 2.36.19; SparkFun MAX3010x 1.1.2 para V4_3.
No actualizar librerías automáticamente como paso de diagnóstico.

Radio conservado: 915 MHz, BW 125 kHz, SF7, CR 4/5, sync 0x12,
preámbulo 8, TTL 3 y espera ACK de 8000 ms. La excitación SX1262 inicial
es 14 dBm en V3 y 0 en V4. **No es potencia radiada calibrada del FEM**;
no pasar 28 dBm a `SX1262::begin()` ni afirmar alcance/consumo por ese número.
La revisión y el cumplimiento RF deben verificarse para el lugar de uso.

V3 mantiene 10 nodos/30 IDs/10 pendientes/cola 4. V4 tiene
20/128/20/cola 8 y puede utilizar PSRAM. No convierte el protocolo en una
red de capacidad ilimitada.

## Compilar sin cargar

Desde la raíz, con el core/librerías ya instalados:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\build-firmware.ps1 -Board V4_3 -Jobs 2 -ConfigFile "C:\Users\Yohamin\.arduinoIDE\arduino-cli.yaml"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\build-firmware.ps1 -Board V3 -Jobs 2 -ConfigFile "C:\Users\Yohamin\.arduinoIDE\arduino-cli.yaml"
```

Salidas: `firmware/build/V4_3/` y `firmware/build/V3/`. Están excluidas de Git.
Los paquetes antiguos de `experimental/` son instantáneas, no fuentes actuales.

## Cargar manualmente

1. Conectar antena LoRa y alimentación adecuada.
2. Confirmar placa y puerto actual; COM4 y COM10 fueron valores históricos,
   no una garantía para la próxima conexión.
3. Cerrar el monitor serie.
4. Añadir `-Port PUERTO_REAL` al comando del perfil correcto. Sustituir ese
   marcador por el nombre real; con `-Port` el script sí compila y carga.
5. No borrar toda la flash/NVS como primer paso. No cruzar binarios V3/V4.
6. Monitor a 115200: verificar `MeshLink 5.6.1` y nombre de placa.

Arduino IDE: mantener sketch/headers juntos; para V4_3 seleccionar WiFi LoRa
32 (V4), flash 16 MB, PSRAM habilitada, CDC al arrancar habilitado y FEM
KCT8103L. En una copia del sketch para IDE puede definirse
`MESH_BOARD_PROFILE 43` antes de los includes. No cambiar la fuente compartida
a V4 por defecto y romper V3 inadvertidamente.

## Pruebas y límites

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\tests\run-tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\tests\run-health-tests.ps1
```

Pasaron en la corrección 5.6.1; ver [estado](01_CONTEXTO_Y_ESTADO_ACTUAL.md).
No se repitieron para esta documentación. Compilar/simular no mide potencia,
autonomía, alcance ni aceptación física completa de la red.

Comandos útiles del principal: `help`, `info`, `status`, `nodes`,
`gps`, `gps on`, `gps off`, `health`, `health on`, `health off`,
`health diag on`, `health diag off`. No confundirlos con `r/m/?` del
diagnóstico GPS aislado.

Detalle: [Guía V4/GPS](../V4_GPS.md) y [protocolo BLE/LoRa](../FIRMWARE_PROTOCOL.md).
