# Diagnóstico aislado: Heltec V4.3/4.3.1 + Quectel L76K

Esta prueba investiga el caso en que MeshLink muestra:
```text
[GPS] supported=1 enabled=1 fix=0 sats=0 bytes=0 nmea_ok=0 nmea_bad=0
```

**No demuestra que los GPS estén averiados.** Que dos receptores den cero hace
más probable una causa compartida, pero no permite separar por sí solo
alimentación, cable, placa, inicialización o configuración UART.

## Advertencias antes de cargar

- Solo para la Heltec WiFi LoRa 32 V4.3 / V4.3.1 y su conector GPS de 8 pines.
  **No usar en V3, V4-R8 ni placas de expansión TFT con otro pinout.**
- Cargar el diagnóstico **sustituye temporalmente el firmware MeshLink**.
  La app no se conectará por BLE y la pantalla OLED no se actualiza.
- No se ha cargado automáticamente ninguna placa. La carga siempre es manual.
- No borrar toda la flash. El sketch no usa Preferences ni borra NVS.
- Antes de cambiar un GPS o un cable, desconectar USB y batería.
- Mantener la antena LoRa conectada para la posterior restauración de MeshLink.
  El diagnóstico mantiene el radio en reset y deshabilita el FEM.
- No intercambiar cables ni aplicar 5 V al GPS.
- No prueba la precisión o adquisición satelital. Primero comprueba datos UART.
  Se puede realizar en interiores.
- No imprime coordenadas ni sentencias NMEA completas.

## Novedad de r2: comparación eléctrica con pull-ups débiles

El diagnóstico r1 liberaba RESET y WAKE en open-drain sin habilitar resistencias
de subida en el ESP32. Una lectura de 0 V no demostraba por sí sola una avería
ni que el programa estuviera forzando esos controles a LOW.

**r2 arranca en modo medición, no inicia el barrido automáticamente.** Tras el
encendido/reset, configura GPIO40 y GPIO42 como `INPUT_PULLUP`. Esto habilita
una resistencia de subida interna débil, no una salida push-pull HIGH. El reset
sigue siendo un pulso open-drain LOW. Mientras ordena apagar el GPS, ambas
entradas quedan sin pull-up; las resistencias se habilitan después de encenderlo.
También configura las salidas antes de llamar a `digitalWrite`: el core Heltec
3.x puede ignorar una escritura si el pin todavía no está registrado como GPIO.
Esto evita depender de que la primera orden OFF se aplique antes de `pinMode`.

El ESP32 imprime los niveles que lee cada dos segundos, por ejemplo:

```text
GPS-DIAG r2 | Heltec V4.3/4.3.1 + Quectel L76K
[CTRL r2] mode=INPUT_PULLUP power34=0 wake40=1 reset42=1 test=measurement
```

Este es un ejemplo de formato, **no una medición real**. `1` no significa que
se hayan medido exactamente 3,3 V y `0` no demuestra un cortocircuito. El
programa no detecta si el cable GPS está conectado ni mide voltajes.

### Prueba con multímetro: con y sin GPS

1. Cargar r2 siguiendo la sección Arduino IDE. Verificar el encabezado **r2**.
2. Desconectar USB **y batería** de la V4. Retirar el cable GPS por el conector,
   sin tirar de los hilos. Mantener cualquier otra alimentación desconectada.
3. Alimentar solo por USB. Esperar al menos cinco segundos y la línea `[CTRL r2]`.
   No enviar `r` todavía. Con multímetro en V DC, negro en COM/GND y rojo en
   V/ohmios, medir los contactos grandes rotulados 34, 40 y 42 respecto a GND.
   No contar posiciones ni sondear patas pequeñas del chip/conector.
4. Desconectar nuevamente USB y batería. Conectar GPS y cable completamente,
   sin forzarlos. Alimentar otra vez por USB y repetir las mismas mediciones.
