# Ensayos, escenarios y métricas

Este documento reúne lo implementado y las propuestas discutidas. No calcula
nuevos resultados de campo ni convierte datos históricos en mediciones de 5.6.1.

## Ensayo implementado de 100 mensajes

1. Ambos teléfonos, con app compatible y BLE, permanecen en **Red -> Ensayos**,
   visibles y preparados. Elegir escenario, destino y pausa (2-60 s; 5 por defecto).
2. El emisor solicita ensayo al nodo elegido. El receptor persiste su línea
   base antes de READY; sin preparación confirmada no se envían los 100 datos.
3. Se realizan 100 intentos numerados, uno por vez, esperando ACK/timeout
   y luego pausa. No son 100 transmisiones simultáneas ni reintentos automáticos.
4. Ambos teléfonos guardan eventos bajo el mismo ID, con roles separados.
5. Al terminar, se intercambian manifiesto y confirmación de guardado final.
   El guardado remoto de la app no es el ACK radio de cada mensaje.
6. Exportar CSV/JSON desde ambos extremos; repetir B -> A como otro ensayo.

Cerrar vista, segundo plano, BLE perdido, reset de métricas/arranque o fallo
de disco interrumpen la prueba, sin reanudación automática. No convertir
observaciones BLE desconocidas en pérdida LoRa. La coordinación es dirigida;
no mide automáticamente PDR de todos los receptores de un broadcast.

Sesión: nodo + bootId. Ensayo: runId común; reset explícito de métricas usa
metricsEpoch. El nodo conserva contadores acumulados en RAM; los archivos
del ensayo se guardan en cada teléfono. No restar promedios acumulados para
inventar un promedio del ensayo ni usar siempre 100 como denominador.

Fuentes: [coordinador](../../src/lib/trial-coordinator.ts),
[resúmenes](../../src/lib/telemetry.ts),
[runner](../../src/lib/test-runner.ts),
[guía detallada](../PRUEBAS_Y_METRICAS.md).

## Métricas principales y límites

| Indicador | Definición operativa |
| --- | --- |
| Intentos | Secuencias realmente iniciadas en origen; no los 100 planeados por defecto |
| TX exitosas | Datos del ensayo con resultado local `sent.ok=true` |
| PDR ACK | ACK únicos de esos datos / TX exitosas x 100 |
| ACK por intento | ACK / intentos ejecutados x 100; ya existe en el resumen |
| PDR recepción | Secuencias únicas registradas en la app receptora / TX del emisor en cierre completo válido x 100 |
| Tiempo ACK medio | Media de `latencyMs` de confirmaciones; excluye timeouts |
| Timeouts | Mensajes pendientes que superan la espera sin ACK aceptado |
| RSSI/SNR del ensayo | Promedio de mensajes únicos recibidos con esos campos disponibles |
| Descifrado fallido | Observaciones del teléfono separadas del éxito ACK |
| Guardado remoto | Confirmación de persistencia del cierre, no atención humana |

El tiempo ACK inicia **después de transmitir y notificar el resultado BLE**.
No es latencia unidireccional ni tiempo total desde el botón hasta mostrar el
mensaje en el otro celular. Los relojes de teléfonos no están sincronizados.

Un timeout significa sin confirmación: también puede haberse perdido el ACK.
El último RSSI/SNR del firmware puede pertenecer a anuncio o ACK; no equivale
al promedio de datos del ensayo. En rutas con repetidor mide el salto local,
no toda la ruta. Si faltan datos/denominador, dejar ausente, no cero.

## Métricas nuevas discutidas: no implementadas

| Propuesta | Qué requiere | Estado |
| --- | --- | --- |
| P95 del tiempo ACK | Procesar tiempos individuales; solo ACK observados, acompañar con PDR | Propuesta, no incorporada al resumen |
| Éxito global por intento | RX únicos guardados / intentos ejecutados; cruzar ambos archivos completos | Propuesta; no confundir con ACK por intento ya existente |
| Racha máxima sin confirmación | Orden de secuencias/timeouts; separar desconocidos BLE | Propuesta |
| Beneficio del repetidor | PDR recepción con repetidor menos sin repetidor, en puntos porcentuales | Diseño experimental propuesto |
| Autonomía/energía | Batería y carga definidas; instrumentación/medición física por nodo | No medido por el sistema actual |
| Tiempo hasta primer fix GPS | Registrar encendido real y primer fix aceptado | Requiere ampliar registro; bytes NMEA no son fix |
| Disponibilidad GPS | Ventana observada y fracción con posición válida/reciente | No resumida automáticamente |
| Disponibilidad MAX por canal | Intervalos definidos con estimaciones válidas/recientes, contando huecos | Propuesta de análisis de sesiones; no exactitud clínica |
| Sobrecarga de red | TX de datos y control de todos los nodos / mensajes únicos entregados | Requiere registros coordinados de nodos |

Selección sugerida al final del chat: **P95, éxito por intento y beneficio
del repetidor**. El usuario aún no autorizó ni eligió una implementación.
No añadirlas solo porque figuren aquí; acordar alcance y criterios antes.

Actualización 4/11/2026: la app 1.4.2 sí añade conteos y porcentajes de
instantáneas MAX válidas por canal y con ambos válidos, sobre las instantáneas
realmente guardadas, además del objetivo de 100. Ese resumen no calcula
disponibilidad temporal, no rellena huecos BLE y no mide exactitud clínica.
La propuesta temporal de la tabla sigue pendiente.

