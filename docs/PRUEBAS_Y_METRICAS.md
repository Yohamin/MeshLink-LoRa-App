# Ensayos coordinados: registro en emisor y receptor

Fuente actual: app **1.3.0 / código Android 9** y firmware **5.5.0** para V3/V4.
Hay que compilar, instalar y probar ambos: editar la fuente no actualiza los
APK/binarios anteriores. Se conserva el protocolo radio 5.1 y AES existente.

## Uso en campo

1. Instalar las versiones nuevas en ambos teléfonos y nodos. Conectar cada
   teléfono por BLE a su nodo. Usar la misma clave y el mismo modo de cifrado,
   además de parámetros RF compatibles y permitidos para el lugar.
2. En **ambos teléfonos**, abrir **Red → Ensayos · emisor y receptor** y
   mantenerlo visible, con la pantalla encendida. La pantalla indica preparado
   cuando hay conexión, firmware compatible e historial disponible. Entrar en
   este apartado autoriza aceptar una solicitud de ensayo de un nodo de la red.
3. En el emisor, seleccionar cualquier otro nodo como destino, escribir el
   escenario y elegir una pausa entera de 2–60 segundos (5 por defecto).
   No puede haber mensajes ordinarios pendientes ni otro ensayo activo.
4. Pulsar **Solicitar ensayo al nodo elegido**. Se abre la captura del origen,
   se consultan instantáneas iniciales y se envía una solicitud al destino.
   El receptor abre su archivo, guarda instantáneas propias y solo entonces
   confirma preparación. **Un ACK de firmware no sustituye esa confirmación.**
   Si no llega en 60 segundos, no se envía ninguno de los 100 mensajes de datos.
5. Se envía `T:ID_DE_ENSAYO:001/100` hasta `100/100`. Solo hay un mensaje de
   datos pendiente; se espera su ACK o timeout y luego la pausa configurada.
   No hay retransmisión automática de datos. Se usa el enrutamiento normal,
   incluido el repetidor que el firmware seleccione. No se automatiza broadcast.
6. El receptor registra las secuencias y muestra su cantidad única. Ambos
   registran sus propias métricas técnicas, sin confundir ACK con recepción
   y descifrado efectivos en el teléfono.
7. Tras los 100 intentos conocidos, el emisor envía los conteos de cierre.
   El receptor espera 8 segundos de drenaje, consulta instantáneas finales,
   guarda el resultado y confirma guardado. El origen indica cierre completo
   únicamente si recibe esa confirmación. Si se pierde, el origen queda como
   incompleto/sin confirmar, aunque el archivo del receptor pueda estar completo.
8. Abrir la sesión histórica y exportar **CSV** y/o **JSON** en cada teléfono.
   Guardar ambos archivos con el mismo ID de ensayo. Para invertir el sentido,
   iniciar otro ensayo desde el otro teléfono; será un registro diferente.

No se modifica automáticamente potencia, frecuencia, cifrado, clave ni
enrutamiento, ni se reinician contadores. La pausa no garantiza por sí sola
cumplimiento de las restricciones RF. No ensayar en una red de emergencia activa.

## Organización y límites de captura

- **Sesión:** `nodeId + bootId`, donde el firmware genera un ID aleatorio por
  encendido. Reconectar el mismo arranque conserva la sesión histórica.
- **Ensayo:** ID común, rol emisor/receptor, origen, destino, escenario del
  emisor, pausa, cifrado, versiones de app/firmware y datos técnicos de plataforma.
  El texto libre del escenario no se transmite por radio: el receptor conserva
  el mismo ID y una etiqueta de ensayo remoto; el detalle está en el archivo de origen.
- **Captura:** empieza al solicitar localmente o aceptar una solicitud remota;
  incluye preparación, datos y cierre. Cada registro se etiqueta con ID, rol,
  par remoto y fase. Las ventanas no empiezan al mismo instante de reloj, pero
  ambos archivos están preparados antes del primer mensaje numerado.
