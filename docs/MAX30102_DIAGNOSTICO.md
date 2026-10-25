# MAX30102 corrección FIFO r2 / diagnóstico BLE r3 — Heltec V4.3 / V4.3.1

Fuente actual firmware 5.6.0, app 1.4.0. El arranque imprime
`[HEALTH-DIAG r3]`; `info` por BLE añade `healthDiagnosticRevision: 3`.
Se conserva la recuperación r2; r3 agrega identidad de arranque y diagnóstico
a las instantáneas BLE para [registro local y envío manual](MEDICIONES_MAX30102.md).
Se conservan los parámetros ópticos, 25 muestras FIFO/s, GPIO4/GPIO6,
la mensajería, GPS y el protocolo LoRa. No habilita sensores en V3/V4.2/R8.
No modifica el paquete experimental previamente construido.

Esta revisión corrige la recuperación del FIFO; **no garantiza resolver la causa ni producir
mediciones válidas**. No se ha validado clínicamente. No cambia VIN, los
puentes del breakout ni su alimentación; la compatibilidad de VIN con 3,3 V
debe confirmarse con la ficha de esa placa, no con la del chip.

## Cambio respecto de r1

El registro físico de r1 mostró `present=1`, `i2c=0`, `ambient=0`, cientos de
observaciones `fifo_overflow`, punteros `wr=0/ovf=25/rd=0` y `samples=0`.
Eso localiza el bloqueo en la adquisición, pero no demuestra por sí solo
por qué el contador permanecía activo. r2 no presupone daño del sensor ni
que la lectura agrupada fuera necesariamente incorrecta.

1. Leer 0x04/0x05/0x06 individualmente, con dirección explícita.
2. Invalidar la ventana y solicitar SHDN conservando modo rojo+IR.
3. Esperar 10 ms solo en el worker y verificar que SHDN esté activo.
4. Escribir ceros en los tres registros FIFO y leerlos individualmente.
5. Reanudar solo si los tres campos de cinco bits están en cero; comprobar
   también que el modo de adquisición se haya reactivado.
6. Limitar a tres recuperaciones consecutivas sin muestras. Si persiste,
   solicitar pausa y volver al retardo de reconfiguración existente de 2 s,
   en lugar de vaciar el FIFO continuamente a cada consulta.

Una muestra completa reinicia ese límite. Un fallo I²C conserva su causa;
un ACK con lectura posterior incorrecta se marca `fifo_reset_failed`.
Después de una recuperación verificada se vuelve a `warming`, sin reutilizar
mediciones anteriores. No se cambia la corriente LED, frecuencia, promedio,
algoritmo ni umbrales de validez. La adquisición sigue apagada al arrancar.

## Compilar y cargar

Desde PowerShell normal, cerrar el monitor serie y ejecutar:

```powershell
cd "C:\Users\Yohamin\Documents\Codex\2026-08-08\u\MeshLink-LoRa-App"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\build-firmware.ps1 -Board V4_3 -Jobs 4 -ConfigFile "C:\Users\Yohamin\.arduinoIDE\arduino-cli.yaml" -OutputDirectory "C:\Users\Yohamin\Documents\Codex\2026-08-08\u\MeshLink-LoRa-App\firmware\build\V4_3-5.6.0" -Port COM4
```

Confirmar que la V4.3.1 sigue en COM4 antes de cargar. Omitir `-Port COM4`
para solo compilar. Mantener la antena LoRa conectada. Usar esta fuente nueva,
no la copia `fuentes/firmware` del paquete anterior. El diagnóstico serie no
necesita APK; para el nuevo registro/compartir se requiere app 1.4.0.

## Captura solicitada

Monitor serie a 115200 baudios, final de línea «Nueva línea»:

```text
health on
health diag on
```

Esperar unos 15 segundos, en interior sin luz intensa directa, con el dedo
inmóvil sobre la ventana. Después:

```text
health diag off
health
health off
```

Compartir las líneas `[HEALTH]`, `[HEALTH-DIAG]`, `[HEALTH-REG]` y
`[HEALTH-I2C]` y `[HEALTH-FIFO]`, incluyendo el marcador r3 del arranque. El diagnóstico
periódico y la adquisición están apagados al reiniciar. El diagnóstico no
activa el sensor por sí mismo. No cortar/reconectar cables con alimentación.

## Qué distingue

