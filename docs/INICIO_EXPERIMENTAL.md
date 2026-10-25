# Preparar el paquete y realizar la parte experimental

Versiones previstas: **MeshLink 1.3.0, código 9, ARM64** y **firmware 5.5.0**
para **Heltec V3** y **V4.3 / V4.3.1 KCT8103L**. No usar esos binarios V4
en V4.2/GC1109 o V4-R8. El paquete usa firma de prueba, no firma de producción.

## 1. Generar todo con un comando

Abrir **Windows PowerShell normal**, fuera de la terminal restringida de Codex:

```powershell
cd "C:\Users\Yohamin\Documents\Codex\2026-08-08\u\MeshLink-LoRa-App"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\generar-paquete-experimental.ps1
```

No es necesario ejecutarlo como administrador. Dejar libre la unidad M: usada
por la compilación Android y no editar la fuente mientras se compila. Se usan
las instalaciones existentes de Node, Android Studio/SDK y Arduino/Heltec 3.3.8.
No se reinstalan herramientas ni bibliotecas automáticamente. Para Arduino
se usa por defecto `C:\Users\Yohamin\.arduinoIDE\arduino-cli.yaml`.

El generador:

1. Ejecuta TypeScript y las pruebas automáticas.
2. Compila V3 y V4.3.1 en carpetas nuevas, conservando las cachés de compilación.
3. Compila el APK release independiente de Metro.
4. Verifica versiones/placas en los binarios y paquete/versión/código Android,
   firma, bundle incorporado y ABI ARM64 en el APK.
5. Comprueba que la fuente no cambió durante la compilación.
6. Crea el ZIP, manifiesto de archivos y SHA-256, fuentes completas del sketch,
   guías y logs. No copia claves privadas de firma, credenciales ni datos del teléfono.

Solo si todo termina debe aparecer **PAQUETE EXPERIMENTAL GENERADO Y VERIFICADO**.
La salida está en `experimental/`, con un nombre que incluye versiones y hora
UTC. `-ValidateOnly` ejecuta únicamente comprobaciones de software: no genera
APK/firmwares ni un paquete listo para instalar.

Si algo falla, se conserva una carpeta con **INCOMPLETO.txt** y logs, pero no
se fabrica un ZIP completo ni se reutilizan binarios antiguos. Comparte el
error y su log. En este entorno Codex, Windows negó `subst M:` y devolvió
`Illegal System DLL Relocation` al compilador ESP32; no es prueba de una
compilación 5.5 exitosa. El script aún debe completar esas etapas en tu terminal.

## 2. Contenido esperado del ZIP completo

```text
paquete/
  app/MeshLink-1.3.0-Ensayos-arm64.apk
  firmware/V3/firmware.ino.bin + bootloader/particiones/merged
  firmware/V4_3/firmware.ino.bin + bootloader/particiones/merged
  fuentes/firmware/firmware.ino y todos sus encabezados
  guias/INICIO_EXPERIMENTAL.md
  guias/PRUEBAS_Y_METRICAS.md
  guias/V4_GPS.md
  guias/MAX30102_V4.md
  validacion/...
  manifest.json
  fuentes-sha256.json
  COMPILACION_COMPLETA.txt
```

El SHA-256 del ZIP queda al lado en `.zip.sha256.txt`. El manifiesto deja
explícito que **no se ha validado físicamente** el paquete. Los resultados de
simulación no se presentan como mediciones de campo.

## 3. Instalar en ambos extremos

- Exportar/copiar cualquier historial importante antes de actualizar. Instalar
  el APK nuevo encima del existente si Android acepta la misma firma: no
  desinstalar ni borrar datos como primer paso. Si hay conflicto, detenerse y revisar.
- Confirmar en Ajustes **app 1.3.0**. Los APK antiguos de la raíz del proyecto
  no incluyen necesariamente Ensayos coordinados.
- Cargar únicamente el firmware de la placa correcta. La generación **no instala
  el APK ni flashea nodos**. Usar Arduino IDE con la carpeta completa o Arduino
  CLI para cargar los binarios; confirmar el puerto real antes de hacerlo.
- En Arduino IDE, el sketch compartido usa V3 por defecto. Para V4.3.1, añadir
  en una copia `#define MESH_BOARD_PROFILE 43` antes de los includes y seguir
  las opciones de [V4_GPS.md](V4_GPS.md). No mezclar los binarios de ambos perfiles.
- Verificar **MeshLink 5.5.0** y la placa correcta en el monitor serie a 115200.
  Mantener conectadas las antenas correctas antes de transmitir y usar alimentación
  estable. No activar MAX30102 sin confirmar la alimentación de su breakout;
  no es necesario para los ensayos de red y arranca desactivado.

## 4. Comprobación de banco, antes de desplazarse

1. Encender los nodos, conectar ambos teléfonos por BLE y comprobar nombres/IDs.
2. Configurar la misma clave de red y modo de cifrado en ambos. Comparar el ID
   de clave mostrado por la app, sin copiar la clave en informes públicos.
3. Desde Chats, enviar un mensaje normal A → B y otro B → A. Comprobar texto
   legible y confirmación, sin abrir todavía el ensayo.
4. Abrir Ensayos en ambos teléfonos. Confirmar estado preparado, escenario y
   destino correcto. Iniciar una prueba de 100 mensajes y esperar el cierre.
5. Verificar el mismo ID en ambos, métricas guardadas y confirmación final del
   receptor. Exportar ambos archivos, abrirlos y comprobar que contienen registros.
6. Repetir invirtiendo origen/destino como ensayo separado. Si no funciona en
   banco, no interpretar todavía los resultados como límite de propagación.

## 5. Procedimiento para cada escenario

Registrar en el escenario o cuaderno: ubicación, condición LoS/NLoS, distancia,
obstáculos, posiciones/alturas de nodos, repetidor, sentido, alimentación,
antenas y configuración RF. Registrar también versiones e ID del ensayo.

Mantener las mismas condiciones controlables al comparar escenarios. Cada
ensayo tiene 100 intentos y pausa de 5 s por defecto, además del tiempo de ACK
o timeout. No implica que dure exactamente 500 s. No usar la red de emergencia
activa ni modificar parámetros RF durante una ejecución.

Mantener ambos teléfonos en Ensayos, pantalla encendida y espacio disponible.
No cerrar al llegar a 100: esperar **guardado y cierre**. El receptor añade una
ventana de drenaje y consulta métricas finales antes de confirmar. Si queda
incompleto, guardar esos archivos con esa etiqueta; no reemplazar fallos por ceros.

Exportar desde ambos teléfonos después de cada ensayo. Conservar CSV/JSON,
manifiesto del paquete y notas bajo el mismo ID. No borrar intentos previos ni
seleccionar solo los favorables. Repetir los escenarios y sentidos según el
plan experimental, manteniendo separados los ensayos completos e incompletos.

PDR ACK, PDR recepción, timeouts y fallos de descifrado son conceptos distintos.
Los controles de preparación/cierre y anuncios cuentan en los acumulados del
nodo, pero no entre los 100 datos del PDR del ensayo. Las definiciones y límites
están en [PRUEBAS_Y_METRICAS.md](PRUEBAS_Y_METRICAS.md).