- **Contadores:** `metricsEpoch` identifica un reset explícito sin confundirlo
  con otro arranque. Si hay reset durante el ensayo, se interrumpe.

Fuera del ensayo se conserva en memoria el estado necesario para mostrar la
app y preparar la conexión, pero **no se añade telemetría continuamente al
historial**. Permanecer en Ensayos significa estar disponible; no comienza por
sí solo una grabación de horas. Los historiales creados por versiones anteriores
se conservan y siguen pudiendo exportarse; no se borran para imponer este cambio.

Los archivos se guardan en almacenamiento privado de cada **teléfono**, no
en la flash del nodo. No se recupera detalle generado mientras BLE estuvo
desconectado. El nodo mantiene contadores acumulados en RAM desde su arranque;
la instantánea inicial puede incluir tráfico previo. No se debe tratar ese
total como tráfico exclusivo del ensayo. El registro autónomo sin teléfono
requeriría otro trabajo en flash/SD, con descarga, límites y control de desgaste.

## Información conservada

- Todas las propiedades numéricas finitas reportadas en `status.metrics`,
  incluidos contadores de tráfico, rutas/relay, ACK, errores, duplicados,
  tamaños, cifrado y descifrado; también los contadores BLE.
- Instantáneas frescas de **info, nodos y estado** al inicio/final de ambos
  extremos, correlacionadas con su solicitud; además de las periódicas del
  firmware, aproximadamente cada 5 segundos durante la captura.
- Parámetros RF reportados: frecuencia, BW, SF, CR, sync word, preámbulo y
  drive SX1262. El drive no equivale a potencia RF calibrada del FEM.
- Eventos BLE observados de TX, RX, ACK, timeout, error/reset; identificadores,
  bytes, ruta y RSSI/SNR disponibles; contadores y tiempos de seguridad.
- Intentos/secuencias, resultados, números recibidos, fallos de descifrado del
  par (sin inventar una secuencia si no pudo leerse), controles y confirmaciones.
- Hora local de recepción expresada en UTC en CSV y `uptimeMs` del nodo.
  No se suponen relojes sincronizados ni se deduce latencia unidireccional.

No se guardan aquí claves, mensajes privados, ciphertext, GPS ni datos del
MAX30102. La evidencia sintética de la prueba no ocupa el historial de chats.
Los IDs/rutas y metadatos siguen siendo información sensible. La base de datos
no añade cifrado propio: proteger el teléfono y las exportaciones. Los controles
heredan el modo de cifrado seleccionado; no añaden autenticación individual
de cada usuario/nodo por encima del modelo existente de clave compartida.

## Paradas, pérdida de conexión y almacenamiento

Salir de Ensayos, bloquear la pantalla/ir a segundo plano, perder BLE, cambiar
de arranque o pulsar Detener interrumpe y guarda el registro parcial. Se intenta
avisar al otro extremo, pero un aviso radio puede perderse y no garantiza que
ambos se detengan simultáneamente. Nunca se reanuda solo. Un paquete en vuelo
no se puede retirar. Si queda ambiguo, reconectar BLE antes de otro ensayo.
Los envíos ordinarios/SOS y cambios de clave/cifrado de esta app se bloquean
durante el ensayo: detenerlo antes de utilizarlos.

Si el emisor desaparece sin cierre, el receptor termina por el plazo máximo
de la sesión: 120 s + 100 × (pausa + 30 s). Ese margen permite una prueba con
muchos timeouts sin suponer prematuramente que terminó. También puede detenerse
manualmente. Si la app muere sin guardar cierre, el historial muestra cierre ausente.

Watchdogs: 10 s por instantánea BLE, 30 s por observación de un envío y 60 s
por confirmación de la app remota. El ACK timeout de firmware sigue en 8 s;
un watchdog BLE no se cuenta como pérdida LoRa. Las escrituras tardías se
detienen donde todavía sea posible, sin prometer retirada de lo ya enviado.

