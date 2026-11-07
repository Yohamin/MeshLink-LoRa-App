# MeshLink: empezar aquí

Estado consolidado: **6 de noviembre de 2026**, zona America/Lima.

Esta carpeta permite continuar el proyecto en otro chat y compartir su
contexto de forma organizada. Es una síntesis operativa del chat y del código
revisado, **no una exportación literal de toda la conversación**.

## Lectura mínima para retomar

1. [Contexto y estado actual](01_CONTEXTO_Y_ESTADO_ACTUAL.md).
2. [Decisiones y pendientes](06_DECISIONES_Y_PENDIENTES.md).
3. El documento del tema que se vaya a trabajar.
4. Revisar el código y `git status` antes de modificar: una guía no demuestra
   por sí sola cómo está una instalación o qué está publicado.

| Tema | Documento |
| --- | --- |
| Aplicación, pantallas, cifrado, APK y almacenamiento | [02_APLICACION](02_APLICACION.md) |
| Perfiles Heltec, librerías, compilación y carga | [03_FIRMWARE_V3_Y_V4](03_FIRMWARE_V3_Y_V4.md) |
| GPS L76K y MAX30102, conexiones y correcciones | [04_GPS_Y_MAX30102](04_GPS_Y_MAX30102.md) |
| Ensayos, escenarios, métricas y propuestas | [05_ENSAYOS_Y_METRICAS](05_ENSAYOS_Y_METRICAS.md) |
| Carcasas, batería e integración de PCB propuestas | [07_PROTOTIPO_Y_PCB](07_PROTOTIPO_Y_PCB.md) |
| Mensaje para pegar al iniciar otro chat | [INICIAR_NUEVO_CHAT](INICIAR_NUEVO_CHAT.md) |
| Archivos de evidencia y privacidad | [Resultados](resultados/README.md) |

## Punto de partida

- App en fuente: **1.4.2 / código Android 12**.
- APK 1.4.2 release ARM64 compilado el 4/11; versión y firma verificadas,
  sin instalación automática. Archivo en la ruta habitual de `android/app/build/outputs/apk/release/`.
- Captura MAX de **100 instantáneas BLE** con cierre automático implementada;
  mantiene el modo manual y los historiales previos. TypeScript, 50 pruebas
  Node y exportación web de 15 rutas verificados. El 5/11 se validaron seis
  CSV físicos con 100 instantáneas y cierre por objetivo; faltan aceptación
  física de interrupciones, JSON y reapertura tras reinicio. Los flags de
  validez técnica no acreditan exactitud clínica.
- Firmware en fuente: **5.6.1**, protocolo LoRa propio **5.1**.
- Hardware principal actual: Heltec **V4.3/4.3.1 + Quectel L76K**; mantener V3.
- El usuario informó el 3/11/2026: **«ya funciona bien»**, después de la
  corrección GPS. No hay en esta carpeta un nuevo log del firmware principal
  que certifique `fix=1`, precisión o una validación completa de todos los flujos.
- Las métricas adicionales de red (P95, beneficio del repetidor) se discutieron,
  **no se implementaron todavía**.
- La actualización del 6/11 reúne app 1.4.2, firmware 5.6.1, diagnósticos,
  pruebas y continuidad para el commit y publicación solicitados por el usuario.
  La base anterior es `4986f4b...` (app 1.4.1 / firmware 5.6.0); consultar
  el historial de Git para identificar esta revisión, sin usar aquella base
  como referencia de la fuente actual. Resultados privados y binarios quedan fuera.
- El 6/11 se prepararon CSV limpios, Excel y un informe de resultados en
  almacenamiento local externo al repositorio. Las carcasas y PCB siguen
  como propuestas; aún no existen archivos de fabricación.

## Cómo interpretar los estados

- **Implementado:** está en el código; no implica prueba física completa.
- **Verificado por software:** compilación o pruebas automatizadas concretas.
- **Observado en hardware:** respaldado por un registro identificado.
- **Confirmado por el usuario:** reporte del usuario, sin atribuirle mediciones
  adicionales que no haya aportado.
- **Propuesto:** idea discutida; requiere autorización y trabajo posterior.
- **Pendiente:** no afirmar que se resolvió ni sustituir datos ausentes por cero.

El código vigente y las evidencias identificadas prevalecen sobre versiones
antiguas citadas en el chat. Las guías anteriores tienen secciones históricas;
por ejemplo, `INICIO_EXPERIMENTAL.md` nació con app 1.3.0 / firmware 5.5.0.

## No perder al abrir otro chat

- Trabajar en la misma carpeta del proyecto, no empezar otra app desde cero.
- Mantener compatibilidad V3/V4, cifrado, UUID BLE y protocolo 5.1.
- No volver a configurar GPIO39 como TX en el kit V4_3 probado.
- No interpretar ACK como lectura humana ni como confirmación de descifrado.
- MAX30102 es apoyo experimental, no clasificador médico.
- No subir datos personales, claves, GPS o fisiología a un repositorio público.
- No mover `src/`, `android/` o `firmware/` para organizar documentación.

## Mantenimiento

Después de un cambio importante, actualizar estado, versión, evidencia,
pendientes y situación de Git. No marcar una propuesta como implementada por
haberla descrito. Conservar los registros originales y sus hashes; no editar
resultados para que coincidan con una interpretación.

La organización inicial del 3/11 no creó ni archivó chats, no modificó código
de ejecución ni publicó cambios. La actualización del 4/11 añade el modo MAX
de 100 instantáneas; ver [aplicación](02_APLICACION.md) para su validación.

## Verificación inicial de la organización del 3 de noviembre

- 13 documentos Markdown de continuidad/resultados y 47 enlaces locales
  revisados: destinos existentes al preparar la carpeta.
- 9 copias de evidencia verificadas contra los originales por SHA-256;
  3 imágenes temporales ausentes identificadas, sin fabricar sustitutos.
- Área privada y manifiesto comprobados como ignorados por Git; también se
  excluyen las salidas de compilación del diagnóstico Arduino.
- Dos adjuntos E1 tienen idéntico hash; advertencia preservada en las fichas.
- `git diff --check` sin errores de whitespace. No se repitieron pruebas de
  ejecución para esta tarea documental.

## Comprobaciones para la actualización del 6 de noviembre

- TypeScript sin errores y 50 pruebas Node correctas.
- Exportación web correcta de 15 rutas, sin sustituir la compilación nativa
  del APK ya registrada el 4/11.
- Pruebas host correctas de NMEA/encaminamiento en perfiles 3/42/43/48,
  arranque GPS V4.3, analizador y sketch aislado GPS-DIAG r2, ventana MAX,
  recuperación FIFO y perfiles con sensor deshabilitado.
- Área privada, archivos de firma y salidas de compilación excluidos por Git.
  Los CSV, Excel e informes de resultados no forman parte de esta publicación.
- Se conserva el protocolo 5.1 y la compatibilidad V3; no se instaló APK ni
  se cargó firmware como parte de esta actualización del repositorio.