Referencias conceptuales usadas al proponer, sin afirmar conformidad IP:
[RFC 8912](https://www.rfc-editor.org/rfc/rfc8912.html) para percentiles y
[RFC 2501](https://www.rfc-editor.org/rfc/rfc2501.html) para evaluación/eficiencia ad hoc.

## Los tres escenarios finales del chat

| ID | Entorno descrito | Condiciones a conservar |
| --- | --- | --- |
| E1 | Parque Cruz del Sur, campo abierto | LoS, 50 m según tabla aportada |
| E2 | Edificios O1-O2, cuarto piso y puente | NLoS, obstáculos universitarios, nodo intermedio en el puente, 30 m según tabla |
| E3 | Estacionamiento en sótano de la Universidad de Lima | Prueba horizontal NLoS a 50 m, repetidor aproximadamente al medio |

El antiguo escenario vertical con ascensor y sus cifras 2/21 ACK, 9,52 %, etc.
**no forman parte de estos tres escenarios finales**. No reutilizar aquella
interpretación de degradación progresiva: los valores de E3 citados son mejores
en RSSI/SNR que los de E2, aunque el PDR ACK citado sea menor.

### Cifras históricas citadas en el chat, no recalculadas en esta organización

| Escenario | PDR ACK citado | Tiempo ACK medio citado | RSSI medio citado | SNR medio citado |
| --- | --- | --- | --- | --- |
| E1 | 100 % | 1530,80 ms | -107,44 dBm | 4,06 dB |
| E2 | 100 % | Valor exacto por verificar en originales | -119,25 dBm | -4,34 dB |
| E3 | 70 %: 7 ACK y 3 timeouts | 1619,86 ms, solo confirmados | -101,40 dBm | 9,88 dB |

Estas cifras proceden de párrafos/tablas anteriores del chat. No son una
revalidación de los cálculos ni prueba de recepción/guardado en el teléfono.
No se rellenan conteos de RX únicos, tamaños de muestra ni versiones no
demostradas. Para E3 el usuario pidió **los últimos 10 envíos y últimos 10
de recepción**, correspondientes a mensajes 1-10; el archivo contiene más
intentos y hay que delimitar/correlacionar antes de recalcular.

**Advertencia de procedencia:** los dos adjuntos de E1 disponibles tienen el
mismo SHA-256 y contenido. Conservar ambos no convierte ese registro en dos
mediciones independientes ni prueba dos perspectivas distintas.

## Organización de evidencia y próximas pruebas

### ZIP final revisado el 5/11/2026

- `PruebasFinalesTesis.zip` leído sin extracción ni modificación del original.
  Las dos exportaciones de la carpeta Receptor son idénticas y no constituyen
  repeticiones independientes. Los eventos repetidos en exportaciones
  acumulativas se cuentan una sola vez.
- Para E1 se usa la pareja nueva de su propia carpeta, no el ensayo E1
  histórico incluido en la sesión de la carpeta Receptor. Sus 100 datos tienen
  ACK y recepción concordantes. Hay también una preparación detenida antes
  de iniciar datos, excluida del denominador de rendimiento.
- Receptor se cruza exclusivamente con E2 y E3 según la petición del usuario:
  todos sus `testRx` coinciden por runId, secuencia y msgId con transmisiones
  del emisor; no hay duplicados ni ACK sin recepción en los pares elegidos.
- E2 completó los 100 envíos y tiene manifiesto completo en destino, pero el
  cierre de captura fue interrumpido al salir/ocultar la pantalla. Su cociente
  de recepciones observadas se reconstruye manualmente; no sustituye un cierre
  persistido completo ni cambia el PDR nulo de la app. E3 tiene cierre completo.
- E1 usa app 1.4.2 / pausa 2 s; E2/E3, app 1.4.1 / pausa 5 s. Firmware 5.6.1
  y parámetros RF reportados coinciden. Los datos están marcados como `direct`;
  no prueban el beneficio de un repetidor. No atribuir las diferencias solo
  al entorno ni mezclar estos ensayos con sus antecesores como si fueran uno.
- Las seis sesiones MAX aportan adquisición y registro local. No contienen
  eventos de envío de informes; los ensayos de red transportan datos `T:`.
  Por tanto, este ZIP no demuestra por sí solo un flujo MAX → LoRa → otro
  teléfono ni operación simultánea de registro MAX y ensayo de red.

### Conservación y procedimiento

El 6/11 se prepararon copias CSV consolidadas, un Excel con columnas separadas
y un informe de resultados de 12 páginas en PDF y Word. Los derivados y el
informe se conservaron fuera del repositorio por contener datos fisiológicos.
El análisis externo incluye P95 calculado desde ACK individuales; esto no
incorpora esa métrica a la aplicación ni al firmware.

- Originales rescatados: [carpeta de resultados](resultados/README.md).
- Guardar escenario, runId, nodo/rol, sentido, versiones, RF, antena,
  alimentación, posiciones/altura, obstáculos y repetidor con cada par de archivos.
- Mantener originales inmutables; realizar filtros/cálculos en copias y
  guardar reglas de selección. No comparar pruebas con carga distinta como
  si solo hubiera cambiado el repetidor.
- Separar ensayos completos, interrumpidos y datos desconocidos; conservar
  los desfavorables. No seleccionar únicamente los que dieron buen PDR.
- Un ensayo antiguo no es prueba de rendimiento de la nueva versión 5.6.1.
- Para publicación, usar copias revisadas/anonimizadas y conservar en privado
  IDs, coordenadas, datos fisiológicos y cualquier contenido sensible.

Definiciones y límites completos: [Detalle técnico](../DETALLE_TECNICO_Y_METRICAS.md).
