# MeshLink 5.2: red mixta Heltec V3 / V4 con GPS

Esta versión conserva el protocolo LoRa 5.1, los UUID BLE, el formato `M2:`
AES-128-GCM y los nombres guardados. El cifrado sigue en el teléfono: el
repetidor transporta el contenido sin descifrarlo. No sustituye el proyecto
por Meshtastic ni MeshCore.

Abrir el sketch desde su carpeta completa: además de `firmware.ino`, necesita
`board_profile.h`, `nmea_gps.h`, `routing_policy.h`, `max30102_sensor.h` y
`health_signal.h`. No copiar solamente el
archivo `.ino` a otra carpeta.

La base GPS descrita aquí corresponde a 5.2. La fuente actual 5.3 añade un
MAX30102 opcional únicamente al perfil `V4_3`: ver [MAX30102_V4.md](MAX30102_V4.md).
Los binarios anteriores 5.2 no contienen esa integración. Sus resultados de
compilación anteriores no validan el firmware nuevo.

## Perfiles de hardware

### Variante del pedido de Yohamin

La captura del anuncio y la opción seleccionada proporcionadas por el usuario
indican **WiFi LoRa 32 V4.3.1, 2PCS Screen With GPS, 863–928 MHz**. El perfil
que corresponde a esa descripción es `V4_3`, no `V4_R8` ni `V4_2`.
La frecuencia existente de MeshLink, 915 MHz, está dentro de la banda indicada
del equipo y se conserva igual en V3 y V4. La configuración RF debe coincidir
en todos los nodos; no se modifica automáticamente al cambiar de placa.

El receptor GNSS exacto no se distingue en la captura. Los 9600 baudios son
una configuración inicial que debe confirmarse con la etiqueta del receptor
y los contadores NMEA. Comprobar también la serigrafía de las placas recibidas
antes de cargar: una captura del anuncio no sustituye la inspección del equipo.

| Parámetro de compilación | Hardware | FEM | Vext | Alimentación GNSS |
| --- | --- | --- | ---: | ---: |
| `V3` | WiFi LoRa 32 V3 | Sin FEM externo de V4 | GPIO36 | No gestionada |
| `V4_2` | V4.2, ESP32-S3R2 | GC1109 | GPIO36 | GPIO34, activo bajo |
| `V4_3` | V4.3 / V4.3.1, ESP32-S3R2 | KCT8103L | GPIO36 | GPIO34, activo bajo |
| `V4_R8` | V4-R8, ESP32-S3R8 | KCT8103L | GPIO40 | GPIO42, activo bajo |

Confirmar la serigrafía, la banda de radio y la variante GPS del pedido antes
de cargar un binario. Un anuncio de compra con múltiples variantes no
identifica por sí solo la seleccionada. Esta preparación no supone que la
placa recibida coincida con alguna variante específica.
Los perfiles V4 de esta tabla corresponden a placas con el FEM indicado;
no asumir que una variante de baja potencia sin amplificador es equivalente.

La integración GNSS usa NMEA por UART (RMC/GGA, con checksum), inicialmente
9600 baudios, RX del ESP32 en GPIO38 y TX en GPIO39. Está orientada al GPS
UART del conector Heltec, como el L76K; no se ha verificado el receptor
comprado. Los pines UART se pueden modificar mediante `MESH_GPS_RX_PIN` y
`MESH_GPS_TX_PIN` en `board_profile.h`. Una pantalla TFT o un kit de expansión
con conexiones distintas requiere su propio perfil; estos perfiles usan OLED.

## Mejoras incluidas

- FEM encendido antes de calibrar el SX1262; selección TX/RX y LNA según perfil.
- V4 con 20 entradas de nodos, 128 entradas de detección de duplicados y 20 ACK
  pendientes. V3 conserva 10, 30 y 10, respectivamente.
- Cola BLE de 8 comandos en V4, preferentemente en PSRAM; reserva alternativa
  en RAM interna si la PSRAM no está disponible. V3 usa una cola de 4 comandos.
- Las operaciones de radio y las notificaciones BLE se ejecutan desde `loop()`;
  los callbacks BLE solo ensamblan y encolan comandos.
- La app serializa comandos BLE completos, evitando mezclar fragmentos de un
  envío, una consulta GPS y un reporte de descifrado.
