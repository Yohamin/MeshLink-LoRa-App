# Contexto, cronología y estado actual

Referencia: 6/11/2026, America/Lima. Proyecto: **MeshLink-LoRa-App**.

## Objetivo y arquitectura

Comunicación en emergencias cuando no están disponibles las redes habituales.
Cada celular se conecta por BLE a un nodo Heltec; los nodos intercambian
mensajes por LoRa. La interfaz de mensajería, actualmente en español, se
inspira en aplicaciones conocidas sin utilizar sus servidores.

```text
Celular A <-> BLE <-> Nodo A <-> LoRa <-> Nodo B <-> BLE <-> Celular B
                                  |
                             Nodo repetidor
```

Se conservan mensajes dirigidos, broadcast de alcance directo y selección
automática de un repetidor para mensajes dirigidos. No atribuir a esta
implementación encaminamiento arbitrario ni broadcast reenviado por toda la red.

## Versiones y evidencias

| Componente | Estado al consolidar |
| --- | --- |
| App | Fuente 1.4.2, Android versionCode 12, paquete `com.yohamin.meshlink` |
| APK | 1.4.2 / código 12, release ARM64 compilado el 4/11; versión/firma verificadas, sin instalación automática |
| Firmware | Fuente y binarios locales 5.6.1 para V3 y V4_3 |
| Radio/BLE | Protocolo propio 5.1 y UUID existentes, sin cambios por la corrección GPS |
| GPS | Diagnóstico r2 recibió NMEA válido en RX39/9600; después el usuario reportó funcionamiento correcto |
| MAX30102 | Adquisición r2 y diagnóstico r3 en código; existen logs físicos, sin validación clínica |
| Captura MAX de 100 registros | App 1.4.2: 50 pruebas Node pasan; seis CSV físicos de 100 instantáneas/cierre por objetivo verificados el 5/11, sin validación clínica |
| Ensayos de 100 mensajes | Coordinación, persistencia y exportación implementadas; la simulación no prueba por sí sola dos radios reales |
| Métricas adicionales | Propuestas; no añadidas todavía a los resúmenes |

### Comprobaciones previas que deben conservarse como tales

- App 1.4.1: TypeScript, 45 pruebas Node y exportación web de 15 rutas
  comprobados en la etapa anterior. No se repitieron para organizar esta carpeta.
- APK previo 1.4.1, antes de recompilar el 4/11: `android/app/build/outputs/apk/release/app-release.apk`,
  46687718 bytes, compilación previa verificada como 1.4.1 / código 11 / ARM64.
- Firmware 5.6.1, compilado el 2/11/2026:
  - V3: programa 770183 bytes, RAM estática 33132; archivo `.ino.bin` 770336 bytes.
  - V4_3: programa 798489 bytes, RAM estática 37956; archivo `.ino.bin` 798640 bytes.
- Pasaron las pruebas host de NMEA/encaminamiento en perfiles 3/42/43/48,
  arranque GPS V4.3 y pruebas MAX de ventana, recuperación y perfiles sin sensor.
- No se flasheó ninguna placa automáticamente. La carga y los reportes de
  funcionamiento físico son acciones/evidencias diferentes de compilar.

## Cronología resumida del chat

1. Se planteó mensajería de emergencia sobre LoRa con interfaz familiar.
2. Se desarrolló la app y se resolvieron incidencias de compilación Android en
   Windows: Gradle/CMake/Ninja, rutas largas y unidad `M:`. La pantalla de
   development build necesitaba Metro; se preparó después un APK release.
3. Se trabajó la compatibilidad de cifrado y la clave compartida. Hubo errores
   históricos de descifrado y del API nativo `fromCombined`. La fuente actual
   cifra en el teléfono con AES-128-GCM y mantiene lectura de mensajes AES-256
   antiguos. No reabrir aquellas incidencias sin una nueva reproducción.
4. Se tradujo la app al español y se publicó el proyecto en GitHub. Al principio
   era privado; por solicitud posterior se dejó público para colaborar.
5. Se analizaron pruebas de campo y se corrigieron los escenarios finales:
   parque, edificios con puente y estacionamiento en sótano. El escenario de
   ascensor no forma parte de esa terna final.
6. Se añadieron perfiles V4 manteniendo V3, integración GPS y MAX30102 opcional.
7. Se implementaron Ensayos coordinados de 100 mensajes con registro en ambos
   teléfonos, cierre persistido y exportación CSV/JSON.
