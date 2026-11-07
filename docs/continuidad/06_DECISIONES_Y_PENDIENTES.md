# Decisiones, pendientes y trabajo siguiente

Estado: 6/11/2026. Esta lista conserva el alcance; no autoriza cambios,
publicaciones, nuevas tareas en segundo plano ni cargas automáticas.

## Decisiones que se mantienen

- Una app común y un sketch con perfiles, manteniendo V3 y V4 compatibles.
- App en español. Protocolo propio 5.1; no migrar a Meshtastic/MeshCore.
- AES-128-GCM en el teléfono, no en el nodo; lectura histórica AES-256.
- Broadcast de alcance directo, sin ACK. No describirlo como broadcast multihop.
- Ensayos dirigidos de 100 intentos secuenciales, preparados y registrados en
  ambos teléfonos, con cierre de aplicación separado del ACK radio.
- Datos de red y sesiones MAX en almacenes distintos y con privacidad explícita.
- MAX como apoyo experimental, con consentimiento y envío manual, no diagnóstico.
- V4_3 del kit probado: RX39/9600, TX UART -1, WAKE40/RESET42 con pull-ups
  débiles durante ON. No cambiar de vuelta sin evidencia.
- No generalizar el pinout probado a V4.2/R8 ni alterar V3 para arreglar V4.
- No limpiar historiales, borrar toda la flash ni modificar puentes del hardware
  como primer recurso ante un error.

## Resuelto / base que no se debe rehacer sin una nueva incidencia

- [x] App, traducción y APK 1.4.1 preparados; fuentes y comprobaciones registradas.
- [x] Separación de perfiles de firmware y compatibilidad mantenida en código.
- [x] Implementación de ensayos y exportación de ambos teléfonos.
- [x] Registro/compartición manual de apoyo MAX en código.
- [x] Corrección de recuperación FIFO y diagnóstico MAX.
- [x] Diagnóstico GPS encontró NMEA válido en RX39 a 9600.
- [x] Firmware 5.6.1 compilado V3/V4_3; pruebas host pasaron.
- [x] Usuario informó funcionamiento correcto después de la corrección GPS.
- [x] Carpeta de continuidad y mensaje para nuevo chat preparados.
- [x] Captura MAX de 100 instantáneas autorizada e implementada en app
  1.4.2 / código 12; modo manual e historiales preservados. TypeScript,
  50 pruebas Node y 15 rutas web verificados; firmware sin cambios. APK
  release ARM64 compilado, versión/código/firma verificados; no instalado.
- [x] El 5/11 se verificaron seis CSV físicos de captura MAX: 100 instantáneas,
  índices completos y cierre automático; no es validación clínica.
- [x] CSV limpios, Excel e informe PDF/Word de resultados preparados el 6/11,
  conservados en almacenamiento local externo por contener datos fisiológicos.

Cada marca tiene el alcance de su descripción: una prueba host no acredita
un enlace de campo, y una confirmación general no es un informe clínico.

## Pendientes concretos

- [ ] Completar la aceptación física MAX de app 1.4.2: interrupción parcial,
  exportación JSON y reapertura del historial tras reiniciar la app. Los seis
  CSV de 100 instantáneas ya se validaron, incluidas lecturas ausentes.

- [ ] Elegir si la próxima tarea es implementar nuevas métricas, analizar
  archivos históricos o ejecutar otra campaña experimental.
- [ ] Si se implementan métricas, definir primero denominadores, tratamiento
  de timeouts/desconocidos, cierre válido y exportación. Selección sugerida:
  P95 ACK, éxito por intento, comparación con/sin repetidor.
- [ ] Si se usan resultados históricos en tesis, recalcular desde originales
  con reglas reproducibles. Resolver que los dos adjuntos E1 son idénticos.
- [ ] Conservar un log de aceptación del principal 5.6.1 (versión, NMEA,
  fix si corresponde, apagado/encendido) para documentar el GPS funcionando.
- [ ] Registrar aceptación mixta V3/V4, mensajería y uso simultáneo de GPS/MAX
  cuando sea relevante para la campaña. No asumir pruebas físicas no aportadas.
- [ ] Probar y documentar en dos teléfonos el flujo completo de informe MAX,
  persistencia/exportación y recepción. No confundirlo con la simulación.
- [ ] Medir autonomía/energía/precisión GPS si se quieren incluir como resultados;
  actualmente no se derivan de RSSI, voltaje nominal ni contador de satélites.
- El usuario autorizó expresamente el commit y publicación el 6/11. Esta
  actualización reúne app 1.4.2, firmware 5.6.1, diagnósticos y continuidad;
  comprobar el commit y la referencia remota mediante Git. Las evidencias
  privadas y los binarios no se incluyen.
- [ ] Elegir carcasa de mano o acoplada al celular, batería, dimensiones y
  arquitectura final de la PCB. Véase [prototipo y PCB](07_PROTOTIPO_Y_PCB.md).

## Riesgos al continuar

| Riesgo | Acción segura |
| --- | --- |
| Clonar GitHub y perder cambios locales | Revisar commit/diff; preservar el árbol local antes de cambiar de checkout |
| Compilar una copia vieja de `experimental/` | Trabajar desde `firmware/` y confirmar versión en arranque |
| Elegir COM histórico | Verificar puerto actual y placa; no seleccionar por suposición |
| Rellenar ausencias con cero | Conservar nulos/desconocidos y tamaño real de muestra |
| Confundir ACK con entrega útil | Revisar RX app, descifrado y guardado por separado |
| Hacer público un CSV/JSON o log sensible | Mantener área privada ignorada; anonimizar copia antes de compartir |
| Reinterpretar estado declarado como evaluación médica | Mantener declaración humana y límites técnicos |
| Trabajar varios chats sobre los mismos archivos | Separar alcance/coordinar cambios; no abrir editores concurrentes por defecto |

## Cómo actualizar la continuidad

Al cerrar una tarea registrar fecha, archivos modificados, comprobaciones
realmente ejecutadas, versión/commit, confirmación física y pendientes.
Mantener breve el índice y enviar el detalle al documento temático.
No borrar decisiones históricas: marcar qué cambió y con qué evidencia.

El próximo chat debe empezar proponiendo o ejecutando **la tarea que el
usuario indique**, no implementando automáticamente todas estas ideas.