5. Copiar las líneas `[CTRL r2]` y anotar ambas filas de voltajes. Después,
   **con el GPS conectado**, enviar `r` en el monitor para iniciar el barrido.
6. Si se necesita volver a medir durante el barrido, enviar `m`. Esto detiene
   la UART sin cortar alimentación ni aplicar un reset nuevo. Para repetir
   todo el ciclo, enviar `r`. Nunca cambiar conexiones con energía presente.

| Configuración | GPIO34 contra GND | GPIO40 contra GND | GPIO42 contra GND |
| --- | --- | --- | --- |
| Sin cable GPS en la V4 | Anotar V | Anotar V | Anotar V |
| GPS y cable conectados | Anotar V | Anotar V | Anotar V |

Con este programa se busca GPIO34 cerca de 0 V (orden ON) y GPIO40/42 cerca
de 3,3 V tras el arranque. Son valores esperados, no una garantía eléctrica.

- Si 40/42 suben sin cable, pero bajan al conectar GPS, la carga aparece en el
  conjunto cable/receptor. Revisar pinout, continuidad y alimentación real
  antes de atribuirlo al chip o forzar la línea.
- Si 40/42 siguen bajos incluso sin cable, comprobar punto de medida, masa,
  encabezado r2, placa seleccionada y cualquier periférico conectado; no
  concluir automáticamente que el ESP32 está dañado.
- Si suben y aparece NMEA al enviar `r`, el sesgo de esos controles es una
  pista para una futura corrección del firmware principal. No confirma un fix.
- Si suben pero siguen cero bytes, la búsqueda continúa en cable, reset real,
  alimentación en el receptor y ruta UART. Los niveles en la V4 no prueban
  que esas señales lleguen correctamente al GPS.

**No usar modo corriente, resistencia o continuidad sobre la placa alimentada.
No puentear 40/42 a 3,3 V ni aplicar 5 V al GPS.** Si no se identifican los
contactos, pedir una foto cercana antes de medir.

## Qué hace

Sketch:
[diagnostics/gps_v4_l76k/gps_v4_l76k.ino](../diagnostics/gps_v4_l76k/gps_v4_l76k.ino).
Mantener junto a él el archivo
[gps_diagnostic_core.h](../diagnostics/gps_v4_l76k/gps_diagnostic_core.h).

1. Mantiene el SX1262 en reset (GPIO12) y el FEM deshabilitado (GPIO2/7).
2. Ordena apagar la alimentación GPS mediante GPIO34 durante 600 ms.
3. Ordena encenderla y espera 1000 ms.
4. Aplica reset activo bajo open-drain en GPIO42 durante 250 ms, libera con
   `INPUT_PULLUP` y espera 1200 ms. WAKE también queda como `INPUT_PULLUP`.
5. Al arrancar, mantiene modo medición. Al enviar `r`, repite el ciclo y
   escucha GPIO38/39 a 9600, 19200, 38400, 57600 y 115200 baudios.
6. Cada combinación se observa durante ocho segundos.
7. Si detecta al menos tres sentencias NMEA con checksum válido en una etapa,
   se queda escuchando esa combinación. En caso contrario continúa.
8. Si termina sin detectar NMEA válido, presenta las diez combinaciones y se
   detiene. El barrido dura unos 80 segundos más el arranque. Los controles
   siguen imprimiéndose cada dos segundos incluso tras finalizar.
9. No transmite comandos al receptor, no cambia su baudrate, no cambia sus
   constelaciones y no realiza un restablecimiento de fábrica.

**Los GPIO38/39 solo se usan como entradas durante la búsqueda, sin TX UART
conectado.** Probar el segundo GPIO no significa que deban invertirse cables
ni que el pinout actual esté demostrado incorrecto. El resultado debe aportar
evidencia antes de modificar MeshLink.

Las órdenes GPIO **no miden el voltaje real**. Un registro GPS_ON o un driver
UART iniciado no confirma que el módulo esté alimentado.

## Opción A: Arduino IDE