8. Se implementaron sesiones MAX con consentimiento y envío manual de informes
   a un nodo o broadcast. El estado de ayuda se declara; no se deduce del pulso.
9. Se investigó el MAX: FIFO se desbordaba sin muestras. La revisión r2 limita
   recuperaciones y verifica los punteros; r3 incorpora diagnóstico/metadatos.
10. Se investigó GPS con cero bytes en dos kits V4 distintos. El diagnóstico
    r2 con pull-ups débiles recibió datos por GPIO39 a 9600. Firmware 5.6.1
    integra RX39 sin TX y arranque no bloqueante solo para V4_3.
11. El 3/11/2026 el usuario confirmó funcionamiento y preguntó por priorización
    de métricas. Las ampliaciones propuestas aún no se implementaron.
12. Se solicitó organizar el contexto para continuar en otro chat.
13. El 4/11/2026 el usuario autorizó implementar la captura de 100 registros
    del MAX: se añadió a la app 1.4.2, manteniendo firmware 5.6.1, V3 y protocolo
    5.1. TypeScript, 50 pruebas Node y 15 rutas web verificados; no equivale
    a una captura física ni a validación clínica. APK 1.4.2 ARM64 compilado,
    versión y firma verificadas, sin instalar. Detalle en [aplicación](02_APLICACION.md).
14. El 5/11 se analizó `PruebasFinalesTesis.zip` sin modificarlo. Se validaron
    seis capturas MAX de 100 instantáneas y el cruce de red: la pareja nueva
    de E1 y la carpeta Receptor para E2/E3. E1 usa pausa de 2 s y app 1.4.2;
    E2/E3 usan 5 s y app 1.4.1. No son condiciones controladas idénticas.
    Evidencias originales y análisis detallado permanecen fuera del repositorio;
    no se incorporaron identificadores personales ni valores fisiológicos.
15. El 6/11 se crearon copias CSV limpias, un Excel con columnas separadas y
    un informe de resultados de 12 páginas en PDF y Word. Los originales,
    derivados e informes con datos fisiológicos permanecen fuera del repositorio.
    El P95 calculado en ese informe no está implementado en la app.
16. Se exploraron carcasas de mano y acopladas mecánicamente al teléfono,
    con MAX integrado. Se propuso una PCB base para Heltec V4.3; batería,
    medidas y diseño electrónico definitivo siguen pendientes.
17. El 6/11 el usuario solicitó un commit y publicación en GitHub de todo
    el trabajo actual. Esta actualización incorpora fuentes y documentación;
    no incorpora datos privados, credenciales ni salidas de compilación.

## Ubicación y situación de Git

Carpeta de trabajo actual:

```text
C:\Users\Yohamin\Documents\Codex\2026-08-08\u\MeshLink-LoRa-App
```

El directorio superior `u` contiene otros trabajos. No confundirlos con este
repositorio ni copiar el código antiguo de otro proyecto como base actual.

Repositorio: [Yohamin/MeshLink-LoRa-App](https://github.com/Yohamin/MeshLink-LoRa-App).
Base histórica consultada el 3/11/2026, antes de esta actualización:

- Visibilidad: **público**; rama por defecto: `main`.
- `main` remoto y último commit local: `4986f4b0339c640277d3b2b1a980194d2212ac88`.
- Mensaje: `Update MeshLink app 1.4.1 and firmware 5.6.0`.
- Los cambios 5.6.1, diagnósticos y esta continuidad no estaban incluidos
  en ese commit. La actualización del 6/11 los reúne con la app 1.4.2.
- Antes de publicar: revisar `git status`, diffs, archivos ignorados y privacidad.
  La organización inicial no autorizaba commit/push; la solicitud explícita
  del usuario del 6/11 sí autoriza esta publicación del código y documentación.

Para conocer el estado posterior, revisar `git log -1`, `git status` y
la referencia remota actual. El hash de la base histórica no identifica esta
actualización. Los originales privados y los informes derivados se conservan
por separado, sin incorporarlos a GitHub.

## Alcance de «ya funciona bien»

Se registra como confirmación del usuario posterior a la corrección GPS.
No inferir de esa frase un valor de precisión, autonomía, fijación documentada,
prueba de cien mensajes completa ni aceptación clínica del MAX. Pedir solo
la evidencia adicional necesaria para la tarea futura, sin reiniciar el
diagnóstico básico si no aparece un fallo nuevo.
