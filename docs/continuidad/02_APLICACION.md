# Aplicación MeshLink

Estado en fuente: **1.4.2 / código Android 12**. Consultar siempre `app.json`,
`package.json` y el lockfile antes de actualizar dependencias.

## Tecnología

- TypeScript, Expo 57, React 19.2.3 y React Native 0.86.2.
- Expo Router: navegación por archivos de `src/app/`.
- `react-native-ble-plx`: conexión BLE real al nodo.
- `@noble/ciphers`: AES-GCM en el teléfono.
- AsyncStorage: chats, configuración y registros; SecureStore para secretos
  donde lo define el código. Esto no cifra automáticamente todas las bases.
- Expo Location y GPS del nodo: ubicación manual en un mensaje SOS.
- FileSystem/selector de Android: exportación de registros.

Versiones y funciones detalladas: [Detalle técnico](../DETALLE_TECNICO_Y_METRICAS.md).

## Pantallas y funciones

- **Conectar:** descubre el dispositivo `LoRaMesh-*` y establece BLE.
- **Chats:** mensajes dirigidos, broadcast, SOS y mensajes/informes recibidos.
- **Nodos:** participantes detectados, nombres e indicadores de enlace.
- **Red:** estado, métricas y entrada al apartado de ensayos/apoyo.
- **Ajustes:** nombre, privacidad/clave compartida, GPS y sensor.
- **Ensayos:** selección de destino, preparación de ambos teléfonos, 100
  intentos secuenciales, historial y exportación.
- **Apoyo en emergencias:** sesiones MAX con consentimiento, declaración
  de la persona y confirmación manual del informe/destino; modo automático
  de 100 instantáneas BLE y modo manual.

Las pantallas relevantes están en `src/app/(tabs)/`, `src/app/chat/`,
`src/app/field-tests.tsx` y `src/app/health-measurements.tsx`.

## Seguridad y mensajería

- Los mensajes nuevos usan **AES-128-GCM**, marcador `M2:`. Se mantiene
  compatibilidad de descifrado con mensajes antiguos AES-256-GCM.
- El firmware no descifra el cuerpo: transporta el payload opaco.
- Los participantes deben usar la misma clave de red y modo compatible.
- La clave compartida no proporciona identidad individual autenticada de
  cada remitente; los encabezados radio y ACK no tienen el cifrado del cuerpo.
- El límite actual de texto cifrado es 32 bytes UTF-8, no 32 caracteres.
- Las operaciones BLE se serializan para no entremezclar fragmentos.
- No volver a implementar AES en el ESP32 al modificar esta arquitectura.

Fuente: [crypto.ts](../../src/lib/crypto.ts),
[cola BLE](../../src/lib/serial-task-queue.ts),
[protocolo](../FIRMWARE_PROTOCOL.md).

## Dónde se guarda cada información

| Información | Almacenamiento/alcance |
| --- | --- |
| Chats | Teléfono; retención global de los últimos 500 mensajes |
| Telemetría de ensayos | Almacén paginado separado; registro acotado al ensayo |
| Sesiones MAX | Almacén separado, hasta 1800 registros por sesión, páginas de 32 |
| Contadores del nodo | RAM por arranque/reset; no diario autónomo en flash |
| Informes MAX recibidos | En chats e informes recibidos, con la retención de mensajes |
| Exportaciones CSV/JSON | Copias fuera de la app; no se cifran automáticamente |

No hay registro permanente de todo lo sucedido mientras BLE estuvo ausente.
La telemetría de red excluye claves, contenido de mensajes, GPS y fisiología;
MAX tiene su almacén propio. Desinstalar/borrar datos puede eliminar registros
locales. Exportar no borra el original.

## Compilación y prueba

### Captura MAX de 100 instantáneas — 4/11/2026

- Implementada en `health-journal.ts`, `health-measurements-context.tsx` y
  `health-measurements.tsx`. La opción de 100 está seleccionada inicialmente;
  desactivarla conserva el registro manual de hasta 1800 eventos.
- Cuenta `sample`, incluidos los valores inválidos/ausentes. Los eventos
  `share` no avanzan el objetivo. El cierre se hace en la cola de persistencia
  al guardar la instantánea 100, impidiendo que las capturas en cola excedan
  el objetivo. No es un temporizador de 100 segundos ni 100 lecturas válidas.