Se usan páginas de 64 eventos y escrituras serializadas, independientes del
límite de 500 mensajes del chat. No hay borrado automático. Si falta espacio
o falla una escritura, no se confirma preparación/guardado exitoso, se avisa
y se detiene el ensayo; la mensajería ordinaria sigue disponible. Se permite
rescatar mediante exportación los registros que sigan siendo legibles.
Un cierre forzado puede perder operaciones pendientes; se recuperan páginas
persistidas cuyo índice quedó atrasado, sin prometer transacciones perfectas
ante cualquier fallo del sistema. Exportar después de cada ensayo.

Reiniciar nodo/app o limpiar chats no elimina las sesiones. Desinstalar o
borrar datos del teléfono sí puede eliminarlas. Exportar no borra los originales.
Android solicita una carpeta para CSV/JSON; cancelar el selector no elimina
datos. La exportación se deshabilita durante un ensayo. Web permite descargar
archivos, pero su adaptador DEMO no representa dos teléfonos reales. La exportación
de archivos no está implementada para iOS.

## Indicadores e interpretación

| Indicador | Definición |
| --- | --- |
| Planificados | 100; no implica que se hayan transmitido todos |
| Intentos | Secuencias registradas e iniciadas en origen |
| TX confirmados | `sent.ok = true` de las solicitudes de datos, no de controles |
| PDR ACK | ACK únicos de esos datos / TX confirmados × 100 |
| ACK / intentos | ACK / intentos; permite ver el efecto de fallos locales |
| Latencia promedio | `latencyMs` de ACK exitosos; sin incluir timeouts |
| Recibidos únicos | Secuencias correctamente reconocidas del origen esperado |
| PDR recepción | Recibidos únicos / TX informados en un cierre completo válido × 100 |
| RSSI/SNR RX promedio | Media de mensajes de prueba únicos, no anuncios/ACK/controles |
| Sin observación | Resultado BLE no determinado; no se afirma pérdida de radio |

Un porcentaje sin denominador, sin manifiesto final o con conteos inconsistentes
aparece como `—`, no cero ni una recepción inventada. Los archivos originales
permiten revisar secuencias y hacer el cruce manual. La confirmación final del
receptor prueba que guardó su registro local hasta ese punto, no que todos los
paquetes llegaron. El ACK de firmware no garantiza descifrado en el teléfono:
100 % ACK puede coexistir con un PDR de recepción menor.

Los controles START/READY/FINISH/SAVED/STOP usan textos reservados `E1:` de
menos de 32 bytes, transportados por la mensajería existente. Son tráfico
adicional y se registran como controles, separados de los 100 datos al calcular
PDR/latencia/RSSI/SNR. Las métricas acumuladas del nodo sí incluyen ese tráfico
y anuncios/otros nodos: no restar promedios acumulados para obtener promedios
por ensayo. Mantener el mismo procedimiento y telemetría entre escenarios.

## Validación y compilación pendientes

```powershell
npm run typecheck
node --experimental-strip-types --test tests/gps-and-ble.test.mjs tests/health.test.mjs tests/telemetry.test.mjs tests/trial-pair.test.mjs
```

Las pruebas simulan dos teléfonos, almacenamiento independiente, 100 envíos,
sentido inverso, pérdidas, descifrado fallido, disco lleno, cierre perdido,
origen incorrecto y cancelación sin reanudación. No son una prueba de LoRa
físico ni una transmisión real de 100 mensajes. Generar APK y firmware nuevos
desde PowerShell normal/Arduino IDE y validar físicamente; el entorno Windows
restringido presentó previamente errores nativos de compilación.

Desde la raíz: `build-android-release.ps1` para APK y
`firmware/build-firmware.ps1 -Board V3` o `-Board V4_3` para firmware. Ver
[V4_GPS.md](V4_GPS.md) y [MAX30102_V4.md](MAX30102_V4.md).