1. Abrir el archivo `gps_v4_l76k.ino` desde su carpeta completa.
2. Seleccionar el core Heltec instalado y la placa **WiFi LoRa 32 (V4)**,
   no la V3 ni la V4-R8.
3. Utilizar flash de 16 MB y USB CDC al arrancar habilitado, como en el perfil
   V4_3 de MeshLink. No activar el borrado completo de flash.
4. Seleccionar el puerto del módulo que realmente aparece en el IDE.
5. Verificar y después cargar, aceptando que sustituirá temporalmente MeshLink.
6. Abrir el monitor serie a **115200 baudios**.
7. Pulsar RESET para ver **GPS-DIAG r2**. Esperar cinco segundos: aparece
   `[MEASURE]` con UART detenida. Realizar primero la comparación eléctrica.
8. Con el GPS conectado, enviar `r` y esperar `[FOUND]` o `[NO_NMEA]`.
9. Enviar las mediciones y el registro desde `GPS-DIAG r2` hasta el resumen.
   No hace falta abrir la aplicación.

Este sketch solo necesita el core Heltec/Arduino para ESP32; no usa RadioLib,
U8g2, ArduinoJson, TinyGPS++ ni la librería del MAX30102.

## Opción B: compilar con Arduino CLI

Desde la raíz de MeshLink, en PowerShell habitual:

```powershell
& "C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe" --config-file "C:\Users\Yohamin\.arduinoIDE\arduino-cli.yaml" compile --fqbn "Heltec-esp32:esp32:heltec_wifi_lora_32_V4:PSRAM=enabled,FlashSize=16M,CDCOnBoot=cdc,LORA_FEM_TYPE=1,LORA_RX_LNA=1" --jobs 2 --build-path ".\firmware\build\gps-diagnostic\cache" --output-dir ".\firmware\build\gps-diagnostic\bin" ".\diagnostics\gps_v4_l76k"
```

La compilación por sí sola **no carga la placa**. No se incluye un script que
seleccione un puerto o flashee automáticamente.

## Cómo leer los resultados

Ejemplo de formato; no es una medición real:

```text
[RESULT] rx=38 baud=9600 uart=1 bytes=4200 nmea_ok=35 bad=0
[FOUND] NMEA con checksum valido. UART comunica; esto NO confirma posicion.
```

| Resultado | Interpretación |
| --- | --- |
| `uart=0` | Falló la inicialización del driver UART; no interpretar esa etapa como prueba del receptor. |
| `uart=1 bytes=0` en todas las etapas | No se observó tráfico UART. Revisar alimentación real, cable/conector, placa o receptor; no es un diagnóstico de avería. |
| `bytes>0 nmea_ok=0` | Hay actividad, pero no NMEA confirmado. Puede ser ruido, baudrate/formato distinto u otra causa; contar bytes no basta. |
| `nmea_ok>=3` | Hay comunicación y checksum válido en esa combinación. Aún no se demuestra fijación satelital. |
| NMEA válido solo en un baudrate diferente de 9600 | Evidencia para ajustar después la configuración UART de MeshLink. |
| NMEA válido solo en GPIO39 | Evidencia para revisar el mapeo UART real del kit antes de corregir MeshLink; no cambiar cables a ciegas. |
| NMEA válido con RX38/9600, pero MeshLink sigue con cero | Revisar inicialización, perfil y ejecución del firmware principal con el registro de ambas pruebas. |

Otros campos:

- `ascii`: cantidad de bytes ASCII imprimibles.
- `starts`: caracteres `$` observados.
- `bad`: tramas candidatas rechazadas por formato/checksum.
- `overflow`: candidatos que excedieron el buffer de línea.
- `rmc` y `gga`: sentencias de esos tipos con checksum válido.
- `MONITOR`: sigue escuchando la combinación detectada.

Comandos del diagnóstico, enviados desde el monitor serie:

- `r`: repite el ciclo de alimentación/reset y el barrido.
- `m`: detiene la UART y mantiene alimentación/controles para medir sin un
  nuevo reset. No permite conectar o retirar cables con la placa encendida.