| Estado / pantalla | Interpretación del controlador |
| --- | --- |
| `missing` / MAX sin respuesta | Falló la lectura inicial del identificador por I²C |
| `wrong_device` / MAX ID inesperado | ID distinto de 0x15; 0x15 tampoco identifica únicamente un MAX30102 |
| `i2c_error` / MAX error I2C | Transacción comprobada fallida o lectura incompleta |
| `ambient_overflow` / MAX luz saturada | Se observó ALC_OVF en el registro de interrupciones |
| `fifo_overflow` / MAX FIFO saturado | Contador de desbordamiento FIFO distinto de cero |
| `fifo_reset_failed` / MAX fallo vaciado | No se verificó la pausa, el vaciado o la reanudación |
| `fifo_recovery_failed` / MAX FIFO persistente | Se agotaron tres recuperaciones consecutivas sin muestras |
| `no_samples` / MAX sin muestras | No llegó la primera muestra en un segundo; no implica NACK |
| `sample_gap` / MAX muestras cortadas | Más de 500 ms desde la última muestra; se invalida la ventana |
| `power_event` / MAX reinicio sensor | Bandera PWR_RDY observada; por sí sola no demuestra la causa eléctrica |
| `config_error` / MAX config invalida | Los registros leídos no coinciden con la configuración solicitada |
| `library_init_error` / MAX fallo inicio | La inicialización de la biblioteca devolvió fallo |
| `warming` / MAX tomando muestras | Recogiendo la ventana de 100 muestras |
| `no_contact` / MAX sin contacto | Muestras presentes, pero no superan las guardas de contacto |
| `poor_signal` / MAX senal no valida | No hay estimación aceptada por el algoritmo/guardas |

Los contadores son acumulados **desde el arranque**, no por comando ni por
ensayo. `ambient` y `fifoOverflow` cuentan observaciones, no muestras perdidas.
`resets` cuenta intentos de la secuencia pausa/vaciado/reanudación, no reinicios
de la Heltec ni garantía de éxito. `verified` cuenta secuencias verificadas
completas; `failed` cuenta secuencias intentadas fallidas; `limitHits` cuenta
límites alcanzados sin volver a intentar el vaciado. Incluyen la inicialización.
`configFailures` cuenta intentos fallidos; `i2c` cuenta solo transacciones
fallidas comprobadas por el controlador, no todos los accesos internos de la
biblioteca SparkFun. `noSamples`, `gaps`, `powerEvents` se contabilizan aparte.
Un estado recuperado no borra `lastFault` ni el último error I²C: contrastar
contadores entre líneas para saber si sigue ocurriendo.

Los registros se imprimen en **decimal**, `-1` significa no observado en el
intento actual. Valores de configuración esperados: part=21 (0x15), mode=3,
spo2Config=39 (0x27), `fifoConfig & 0xF0 = 64` (0x40). Los cuatro bits bajos
son el umbral de FIFO casi lleno: **79 (0x4F), como en el registro recibido,
es aceptado y no demuestra un fallo de configuración**. `status`, `wr`, `ovf`, `rd` son
la última observación anterior a vaciar el FIFO, no una lectura adicional.
`lastOp=short_read` indica lectura incompleta; `wireCode` solo representa el
código de `endTransmission`, por lo que puede ser cero en una lectura corta.
`faultAt` y `sampleAgeMs` usan tiempo del nodo, no hora del teléfono.

`[HEALTH-FIFO]` muestra el último intento: `pausedMode=131` (0x83),
`clearWr=0 clearOvf=0 clearRd=0`, `resumedMode=3` indican la secuencia
esperada. `-1` significa etapa no observada en ese intento; un límite o error
puede impedir llegar a la reanudación. SHDN es una pausa lógica, no un corte
físico de VIN; si el bus falla o el dispositivo ignora comandos no se garantiza
que el hardware esté detenido.

En una prueba exitosa `samples` debe aumentar: vaciar el FIFO correctamente
no basta para demostrar adquisición. Los valores fisiológicos pueden seguir
ausentes si no hay contacto/señal válida. No reenviar el registro de r1:
confirmar primero el marcador r3 tras cargar la nueva fuente.

El firmware conserva `present=true` ante ausencia de muestras o saturación
si las transacciones responden; no lo convierte automáticamente en «sensor
desconectado». No genera valores de pulso/SpO₂ con muestras inválidas. La app
existente sigue siendo compatible, pero sus textos genéricos pueden no
distinguir los nuevos estados: para este diagnóstico usar OLED y serie.

## Verificación

Las pruebas host C++ y TypeScript/Node se ejecutan en este equipo. El usuario
ya cargó r2 y su registro confirmó adquisición sin desbordamientos FIFO,
con un fallo I²C del que se recuperó. Para **5.6/r3 falta la compilación
ESP32 y la prueba física**; usar PowerShell normal con el comando anterior.
En este entorno Xtensa estuvo bloqueado por `Illegal System DLL Relocation`.
No se entrega ni se carga automáticamente un binario r3. El paquete base
5.5.0 y la salida anterior r1 se conservan intactos.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\tests\run-health-tests.ps1
node --experimental-strip-types --test tests/health.test.mjs
```

Pruebas del bus simulado: valores de registro del caso r1, vaciado aceptado
solo en pausa, lecturas individuales, recuperación y 100 muestras con
algoritmo simulado, recuperaciones limitadas, ACK con escritura ignorada,
fallos de pausa/reanudación, NACK, lectura corta, wrap de punteros, saturación,
timeout, discontinuidad, PWR_RDY, ID y configuración incorrectos. Los valores
72/97 de la prueba provienen de un stub, no de un sensor ni validación clínica.
Se prueban también la ventana real de guardas y perfiles sin sensor. Estas
pruebas no sustituyen compilar para ESP32 ni medir con hardware.

## Referencia

[MAX30102 — registros de interrupción y FIFO, Analog Devices](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf).