- El destinatario final puede aceptar un mensaje dirigido aunque indique otro
  siguiente salto. Un ACK escuchado anticipadamente se acepta solo si coincide
  con el ID pendiente y el destinatario esperado. Los repetidores siguen
  respetando el siguiente salto.
- Un mensaje dirigido repetido se confirma de nuevo, sin duplicarlo en la app.
  No se han añadido reintentos automáticos: un timeout sigue siendo «sin
  confirmación» y no una prueba de pérdida del mensaje.
- GPS leído por bloques acotados, sin esperar fijación. UART con buffer de 2 KB;
  entrada serie de comandos no bloqueante. La transmisión LoRa y algunas
  guardas existentes siguen siendo bloqueantes; no se promete tiempo real.

## Uso en la app

1. Instalar una nueva compilación de la app para disponer de la integración GPS.
2. Conectar el nodo por Bluetooth. En **Ajustes** aparece el modelo y firmware.
3. En V4 aparece **GPS del nodo V4**, con estado, satélites y sentencias NMEA.
4. Con el GPS encendido, el botón **Ubicación** consulta una muestra nueva al
   nodo y envía `SOS latitud,longitud` por el canal de mensajería existente.
   El texto se cifra si está habilitado el cifrado en la app. Cabe en el límite
   actual de 32 bytes de texto cifrado.
5. Una posición de más de 10 segundos, coordenadas inválidas o una pérdida de
   fijación impiden ese envío. No se utiliza silenciosamente una posición antigua.
6. En V3 se conserva la ubicación del teléfono. En V4, apagar explícitamente
   el GPS del nodo también selecciona la ubicación del teléfono y reduce el
   consumo del receptor. La configuración de encendido persiste en el nodo.

No hay anuncios GPS por LoRa, rastreo periódico ni envío sin pulsar el botón.
El estado y las coordenadas actuales se notifican al teléfono BLE conectado,
pero no se guardan como historial GPS. El SOS enviado sí forma parte del
historial habitual de mensajes. En sótanos o interiores puede no existir
fijación satelital aunque el enlace LoRa funcione.

La consulta GPS por BLE no utiliza el cifrado AES de los mensajes LoRa.
Se conserva el enlace BLE existente, sin añadir emparejamiento autenticado;
por tanto, no considerar privadas las coordenadas frente a un teléfono cercano
que consiga conectarse al nodo. Apagar el GPS cuando no se necesite compartir
su posición. El endurecimiento de acceso BLE queda fuera de esta preparación.

## Compilación y carga