- Progreso `n/100`; una interrupción conserva el conteo parcial sin reanudar.
  Resumen por sesión: pulso válido, SpO₂ válida y ambos, usando todas las
  instantáneas guardadas como denominador. No implica exactitud clínica.
- JSON incluye `summary` y metadatos de objetivo/conteo. CSV añade modo,
  objetivo, índice de instantánea, conteo final, estado, motivo y fechas de
  sesión. Los historiales antiguos se recuperan como manuales sin imponerles
  un objetivo ni eliminar sus registros.
- Un fallo de página/índice detiene la captura y permite rescatar datos;
  no se presenta como completada una captura cuyo cierre no pudo persistirse.
- Firmware 5.6.1 y adquisición MAX permanecen iguales. El modo requiere
  instalar la app 1.4.2; no requiere cargar firmware nuevo.
- Verificado: TypeScript, **50 pruebas Node** (5 nuevas pruebas de captura,
  interrupción, concurrencia, almacenamiento y compatibilidad), exportación
  web de **15 rutas**. Aceptación física de 100 instantáneas pendiente.
- Vista web comprobada: selector automático seleccionado inicialmente y
  alternancia al modo manual; no simula una captura física BLE.
- APK release ARM64 **1.4.2 / código 12** compilado el 4/11/2026 con
  `build-android-release.ps1` (Gradle `BUILD SUCCESSFUL`, 5 min 30 s).
  `aapt` confirmó paquete/versión/ABI y `apksigner verify` terminó sin error.
  Archivo `android/app/build/outputs/apk/release/app-release.apk`, **46693642 bytes**;
  SHA-256 `e777b2d66687c22254117b42211fed8f0b1698e6ab2c95451e5261020b18867b`.
  La ejecución restringida no pudo crear `M:`; la compilación fuera de esa
  restricción terminó correctamente. No se instaló ni se cargó firmware.
- Cambios locales al 4/11, reunidos en la actualización solicitada el 6/11:
  tres módulos MAX, sus pruebas, versión
  de app/Android y documentación/continuidad; se preservaron los cambios
  previos del árbol y los resultados originales.

Actualización de evidencia, 5/11/2026: el ZIP aportado por el usuario contiene
seis CSV MAX de app 1.4.2 / firmware 5.6.1, cada uno con 100 filas `sample`,
índices 1–100, 100 uptimes distintos y `sample_target_reached` / `completed`.
La duración es de 99,19–99,77 s. Esto respalda adquisición, guardado y cierre
automático en hardware; no verifica exactitud clínica ni la reapertura después
de reiniciar la app. No se aportó JSON en este ZIP. Los archivos y valores
fisiológicos originales se conservaron fuera del repositorio.

### Comandos

Desde la raíz del repositorio:

```powershell
npm run typecheck
node --experimental-strip-types --test tests/gps-and-ble.test.mjs tests/health.test.mjs tests/health-measurements.test.mjs tests/telemetry.test.mjs tests/trial-pair.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-android-release.ps1
```

El último comando genera un APK y puede necesitar permisos del entorno local;
no lo ejecutar para una tarea únicamente documental. La salida habitual es
`android/app/build/outputs/apk/release/app-release.apk`. Verificar versión,
ABI y firma del archivo real, no solo su nombre.

- El release de pruebas funciona sin Metro; la pantalla de development build
  de Expo no equivale a la interfaz MeshLink cargada.
- Expo Go no sustituye el build nativo con BLE.
- El entorno usa rutas Windows, SDK/JBR y `subst M:` del script existente.
  Confirmar disponibilidad de la unidad y no cambiar de shell para borrar rutas.
- Es firma local de pruebas, no un proceso de distribución de producción.
- Para probar cambios de app, instalar la revisión compatible en ambos teléfonos.
- **La corrección GPS 5.6.1 no requiere recompilar el APK 1.4.1.**

## Guías y módulos

- [GPS de la app](../../src/lib/gps.ts).
- [Telemetría y resúmenes](../../src/lib/telemetry.ts).
- [Coordinación de ensayos](../../src/lib/trial-coordinator.ts).
- [Sesiones MAX](../../src/lib/health-journal.ts).
- [Informes MAX](../../src/lib/health-share.ts).
- [Guía de apoyo en emergencias](../MEDICIONES_MAX30102.md).

En el historial hubo errores de red/Gradle/CMake/Ninja y de guardado/descifrado.
No son incidencias abiertas por defecto: partir de la fuente funcional actual
y exigir reproducción antes de cambiar versiones, borrar cachés o datos.
