# Apoyo en emergencias · MAX30102 — app 1.4.1 / código 11 y firmware 5.6.0

## Estado y alcance

Función preparada en fuente: sesiones locales con consentimiento, exportación
CSV/JSON y envío **manual** de una instantánea a un nodo o por broadcast.
No se envían automáticamente datos fisiológicos. No hay diagnóstico,
clasificación de gravedad ni garantía de asistencia médica. «Me siento bien»,
«Tengo molestias» y «Necesito ayuda» son declaraciones de la persona o de
quien la asiste, no conclusiones
del sensor. No se debe retrasar pedir ayuda por una lectura aparentemente
favorable: la [FDA advierte no depender únicamente de un pulsioxímetro](https://www.fda.gov/medical-devices/products-and-medical-procedures/pulse-oximeters).

La V4 conserva la adquisición y recuperación FIFO de r2. Firmware 5.6.0 / r3
añade metadatos a los paquetes BLE para registrar arranque, tiempo de nodo y
diagnóstico. Solo el perfil V4_3 adquiere MAX30102. V3 mantiene mensajería,
recepción y retransmisión compatibles, sin habilitar ese sensor.
Las instantáneas periódicas se envían cada segundo con adquisición activada;
apagado, cada 10 segundos para reducir carga BLE. Consultas y cambios de
activación responden inmediatamente, independientemente de ese intervalo.

El APK 1.3.0 no contiene esta pantalla. El paquete 1.4.0 / 5.6.0 se compiló
correctamente; la revisión de interfaz 1.4.1 también tiene APK ARM64 compilado
localmente. Los binarios no se incluyen en el repositorio de fuentes.
No se ha validado clínicamente, ni se han hecho envíos físicos de esta función.

## Interfaz de apoyo (1.4.1)

Primero se elige el estado declarado, sin selección automática a partir del
pulso o la SpO₂. «Necesito ayuda» destaca la solicitud SOS, pero seleccionarlo
no transmite nada: siempre requiere elegir destinatario y confirmar el informe.
«Tengo molestias» no marca SOS automáticamente.

La calidad distingue lecturas recientes, medición parcial o «Medición no
disponible; repetir». Es disponibilidad técnica, no una clasificación clínica.
Los valores caducados no se muestran como actuales. Se indica la hora local
de la medición; Rojo/IR, FIFO e I²C quedan en detalles técnicos desplegables.
Una instantánea sin valores puede compartir el estado declarado durante una
sesión activa. Si no se puede abrir una sesión, usar SOS de texto desde Chats
sin esperar a obtener lecturas. No hay garantía de respuesta o asistencia.

Los informes recibidos priorizan el estado declarado, conservan los valores
ausentes, indican su hora (del informe si no hay medición) y recuerdan contactar
a la persona. No son seguimiento en vivo ni certificación de identidad.

## Generar e instalar

En PowerShell normal desde la raíz del proyecto:

```powershell
cd "C:\Users\Yohamin\Documents\Codex\2026-08-08\u\MeshLink-LoRa-App"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\generar-paquete-experimental.ps1
```

El script utiliza las nuevas versiones 1.4.1 / 5.6.0, comprueba software,
compila V3 y V4_3 y prepara APK, firmware y guías en una carpeta nueva. No
instala el APK ni carga placas. Solo usar un paquete con marcador de
compilación completa, no una carpeta de validación software.

Para compilar y cargar únicamente la V4.3.1 si sigue en COM4, cerrar antes
el monitor serie y mantener la antena LoRa conectada:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\build-firmware.ps1 -Board V4_3 -Jobs 4 -ConfigFile "C:\Users\Yohamin\.arduinoIDE\arduino-cli.yaml" -OutputDirectory "$PWD\firmware\build\V4_3-5.6.0" -Port COM4
```

Comprobar `MeshLink 5.6.0` y `[HEALTH-DIAG r3]` al arrancar. No necesita
modificar la alimentación, pines, puentes del breakout ni corriente LED.
Instalar app 1.4.1 en ambos teléfonos para interpretar «Tengo molestias»
(código `M` en H1). Se mantienen los códigos N/A/B de 1.4.0. Un receptor
1.4.0 no reconoce M y puede mostrar el texto compacto sin formatearlo.
No hace falta modificar el firmware 5.6.0 para este cambio. Un firmware de
mensajería previo compatible puede transportar ese texto sin interpretarlo.

## Registrar

1. Conectar la V4 por BLE en MeshLink. Abrir **Ajustes → Apoyo en emergencias
   · MAX30102** o **Red → Apoyo en emergencias**.
2. Activar «Leer sensor del nodo». Sigue apagado en cada reinicio.
3. Usar un código/alias de participante, evitando nombres personales cuando
   no sean necesarios. Obtener su autorización antes de registrar/compartir.
4. Pulsar «Iniciar registro con consentimiento» y aceptar el aviso de datos
   sensibles. No se registra por permanecer conectado ni por ver Ajustes.
5. Mantener la pantalla visible y la app en primer plano. Finalizar el
   registro no apaga automáticamente el sensor; utilizar su interruptor.

Salir de la pantalla, pasar a segundo plano/bloquear, perder BLE, apagar el
sensor, cambiar de nodo/arranque o detectar retroceso de uptime finaliza el
registro. No se reanuda automáticamente. Un cierre abrupto se marca como
interrumpido al abrir de nuevo la app. Un fallo de almacenamiento detiene
captura y nuevos envíos; exportación de rescate sigue disponible si los
archivos pueden leerse. Tras liberar espacio/resolver el error, reiniciar.

Se conservan las instantáneas BLE recibidas (~1/s), no las 25 muestras/s
originales ni una onda PPG completa. Límite 1800 registros por sesión,
incluyendo eventos de envío; iniciar otra después de exportar si se necesita.
No se rellenan huecos ni se sustituyen valores inválidos por cero.

## Qué se guarda

- ID de sesión, alias, nodo/arranque, placa, versiones app/firmware y revisión.
- Hora del teléfono, uptime, edades de muestras y estimación, estado,
  pulso y SpO₂ aceptados o `null`, Rojo/IR y ventana de muestras.
- Muestras acumuladas, FIFO, errores I²C, configuración, saturación, falta
  de muestras, discontinuidades, recuperaciones verificadas/fallidas,
  registros diagnósticos observados y último fallo.
- Intentos de compartir, destino, referencia, informe y resultado local:
  `attempt`, `submitted` o `failed`. `submitted` significa aceptación por el
  transporte BLE, NO confirmación del teléfono receptor ni atención humana.

El almacén es separado de Ensayos. No incluye claves, GPS, mensajes privados
ni ciphertext. El dato de arranque por paquete evita mezclar reinicios. Los
contadores del sensor son acumulados desde el arranque, no tasas por sesión.
Los relojes de teléfonos no están sincronizados: no inferir latencia de una
vía ni vigencia clínica comparando sus horas.

## Compartir

1. Durante una sesión activa, escoger una declaración opcional de la persona.
2. Elegir un nodo o **broadcast**. La instantánea puede tener uno o ambos
   canales sin lectura válida; no se reutilizan valores antiguos para llenarla.
3. «Revisar informe y destinatario» o «Revisar solicitud de ayuda (SOS)»
   muestra exactamente qué se enviará y a quién.
   La confirmación caduca en 30 segundos y el transporte la vuelve a comprobar
   después de esperar en la cola BLE.
4. Usar cifrado y una clave propia, distinta de `ClaveSecreta123!`, en ambos
   teléfonos. No se permite enviar estos informes en texto plano.
5. Consultar el resultado en Chats. «Necesito ayuda» marca SOS **declarado**,
   sin dispararlo automáticamente a partir de los números del sensor.

Se transmite un texto H1 de hasta 32 bytes mediante los comandos existentes.
Incluye pulso/SpO₂, hora declarada por el emisor, estado declarado y una
referencia corta. NO envía sesión completa, alias, señales Rojo/IR ni GPS.
Un envío ya comenzado no puede retirarse; salir/cancelar impide los pendientes
que aún no empiezan. No hay envío periódico ni reintentos automáticos.

Broadcast llega al alcance directo, no tiene ACK ni prueba de recepción
de todos los participantes. La clave es compartida por la red: no autentica
la identidad del paciente ni garantiza confidencialidad exclusiva entre dos
personas. Se rechazan informes H1 en texto plano; los demás mensajes siguen
siendo compatibles con la configuración habitual.

El receptor ve el informe en su chat y en «Informes recibidos», con hora de
recepción distinta de la hora del emisor. No es monitorización en vivo.
Esos informes siguen la retención habitual del chat (últimos 500 mensajes
globales). La sesión completa solo permanece en el teléfono que la registró.

## Privacidad, exportación y borrado

Sesiones y chats se guardan en el almacenamiento privado de la app **sin
cifrado adicional en reposo**; el AES de radio no cifra esos archivos.
CSV/JSON también salen sin cifrar. Tener consentimiento del participante,
proteger el teléfono y controlar copias/backups y destinatarios. La conexión
BLE existente no añade emparejamiento ni autenticación nueva.

Desde Historial abrir una sesión y confirmar exportación. JSON conserva la
estructura; CSV incluye metadatos y columnas dinámicas de diagnóstico.
Los textos con posibles fórmulas se neutralizan para abrir CSV en hojas de
cálculo. Limpiar chats no elimina sesiones. «Borrar sesión» elimina solo
esa copia local; no borra archivos exportados ni informes enviados, ni promete
borrado forense. Desinstalar/borrar datos de la app puede perder el historial.

## Verificación

La base 1.4.0 / 5.6.0 cuenta con paquete nativo compilado y pruebas software.
La revisión 1.4.1 añade pruebas de calidad técnica, estado declarado, código M
cifrado y conservación en CSV/JSON. La prueba física de envío/registro sigue
pendiente. La validación solo software no debe confundirse con un APK nuevo.

Revisión 1.4.1 verificada: TypeScript, 45 pruebas Node y exportación Expo web
con las 15 rutas, incluida `/health-measurements`. El intento de APK desde
el entorno restringido se detuvo en `subst M:` con «Access denied». Después
se compiló desde PowerShell habitual: se verificaron `BUILD SUCCESSFUL`,
APK versión 1.4.1/código 11 y arquitectura ARM64. No se instaló automáticamente
ni se validó físicamente el flujo de dos teléfonos. Para reproducir el APK:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-android-release.ps1
```

Salida esperada tras compilación correcta:
`android/app/build/outputs/apk/release/app-release.apk` (ARM64, firma de pruebas).
El APK 1.4.0 del paquete anterior no contiene esta revisión. No reemplazarlo
por un APK anterior en caso de que falle la compilación nueva.

```powershell
npm run typecheck
node --experimental-strip-types --test tests/gps-and-ble.test.mjs tests/health.test.mjs tests/health-measurements.test.mjs tests/telemetry.test.mjs tests/trial-pair.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\firmware\tests\run-health-tests.ps1
```

Se prueban persistencia paginada, recuperación tras escritura incompleta,
sesiones sin reanudación automática, identidad/arranque, canales inválidos,
almacenamiento lleno, eliminación interrumpida, privacidad y CSV. También
codec canónico de 32 bytes, cifrado GCM real con manipulación rechazada,
cancelación/caducidad y comprobación de clave al salir de la cola. La prueba
de cifrado simula el payload, no dos radios/teléfonos físicos.

Pendiente en hardware: instalar APK 1.4.1 en ambos teléfonos, cargar 5.6 en V4,
registrar/recuperar/exportar una sesión, compartir directo y broadcast,
comprobar cancelación y reconexión, y verificar que una lectura inválida
nunca aparezca como evaluación médica de una persona.