Desde la raíz del repositorio, elegir **solo el perfil que corresponde**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\build-firmware.ps1 -Board V3
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\build-firmware.ps1 -Board V4_2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\build-firmware.ps1 -Board V4_3
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\build-firmware.ps1 -Board V4_R8
```

Las salidas y las cachés quedan separadas en `firmware/build/<perfil>/` para
evitar que cambiar de placa sobrescriba la caché de otro perfil. No se borran los
binarios previos. Añadir `-Port COM5` solamente cuando corresponda cargar al
equipo conectado. Si Arduino CLI no encuentra el core Heltec pero Arduino IDE
sí lo tiene, indicar `-ConfigFile "$env:USERPROFILE\.arduinoIDE\arduino-cli.yaml"`.
El script no instala ni actualiza librerías automáticamente.

Opciones: `-Jobs 4` para limitar compilaciones simultáneas (0 usa los núcleos
disponibles), `-GpsBaud 38400` o `115200` si lo exige el receptor,
`-RadioDriveDbm <valor>` para la excitación del SX1262. Los valores iniciales
son 14 para V3 y 0 para V4; en V4 **no equivalen a potencia radiada** debido al
amplificador externo. No configurar 28 directamente en `SX1262::begin()`.
No se habilita automáticamente la máxima potencia. Para ajustar la salida se
debe verificar revisión, fuente de alimentación, antena y condiciones de uso
permitidas. No se ha medido potencia RF ni autonomía en estas placas.

Para compilar el APK con el código nuevo, usar el script existente
`build-android-release.ps1`; la preparación del firmware no actualiza la app
que ya está instalada en el teléfono.

## Diagnóstico y aceptación en hardware

Comandos serie: `gps`, `gps on`, `gps off`. `gps` informa estado y contadores,
sin transmitir coordenadas por radio. Si `bytes=0`, revisar alimentación,
receptor y RX/TX; si hay bytes pero no sentencias válidas, revisar baudios y
formato. Sentencias válidas sin fix no implican un error de LoRa.

Antes de usarlo en pruebas de campo:

Conectar la antena LoRa correspondiente antes de encender un nodo que pueda
transmitir, y montar el GPS en el conector y orientación correctos.

1. Verificar V3↔V3, V3↔V4 y V4↔V4 con idéntica frecuencia, SF, BW, CR y clave.
2. Probar un mensaje y un broadcast cifrados, con y sin repetidor.
3. Obtener fijación GPS al aire libre y comparar las coordenadas con una
   referencia; enviar un SOS y confirmar su descifrado en el otro teléfono.
4. Desconectar el GPS o simular pérdida de fix: no debe enviarse posición antigua.
5. Apagar el GPS desde Ajustes, reiniciar y verificar persistencia y GPS del teléfono.
6. Lanzar envío y consultas simultáneas: no deben mezclarse los comandos BLE.
7. Registrar TX/RX, ACK, timeouts, latencia y consumo en ambos extremos y repetidor.

Las compilaciones y pruebas automatizadas no sustituyen esta validación física.

## Comprobaciones de esta preparación

- Firmware final V3: compilación Arduino correcta con core Heltec 3.3.8
  y RadioLib 7.8.1; 764 935 bytes de programa y 33 092 bytes de RAM estática.
- Firmware final `V4_3` (pedido V4.3.1): compilación Arduino correcta con GPS,
  FEM KCT8103L y PSRAM habilitada; 780 869 bytes de programa y 35 916 bytes
  de RAM estática. El 59 % informado corresponde a la partición de aplicación
  de 1 310 720 bytes elegida por el core, no a toda la flash física de 16 MB.
  No se han compilado binarios ESP32 finales para V4.2 ni V4-R8 en esta ronda.
- `npm run typecheck`: correcto con la integración GPS y BLE.
- `node --experimental-strip-types --test tests/gps-and-ble.test.mjs`: dos
  pruebas correctas; cubren valores inválidos, antigüedad, formato SOS y
  serialización de operaciones BLE concurrentes.
- Exportación Expo web: correcta. Exportación Android con Hermes: correcta
  tras autorizar acceso fuera del entorno restringido. Son comprobaciones de
  los bundles, **no un nuevo APK instalado ni una prueba con radios**.
- El lector NMEA y los cuatro perfiles pasaron inicialmente las pruebas C++
  locales. En la ronda final, ya autorizada, se compilaron los cuatro perfiles
  y V3 pasó las aserciones de GPS y encaminamiento. Windows bloqueó el
  ejecutable V4.2 mediante Application Control; la ejecución de V4.3 y V4-R8
  no llegó a realizarse porque el script se detiene ante el primer error.
  No se ha modificado la política de seguridad para eludir ese bloqueo.
- No se ha verificado fijación GNSS, potencia RF, consumo ni funcionamiento
  mixto en dispositivos físicos. No se ha cargado firmware a ninguna placa.

## Fuentes de hardware consultadas

- [Heltec: V4 y selección del FEM](https://wiki.heltec.org/docs/devices/open-source-hardware/esp32-series/lora-32/wifi-lora-32-v4/).
- [Heltec: cambios V4.3.1](https://wiki.heltec.org/docs/devices/open-source-hardware/esp32-series/lora-32/wifi-lora-32-v4/hardware-update-log).
- [Heltec: ficha V4.2 y pinout](https://resource.heltec.cn/download/WiFi_LoRa_32_V4/datasheet/WiFi_LoRa_32_V4.2.0.pdf).
- [Heltec: kit con receptor opcional L76K](https://heltec.org/project/wifi-lora-32-v4-expansion-housing/).
- [Meshtastic: perfil V4](https://github.com/meshtastic/firmware/blob/master/variants/esp32s3/heltec_v4/variant.h)
  y [V4-R8](https://github.com/meshtastic/firmware/blob/master/variants/esp32s3/heltec_v4_r8/variant.h).
- [MeshCore: control del FEM](https://github.com/meshcore-dev/MeshCore/blob/main/variants/heltec_v4/LoRaFEMControl.cpp).