- `?`: imprime un resumen actualizado.

Si ambos GPS siguen en cero en este programa, el siguiente paso es comprobar
la alimentación real y la continuidad con instrumentos, en puntos verificados.
El software no puede confirmar esas condiciones eléctricas por sí solo.
No puentear pines ni sondear el conector fino sin identificar los contactos.

## Restaurar MeshLink

Volver a cargar el firmware **5.6.1, perfil V4_3** del proyecto, que incorpora
RX39 sin TX y la secuencia de control basada en r2. Ver [corrección y carga](V4_GPS.md).
No restaurar 5.6.0 en el kit probado: configuraba GPIO39 como TX del ESP32.
No confundir el
binario del diagnóstico con `firmware.ino.bin` de MeshLink.

Por ejemplo, **solo si el módulo aparece actualmente en COM4**, cerrar primero
el monitor serie y ejecutar desde la raíz:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\build-firmware.ps1 -Board V4_3 -Jobs 2 -ConfigFile "C:\Users\Yohamin\.arduinoIDE\arduino-cli.yaml" -Port COM4
```

Confirmar el puerto antes de usar ese ejemplo. Este comando sí compila y carga
el firmware principal; no se ha ejecutado automáticamente.

## Verificación de software

- El analizador pasó la prueba C++ local con MSVC y advertencias tratadas como
  errores: checksum, NMEA sin fix, ruido, overflow, recuperación y reinicio.
- El sketch se compiló con el core Heltec 3.3.8 y el perfil WiFi LoRa 32 V4,
  sin cargar la placa. Los binarios están en
  `firmware/build/gps-diagnostic/bin/`, separados de los de MeshLink.
- La compilación en el entorno restringido no pudo leer correctamente Arduino15;
  la compilación autorizada fuera de ese entorno sí terminó correctamente.
- Posteriormente se aportó un registro físico con NMEA válido en RX39/9600.
  Esta observación es distinta de compilar y no prueba por sí sola un fix GPS.
- r2 añade una prueba host del sketch real, con GPIO/UART simulados: arranque
  en medición, subida débil sin salida HIGH fuerte, reset de 250 ms, ausencia de
  pull-ups durante la orden OFF, lectura de controles bajos, diez modos UART,
  parada/reinicio y selección de NMEA válido. No simula el circuito eléctrico.

## Referencias y alcance

- [Perfil V4 de Meshtastic](https://github.com/meshtastic/firmware/blob/master/variants/esp32s3/heltec_v4/variant.h): GPIO de alimentación, reset, wake y UART.
- [Manual de hardware Quectel L76K, publicado por Heltec](https://resource.heltec.cn/download/Heltec%20Capsule%20Sensor%20V3/Quectel_L76K_V1.1-1.pdf): reset, standby y velocidades UART, secciones 3.4–3.6.
- [Esquema Heltec V4.3](https://resource.heltec.cn/download/WiFi_LoRa_32_V4/Schematic/HTIT-WB32LAF_V4.3.pdf).
- [GPIO de Arduino-ESP32](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/gpio.html): `INPUT_PULLUP` habilita una resistencia interna débil, no mide tensión.
- [Prueba local del analizador](../diagnostics/tests/gps_diagnostic_test.cpp): checksum, NMEA sin fix, ruido, overflow, recuperación y reinicio.
- [Prueba local del sketch r2](../diagnostics/tests/gps_diagnostic_runtime_test.cpp): secuencia de control y comandos con GPIO/UART simulados.

El usuario confirmó NMEA válido en RX39/9600 con r2 (hasta 159 sentencias sin
rechazos en la captura). Esto no confirma fix ni sustituye la prueba posterior
del firmware principal 5.6.1; el analizador de diagnóstico no imprime coordenadas.

El programa es un instrumento de diagnóstico. No es una corrección demostrada
del fallo ni sustituye la prueba con la placa, el cable y los receptores reales.
