# MeshLink: detalle técnico, librerías y medición de métricas

Fecha de documentación: **25 de octubre de 2026**.

| Elemento | Versión documentada |
| --- | --- |
| Aplicación MeshLink | 1.4.1, código Android 11 |
| Firmware | 5.6.0 |
| Protocolo LoRa propio | 5.1 |

Este documento describe el código y las dependencias revisadas en el proyecto. Distingue **lo que mide el radio**, **lo que contabiliza el firmware** y **lo que calcula la aplicación**.

Las versiones instaladas de herramientas y librerías corresponden al entorno local revisado. No son una recomendación de actualización ni garantizan que otro equipo tenga las mismas versiones.

## Índice

1. [Arquitectura general](#1-arquitectura-general)
2. [Firmware: lenguaje, herramientas y librerías](#2-firmware-lenguaje-herramientas-y-librerías)
3. [Configuración de la comunicación LoRa](#3-configuración-de-la-comunicación-lora)
4. [Aplicación: tecnologías y librerías](#4-aplicación-tecnologías-y-librerías)
5. [Comunicación Bluetooth y seguridad](#5-comunicación-bluetooth-y-seguridad)
6. [Cómo se miden las métricas](#6-cómo-se-miden-las-métricas)
7. [Pruebas de 100 mensajes](#7-pruebas-de-100-mensajes)
8. [Métricas del MAX30102 y GPS](#8-métricas-del-max30102-y-gps)
9. [Almacenamiento y límites](#9-almacenamiento-y-límites)
10. [Fuentes del proyecto](#10-fuentes-del-proyecto)

## 1. Arquitectura general

```text
Celular A ↔ Bluetooth BLE ↔ Nodo A ↔ LoRa ↔ Nodo B ↔ Bluetooth BLE ↔ Celular B
                                      ↕
                                Nodo repetidor
```

- La aplicación presenta los chats, cifra y descifra mensajes, coordina ensayos y guarda resultados.
- El firmware controla Bluetooth, radio LoRa, pantalla, rutas, ACK, GPS y MAX30102.
- El repetidor transporta el contenido cifrado sin descifrarlo.
- No se necesita un servidor de Internet para intercambiar mensajes por LoRa.
- Se utiliza un protocolo propio: **no es el firmware de Meshtastic ni MeshCore y no es una implementación LoRaWAN**.

La interfaz de mensajería se inspira en aplicaciones conocidas, pero no usa su infraestructura ni sus protocolos.

## 2. Firmware: lenguaje, herramientas y librerías

El firmware está desarrollado en **C++ con el framework Arduino para ESP32**.

### 2.1. Librerías externas

| Librería | Versión local revisada | Uso en MeshLink |
| --- | --- | --- |
| RadioLib | 7.8.1 | Configuración del SX1262, transmisión, recepción, RSSI y SNR. |
| ArduinoJson | 7.4.3 | Construcción e interpretación de paquetes JSON de LoRa y BLE. |
| U8g2 | 2.36.19 | Control de la pantalla OLED SSD1306 de 128 × 64 píxeles. |
| SparkFun MAX3010x Pulse and Proximity Sensor Library | 1.1.2 | Configuración del MAX30102 y algoritmo de estimación de pulso y SpO₂. |
| Core Heltec ESP32 | 3.3.8 | Soporte de placas, periféricos y compilación para ESP32. |

Aunque el sensor utilizado sea MAX30102, la librería SparkFun proporciona la clase a través de `MAX30105.h`. Ese nombre no significa que el proyecto esté configurado exclusivamente para un MAX30105.

### 2.2. Componentes incluidos con el entorno ESP32

| Componente | Función |
| --- | --- |
| `Arduino.h` | Funciones generales, GPIO, temporización y monitor serie. |
| `SPI.h` | Comunicación entre ESP32 y SX1262. |
| `Wire.h` | Comunicación I²C con el MAX30102. |
| `Preferences.h` | Configuración persistente en NVS. |
| `BLEDevice`, `BLEServer`, `BLEUtils`, `BLE2902` | Servidor Bluetooth BLE y características de comunicación. |
| FreeRTOS | Colas, tareas y protección del acceso concurrente. |
| `esp_system` | Funciones e identificación del ESP32. |
| `esp_timer` | Tiempo de funcionamiento del nodo. |
| `esp_heap_caps` | Gestión de memoria, incluida PSRAM cuando está disponible. |

Estos componentes integrados no se instalan como librerías independientes desde el gestor de bibliotecas.

### 2.3. Herramientas de compilación

- Arduino IDE o Arduino CLI.
- Arduino CLI instalado en el entorno revisado: **1.5.1**.
- Script `firmware/build-firmware.ps1` para seleccionar placa, compilar y, si se indica un puerto, cargar el firmware.
- Perfiles separados para V3, V4.2, V4.3/4.3.1 y V4-R8.
- El perfil correspondiente al pedido V4.3.1 del proyecto es `V4_3`.

### 2.4. Organización del código

| Archivo | Responsabilidad |
| --- | --- |
| `firmware.ino` | LoRa/BLE, mensajes, ACK, contadores y comandos. |
| `board_profile.h` | Pines, capacidades y límites de cada placa. |
| `routing_policy.h` | Reglas de aceptación del siguiente salto y de ACK. |
| `nmea_gps.h` | Interpretación de datos GPS NMEA. |
| `max30102_sensor.h` | Adquisición, configuración y recuperación del sensor. |
| `health_signal.h` | Ventana de muestras y comprobaciones técnicas de la señal. |

### 2.5. Diferencias de capacidad entre V3 y V4

| Recurso configurado | V3 | Perfiles V4 |
| --- | --- | --- |
| Entradas de nodos conocidos | 10 | 20 |
| IDs para detección de duplicados | 30 | 128 |
| ACK pendientes | 10 | 20 |
| Cola de comandos BLE | 4 | 8 |
| GPS del módulo | No gestionado en V3 | Soporte por perfil |
| Adquisición MAX30102 | No | Solo perfil V4_3 |

Estos límites no equivalen al número de usuarios que han sido probados experimentalmente.

## 3. Configuración de la comunicación LoRa

### 3.1. Parámetros definidos

| Parámetro | Valor |
| --- | --- |
| Transceptor | SX1262 |
| Frecuencia | 915 MHz |
| Ancho de banda | 125 kHz |
| Spreading Factor | SF7 |
| Coding Rate | 4/5 |
| Sync word | `0x12` |
| Preámbulo | 8 símbolos |
| Tamaño máximo del paquete de aplicación LoRa | 240 bytes |
| Texto sin cifrar | Máximo 40 bytes |
| Texto antes de cifrar | Máximo 32 bytes |
| TTL inicial | 3 |
| Espera de ACK | 8000 ms |

Los límites de texto son en **bytes UTF-8, no necesariamente caracteres**. Una letra con tilde o un emoji puede ocupar varios bytes.

### 3.2. Potencia

El ajuste predeterminado del SX1262 es:

- V3: **14 dBm**.
- V4: **0 dBm de excitación del SX1262**.

En V4 existe un amplificador externo. Por ello, **el ajuste del SX1262 no equivale directamente a la potencia final radiada por la antena**. No corresponde afirmar que el sistema transmite a 28 dBm sin medirlo.

### 3.3. Enrutamiento automático

Para mensajes dirigidos, el firmware puede seleccionar un repetidor mediante:

```text
Puntuación = RSSI + 2 × SNR − 0,05 × antigüedad_en_segundos
```

Se excluyen el propio nodo, el destinatario y los candidatos no vigentes. El tiempo de referencia para descartar candidatos antiguos es de 90 segundos.

El mecanismo actual selecciona un repetidor; **no es un descubrimiento general de rutas arbitrarias de muchos saltos**. El destinatario también puede aceptar un paquete escuchado directamente antes de que el repetidor lo retransmita.

Por tanto, “multihop automático enviado” indica el **modo de envío seleccionado**, pero no demuestra por sí solo que la recepción dependió físicamente del repetidor.

Los broadcast actuales son de alcance directo y **no solicitan ACK**.

### 3.4. Guardas temporales

El código utiliza:

- Intervalo base de anuncios: 15 segundos, con jitter configurado de 8 segundos.
- Guarda posterior a transmisión de mensaje: 5 segundos.
- Guarda posterior a recepción antes de anunciar: 2 segundos.
- Retardo de reenvío: mínimo de 80 ms, con jitter configurado de 220 ms.

Son mecanismos para espaciar tráfico. No constituyen una garantía de ausencia de colisiones.

## 4. Aplicación: tecnologías y librerías

La aplicación está desarrollada principalmente en **TypeScript y React Native**, utilizando Expo.

Las versiones siguientes son las resueltas en `package-lock.json`, no solamente los rangos declarados.

### 4.1. Dependencias principales

| Tecnología o librería | Versión | Función |
| --- | --- | --- |
| Expo | 57.0.11 | Entorno e integración de módulos nativos. |
| React | 19.2.3 | Componentes, estado y contexto. |
| React Native | 0.86.2 | Interfaz móvil y acceso a funciones nativas. |
| TypeScript | 6.0.3 | Tipado y comprobación del código. |
| Expo Router | 57.0.11 | Navegación entre chats, ajustes, ensayos y apoyo en emergencias. |
| `react-native-ble-plx` | 3.5.1 | Búsqueda de nodos, conexión BLE y transferencia de datos. |
| `@noble/ciphers` | 2.0.1 | AES-GCM para cifrar y descifrar mensajes. |
| `expo-crypto` | 57.0.1 | SHA-256, bytes aleatorios e identificadores. |
| AsyncStorage | 2.2.0 | Historial, ajustes, sesiones y métricas locales. |
| `expo-secure-store` | 57.0.1 | Clave de red en almacenamiento protegido del dispositivo nativo. |
| `expo-file-system` | 57.0.2 | Exportación de archivos CSV y JSON. |
| `expo-location` | 57.0.8 | Ubicación del teléfono cuando corresponde utilizarla. |
| `expo-constants` | 57.0.9 | Versión y configuración de la aplicación. |
| `expo-haptics` | 57.0.1 | Respuesta háptica. |
| `@expo/vector-icons` | 15.1.1 | Iconos de la interfaz. |

### 4.2. Otras dependencias declaradas

| Paquete | Versión resuelta |
| --- | --- |
| `@expo/ui` | 57.0.9 |
| `expo-dev-client` | 57.0.10 |
| `expo-device` | 57.0.1 |
| `expo-font` | 57.0.1 |
| `expo-glass-effect` | 57.0.1 |
| `expo-image` | 57.0.2 |
| `expo-linking` | 57.0.5 |
| `expo-splash-screen` | 57.0.5 |
| `expo-status-bar` | 57.0.1 |
| `expo-symbols` | 57.0.2 |
| `expo-system-ui` | 57.0.2 |
| `expo-web-browser` | 57.0.2 |
| `react-dom` | 19.2.3 |
| `react-native-gesture-handler` | 2.32.0 |
| `react-native-reanimated` | 4.5.1 |
| `react-native-safe-area-context` | 5.7.0 |
| `react-native-screens` | 4.26.2 |
| `react-native-web` | 0.21.2 |
| `react-native-worklets` | 0.10.1 |
| `@types/react` | 19.2.18 |

**Que un paquete esté declarado no significa que todas sus funciones se utilicen en los flujos actuales.** Parte de estas dependencias procede de la base Expo y del soporte de interfaz. Esta relación comprende dependencias directas; las dependencias transitivas completas están en `package-lock.json`.

### 4.3. Compilación Android

- Node.js instalado: **24.12.0**.
- Gradle Wrapper: **9.3.1**.
- Java/JBR de Android Studio: **21.0.8**.
- Motor JavaScript Hermes activado.
- Nueva arquitectura de React Native activada.
- APK generado por el script actual: **ARM64**.
- Firma local de pruebas/demostración, no firma definitiva de distribución comercial.

La compilación se realiza con `build-android-release.ps1`. El generador `generar-paquete-experimental.ps1` puede preparar un paquete con aplicación, firmware, fuentes, guías y evidencias de validación.

## 5. Comunicación Bluetooth y seguridad

### 5.1. Bluetooth BLE

La aplicación escribe comandos JSON y recibe respuestas JSON delimitadas por salto de línea.

| Elemento | Configuración |
| --- | --- |
| Servicio BLE | `4fafc201-1fb5-459e-8fcc-c5c9c331914b` |
| Característica de escritura, TX del firmware | `beb5483e-36e1-4688-b7f5-ea07361b26a8` |
| Característica de notificaciones, RX del firmware | `beb5483e-36e1-4688-b7f5-ea07361b26a9` |
| MTU solicitado | 185 bytes |
| Fragmentos utilizados | 180 bytes |
| Intervalo de estado general | Aproximadamente 5 segundos |

Los nombres TX/RX corresponden a las constantes del proyecto: la app escribe en TX y escucha notificaciones en RX.

La app serializa comandos completos para evitar mezclar fragmentos de distintas operaciones. El firmware utiliza una cola y ejecuta los comandos desde su bucle principal.

No se ha añadido un mecanismo nuevo de emparejamiento autenticado. **El cifrado de mensajes LoRa no debe confundirse con una protección adicional del acceso BLE.**

### 5.2. Cifrado de mensajes

El envío actual utiliza **AES-128-GCM**, ejecutado en el celular:

```text
M2: + Base64(nonce + contenido cifrado + etiqueta de autenticación)
```

- Clave AES: 16 bytes.
- Nonce aleatorio: 12 bytes.
- Etiqueta GCM: 16 bytes.
- Derivación: SHA-256 de la frase compartida con el prefijo definido por la aplicación, tomando 16 bytes para AES-128.
- Compatibilidad de descifrado con mensajes antiguos AES-256-GCM.

La derivación utilizada no debe describirse como PBKDF2 o Argon2: esas funciones no son las implementadas.

El firmware **no ejecuta AES**: transporta el contenido cifrado. Los encabezados de encaminamiento y los ACK no quedan protegidos por ese cifrado del cuerpo del mensaje.

La clave de red es compartida: no constituye una certificación de identidad de la persona.

## 6. Cómo se miden las métricas

### 6.1. Paquetes y mensajes

| Métrica | Qué contabiliza realmente |
| --- | --- |
| `txPackets` | Intentos que llegan a `radio.transmit()` tras comprobar tamaño y contenido. |
| `txOk` | Transmisiones en las que RadioLib devuelve éxito. No confirma recepción remota. |
| `txError` | Intentos de transmisión en los que RadioLib devuelve error. |
| `rxPackets` | Recepciones en las que `radio.readData()` devuelve éxito, antes de validar todo el contenido de aplicación. |
| `messagesSent` | Mensajes originados localmente cuya transmisión fue exitosa. |
| `messagesReceived` | Mensajes nuevos aceptados para este nodo o como broadcast. |
| `broadcastSent/Received` | Mensajes broadcast enviados o aceptados. |
| `directSent/Received` | Mensajes dirigidos; pueden utilizar repetidor. |
| `directPathSent` | Mensajes dirigidos enviados sin el modo vía repetidor. |
| `encryptedSent/Received` | Mensajes marcados como cifrados; recibirlos no demuestra descifrado correcto. |

En las variables internas se utiliza `directMessagesSent`; en la notificación de estado BLE se expone como `directSent`.

**Paquete no equivale a mensaje:** anuncios, ACK y reenvíos también generan tráfico de radio.

Un paquete rechazado por exceder el tamaño incrementa `sizeDroppedPackets`, pero no necesariamente `txError`, porque puede descartarse antes de intentar transmitir.

### 6.2. PDR basado en ACK

La función `getPdrAck()` calcula:

```text
PDR_ACK (%) = messagesWithAck / directMessagesSent × 100
```

- Numerador: mensajes pendientes resueltos con ACK coincidente.
- Denominador: mensajes dirigidos transmitidos correctamente por el nodo, con o sin repetidor.
- Los broadcast no participan.
- Los fallos locales de transmisión no forman parte de ese denominador.
- Si el denominador es cero, el firmware devuelve 0 % como valor de presentación; no significa que se haya realizado un ensayo con pérdida total.

Ejemplo: 7 mensajes confirmados de 10 transmisiones dirigidas exitosas producen **70 %**.

**Un ACK confirma recepción en el firmware remoto. No demuestra que el celular haya descifrado, guardado o mostrado el mensaje.**

Durante un ensayo pueden existir ACK pendientes. Conviene evaluar el resultado cuando finalice.

### 6.3. Latencia

En `trackPendingAck()`:

```cpp
pendingAcks[i].sentAt = millis();
```

Cuando llega un ACK aceptado, en `resolvePendingAck()`:

```cpp
unsigned long latency = millis() - pendingAcks[i].sentAt;
```

**El inicio se registra después de transmitir y después de emitir la notificación BLE del resultado.**

Por tanto, la métrica es el **tiempo desde el registro del ACK pendiente hasta procesar su confirmación**, no:

- la latencia de una sola vía;
- el tiempo completo de transmisión inicial;
- ni el tiempo entre pulsar “Enviar” y visualizarlo en el otro celular.

Puede incluir reenvío por repetidor, procesamiento remoto, generación del ACK y transmisión de retorno. También depende de la ejecución del bucle principal y de las operaciones de notificación/registro.

El promedio es:

```text
Latencia promedio = suma de latencias confirmadas / número de ACK resueltos
```

Los timeouts **no se incorporan como 8000 ms** al promedio. Se conservan última, mínima y máxima latencia. Si no existen muestras, el firmware presenta promedio cero; en el resumen de ensayo de la app, la ausencia de observaciones puede representarse como valor nulo.

Para la documentación experimental, una denominación precisa es: **“Tiempo de confirmación ACK según la temporización implementada en el nodo”**.

### 6.4. ACK y timeouts

| Métrica | Definición |
| --- | --- |
| `ackSent` | ACK transmitidos correctamente por este nodo. |
| `ackReceived` | ACK aceptados por la lógica de recepción local. |
| `messagesWithAck` | Mensajes pendientes resueltos con ACK. |
| `ackTimeouts` | Pendientes cuyo tiempo supera los 8000 ms sin confirmación aceptada. |

El ACK se relaciona con el ID de mensaje y el remitente esperado. Se filtran duplicados.

Un timeout significa **“sin confirmación”**, no necesariamente “el destinatario no recibió el mensaje”: también pudo perderse el ACK.

No hay reintentos automáticos generales del mensaje original.

La tabla de pendientes es limitada. Si se satura, el código puede reemplazar la primera entrada. La prueba secuencial evita generar cien pendientes simultáneos.

### 6.5. RSSI y SNR

Después de una recepción correcta:

```cpp
float rssi = radio.getRSSI();
float snr = radio.getSNR();
```

- **RSSI**, en dBm: indicador de potencia recibida.
- **SNR**, en dB: relación señal/ruido estimada para el paquete recibido.

Referencia de las funciones y unidades: [RadioLib, SX126x](https://jgromes.github.io/RadioLib/class_s_x126x.html).

El firmware conserva **el último valor**, no el promedio de toda una prueba.

Ese último paquete puede ser un mensaje, un ACK o un anuncio. En una ruta con repetidor corresponde a la recepción local del salto escuchado, **no a una medición de toda la ruta**.

La aplicación calcula promedios del ensayo:

```text
RSSI promedio = suma del RSSI de mensajes únicos del ensayo / cantidad con RSSI

SNR promedio = suma del SNR de mensajes únicos del ensayo / cantidad con SNR
```

No mezcla automáticamente el RSSI de los ACK con el de los mensajes recibidos para esos promedios.

Si no hay observaciones, el promedio se devuelve como nulo, no se inventa una señal de 0 dBm o un SNR de 0 dB.

Los promedios son aritméticos de los valores en dBm/dB registrados; no son una conversión a potencia lineal y posterior promediado.

### 6.6. Enrutamiento y diagnóstico

| Métrica | Significado |
| --- | --- |
| `announcesSent/Received` | Anuncios transmitidos y paquetes identificados como anuncios recibidos. |
| `autoMultihopSent/Received` | Mensajes enviados o aceptados con etiqueta de ruta automática. |
| `forcedMultihopSent` | Envíos vía repetidor seleccionados explícitamente para depuración. |
| `autoRelaySelected` | Selecciones de un repetidor candidato. |
| `autoRelayNotFound` | Ocasiones sin candidato; se intenta envío directo. |
| `forwardedMessages/forwardedAcks` | Reenvíos transmitidos correctamente. |
| `duplicates` | Mensajes o ACK identificados como repetidos. |
| `invalidJson` | Paquetes completos cuyo JSON no pudo interpretarse. |
| `corrupted` | Contenido incompleto o inválido detectado por la lógica de aplicación. |
| `droppedByTtl` | Reenvíos descartados por agotamiento del TTL. |
| `notNextHopIgnored` | Paquetes ignorados por las reglas de destino/siguiente salto. |
| `ownEchoIgnored` y contador interno de bucles propios | Fragmentos o ecos propios descartados. |
| `guardedAnnounceSkips` | Anuncios pospuestos para respetar guardas temporales. |
| `sizeDroppedPackets` | Paquetes descartados por tamaño. |
| `commandQueueDrops` | Descartes asociados a la cola de comandos. |

Los contadores no son necesariamente categorías excluyentes ni todos se exportan con el mismo nombre por serie y BLE.

**`corrupted` no es BER ni un contador completo de errores físicos de radio.** Un error devuelto por `readData()` se imprime en serie y no necesariamente incrementa ese contador. Tener `corrupted=0` no demuestra ausencia total de errores del canal.

Asimismo, `announcesReceived` se incrementa antes de completar la validación del identificador/nombre del anuncio; no debe interpretarse como número de nodos válidos únicos.

### 6.7. Métricas BLE

| Dato | Interpretación |
| --- | --- |
| `commandsReceived` | Comandos BLE recibidos. |
| `notificationsSent` | Fragmentos de notificación enviados, no mensajes completos ni entregas confirmadas al teléfono. |
| Estado de conexión | Estado observado del enlace BLE. |
| Último comando | Último comando registrado por el firmware. |
| Descartes de cola | Saturación/descarte en la recepción de comandos. |

Un JSON largo puede generar varias notificaciones de 180 bytes.

### 6.8. Cifrado: tiempos y sobrecarga

Los tiempos se miden en la aplicación mediante:

```text
tiempo_us = redondeo(performance.now() × 1000)
```

Se cronometra la operación AES-GCM. No incluye toda la derivación de clave, transferencia BLE, transmisión LoRa o preparación completa del envío.

Son microsegundos derivados del reloj de JavaScript; no una medida con temporizador del ESP32 ni una garantía de resolución física de un microsegundo.

La app reporta los valores al firmware, que los acumula y muestra:

```text
Overhead_bytes = ciphertextSizeBytes − plaintextSizeBytes

Overhead_% = Overhead_bytes / plaintextSizeBytes × 100
```

En esta implementación, `ciphertextSizeBytes` incluye nonce y etiqueta:

```text
Tamaño binario protegido = texto UTF-8 + 12 + 16
```

Se agregan **28 bytes antes de Base64**.

Ejemplo para texto de 32 bytes:

| Componente | Tamaño |
| --- | --- |
| Texto UTF-8 | 32 bytes |
| Nonce | 12 bytes |
| Etiqueta GCM | 16 bytes |
| Binario protegido | 60 bytes |
| Base64 del binario | 80 bytes |
| Prefijo `M2:` | 3 bytes |
| Contenido codificado total | 83 bytes |

El paquete LoRa completo es mayor porque incluye JSON y encaminamiento. El tamaño de paquete registrado no es el tamaño total físico en el aire con preámbulo, cabeceras y codificación LoRa.

El firmware mantiene:

- Último y promedio de tiempo de cifrado.
- Último y promedio de tiempo de descifrado.
- Cantidad de muestras de tiempo.
- Cantidad de descifrados exitosos y fallidos reportados.
- Tamaños de texto, binario protegido, contenido codificado y paquete.

Son métricas reportadas por el celular, **no medidas del rendimiento criptográfico del ESP32**. Un fallo anterior a la generación del reporte de métricas tampoco debe suponerse incluido automáticamente en los contadores.

## 7. Pruebas de 100 mensajes

Cada ensayo y cada secuencia se identifican con:

```text
T:<identificador del ensayo>:001/100
...
T:<identificador del ensayo>:100/100
```

### 7.1. Procedimiento

1. Ambos teléfonos deben estar preparados en Ensayos.
2. Se guardan estados iniciales de información, nodos y contadores.
3. El receptor confirma que está listo y que pudo persistir la preparación.
4. Se envía un mensaje.
5. Se espera ACK, timeout o fallo local.
6. Se aplica la pausa configurada, entre 2 y 60 segundos.
7. Se continúa con el siguiente.
8. Se solicita confirmación de que el receptor guardó sus resultados.

Son cien envíos secuenciales, no cien transmisiones simultáneas. La pausa se aplica después del resultado anterior: no equivale necesariamente al intervalo entre los inicios de dos transmisiones.

### 7.2. Indicadores calculados por la app

```text
PDR_ACK del ensayo =
    ACK de mensajes del ensayo / transmisiones exitosas del ensayo × 100

ACK por intento =
    ACK / intentos realizados × 100

PDR_recepción =
    mensajes únicos registrados en el receptor
    / transmisiones exitosas informadas por el emisor × 100
```

El PDR de recepción queda sin calcular si falta la información necesaria para establecer un denominador válido y el cierre persistido correspondiente.

Esto evita utilizar los cien mensajes planeados como denominador cuando el ensayo fue interrumpido o existieron fallos de transmisión.

La correlación utiliza ID de ensayo, secuencia, solicitud y mensaje. Permite distinguir el tráfico de datos del ensayo de controles, anuncios y otros mensajes.

Se separan:

- Intentos.
- Transmisiones locales exitosas.
- Fallos locales.
- ACK.
- Timeouts.
- Resultados no observados por BLE.
- Mensajes únicos recibidos.
- Fallos de descifrado.
- Confirmación de guardado remoto.

La falta de observación BLE no se clasifica automáticamente como pérdida del canal LoRa.

### 7.3. Cierre e interrupciones

Salir de Ensayos, pasar a segundo plano o perder el enlace puede interrumpir la prueba. No se reanuda automáticamente.

La confirmación de guardado remoto es distinta del ACK de firmware y tampoco equivale a que una persona haya leído o atendido el informe.

La implementación actual de ensayos coordinados es para un destino dirigido, no para medir automáticamente el PDR de todos los receptores de un broadcast.

## 8. Métricas del MAX30102 y GPS

### 8.1. MAX30102: adquisición

| Parámetro | Configuración |
| --- | --- |
| Perfil con adquisición | V4.3/4.3.1, `V4_3` |
| SDA | GPIO4 |
| SCL | GPIO6 |
| Dirección I²C | `0x57` |
| Frecuencia del bus | 400 kHz |
| Canales | Rojo e infrarrojo |
| Frecuencia configurada | 100 muestras/s |
| Promedio del sensor | 4 |
| Frecuencia efectiva FIFO | 25 muestras/s |
| Ventana | 100 muestras, aproximadamente 4 segundos |
| Nuevo cálculo | Cada 25 muestras, aproximadamente cada segundo |

La adquisición se ejecuta en una tarea FreeRTOS separada. La pantalla OLED utiliza su implementación de I²C por software; el sensor tiene su bus gestionado por el controlador correspondiente.

### 8.2. Algoritmo y validez

Se utiliza `maxim_heart_rate_and_oxygen_saturation()` de la librería SparkFun:

- Pulso: detección de periodicidad en la señal óptica.
- SpO₂: relación entre componentes de las señales roja/infrarroja y tabla del algoritmo.

El código propio exige ventana completa y aplica comprobaciones de contacto técnico, saturación, variación de señal y seguridad numérica antes de mostrar resultados.

Se registran:

- Pulso estimado y SpO₂ estimada.
- Validez independiente de cada canal.
- Rojo e infrarrojo.
- Estado y contacto técnico.
- Antigüedad de muestras y estimación.
- Muestras recibidas y tamaño de ventana.
- Reinicios y desbordamientos FIFO.
- Fallos I²C.
- Intentos/fallos de configuración.
- Interrupciones y recuperaciones.

**Los límites numéricos y comprobaciones de señal no son umbrales de diagnóstico clínico.** Una medición inválida se representa como ausente, no como cero.

El estado “reading” puede significar que al menos uno de los dos canales tiene una estimación aceptada; no garantiza que ambos estén disponibles.

La app distingue lecturas recientes, medición parcial o medición no disponible. No determina automáticamente que la persona esté bien o mal.

### 8.3. Sesiones e informes de apoyo

- El registro es voluntario, por sesión y con consentimiento.
- Se conservan instantáneas BLE aproximadamente una vez por segundo cuando el sensor está activado.
- No se guarda la onda completa de 25 muestras/s.
- Los informes son manuales, dirigidos o broadcast.
- El estado “Necesito ayuda”, “Tengo molestias” o “Me siento bien” es declarado, no calculado a partir de los números.
- “Necesito ayuda” marca el informe confirmado como SOS; no genera asistencia automática.
- Los informes no transmiten la sesión completa, señales Rojo/IR ni GPS.
- Una sesión inválida, un fallo de almacenamiento o un cambio de nodo/arranque impiden continuar como si el registro siguiera íntegro.

### 8.4. GPS

El lector propio interpreta NMEA RMC/GGA con comprobación de checksum.

Registra:

| Dato | Significado |
| --- | --- |
| `bytesReceived` | Bytes observados por el lector UART. |
| `validSentences` | Sentencias que superaron la comprobación de formato/checksum del lector; no todas implican una posición válida. |
| `badSentences` | Sentencias rechazadas por el lector. |
| Fijación | Existencia de una posición aceptada. |
| Satélites | Cantidad reportada por las sentencias utilizadas. |
| Coordenadas | Latitud y longitud, expuestas cuando hay posición reciente. |
| Antigüedad | Tiempo desde la posición aceptada. |

Solo se permite enviar una posición reciente de hasta **10 segundos**. No hay seguimiento periódico ni historial de recorridos GPS implementado.

En el diagnóstico aportado antes de esta documentación, `bytes=0` indicaba que no llegaban datos del receptor al firmware. La existencia del código GPS no demuestra una fijación real en ese equipo.

## 9. Almacenamiento y límites

### 9.1. Dónde se guarda cada dato

| Información | Almacenamiento |
| --- | --- |
| Nombre y configuración persistente del nodo | NVS mediante Preferences. |
| Contadores generales del firmware | RAM; se pierden al reiniciar. |
| Clave de red en Android | SecureStore. |
| Chats | AsyncStorage; últimos 500 mensajes globales. |
| Ensayos de red | AsyncStorage, páginas de 64 eventos. |
| Sesiones MAX30102 | Almacén separado, páginas de 32 registros y máximo 1800 por sesión. |
| Exportaciones | Archivos CSV y JSON. |

El registro de red excluye cuerpos de mensajes, claves, GPS y fisiología. Los datos del MAX30102 utilizan un almacén separado.

Los chats y sesiones no tienen cifrado adicional en reposo implementado por esta función. El AES del envío por LoRa no cifra automáticamente esos archivos. Las exportaciones CSV/JSON también requieren cuidado por contener datos sensibles.

### 9.2. Identificación temporal

Cada arranque tiene un `bootId`. El campo `uptimeMs` identifica el tiempo de funcionamiento del nodo y se obtiene con `esp_timer_get_time()` convertido a milisegundos.

Un reinicio explícito de métricas incrementa `metricsEpoch`, sin simular un arranque nuevo. No se deben mezclar diferencias de contadores entre arranques o épocas distintas.

El reinicio de métricas no equivale a reiniciar toda la placa ni a borrar automáticamente todos los contadores de otros subsistemas.

### 9.3. Cobertura del registro

El registro experimental comienza con el ensayo coordinado: **no recupera automáticamente todo lo ocurrido desde que se encendió el nodo**.

Las instantáneas iniciales contienen contadores acumulados, pero no reconstruyen eventos anteriores. Si BLE no estaba conectado o la app no estaba registrando, no existe un historial autónomo completo en el firmware que luego se descargue.

Los relojes de los teléfonos no están sincronizados por este protocolo. Restar la hora del emisor de la del receptor no proporciona una latencia fiable de una sola vía.

### 9.4. Métricas que no están implementadas como medición

El sistema no mide actualmente:

- Consumo energético.
- Autonomía.
- Potencia RF real radiada.
- BER.
- Latencia completa celular-a-celular.
- Tiempo de una sola vía.
- Confirmación de lectura o atención humana.
- Diagnóstico médico a partir del MAX30102.

Para la tesis, se deben identificar las métricas por su definición exacta y no atribuirles esas mediciones adicionales.

## 10. Fuentes del proyecto

Las rutas siguientes son relativas a este documento para que sigan funcionando al compartir el repositorio.

| Fuente | Información respaldada |
| --- | --- |
| [package.json](../package.json) | Dependencias directas, versión y scripts de la app. |
| [package-lock.json](../package-lock.json) | Versiones resueltas y dependencias transitivas. |
| [app.json](../app.json) | Configuración de Expo y versión Android. |
| [Gradle Wrapper](../android/gradle/wrapper/gradle-wrapper.properties) | Versión de Gradle. |
| [build-android-release.ps1](../build-android-release.ps1) | Compilación Android y salida ARM64. |
| [firmware.ino](../firmware/firmware.ino) | Radio, BLE, ACK, métricas y comandos. |
| [board_profile.h](../firmware/board_profile.h) | Perfiles, pines y límites. |
| [build-firmware.ps1](../firmware/build-firmware.ps1) | Selección de placa y compilación/carga. |
| [routing_policy.h](../firmware/routing_policy.h) | Reglas de destino y ACK. |
| [crypto.ts](../src/lib/crypto.ts) | AES-GCM, formatos y tiempos de cifrado. |
| [mesh-ble.native.ts](../src/services/mesh-ble.native.ts) | Transporte BLE del celular. |
| [telemetry.ts](../src/lib/telemetry.ts) | Historial y cálculo de indicadores de ensayo. |
| [test-runner.ts](../src/lib/test-runner.ts) | Envío secuencial de cien mensajes. |
| [trial-coordinator.ts](../src/lib/trial-coordinator.ts) | Preparación, correlación y cierre entre teléfonos. |
| [storage.ts](../src/lib/storage.ts) | Chats, ajustes y clave de red. |
| [max30102_sensor.h](../firmware/max30102_sensor.h) | Adquisición y diagnóstico del sensor. |
| [health_signal.h](../firmware/health_signal.h) | Ventana y validación técnica de señal. |
| [health.ts](../src/lib/health.ts) | Validez, antigüedad y presentación de mediciones. |
| [health-journal.ts](../src/lib/health-journal.ts) | Sesiones fisiológicas y exportación. |
| [health-share.ts](../src/lib/health-share.ts) | Informes compactos y estados declarados. |
| [nmea_gps.h](../firmware/nmea_gps.h) | Lectura NMEA del firmware. |
| [gps.ts](../src/lib/gps.ts) | Normalización y vigencia de posición en la app. |

### Documentación complementaria

- [Ensayos y métricas](PRUEBAS_Y_METRICAS.md).
- [Mediciones MAX30102 y apoyo en emergencias](MEDICIONES_MAX30102.md).
- [MAX30102 en V4](MAX30102_V4.md).
- [Diagnóstico MAX30102](MAX30102_DIAGNOSTICO.md).
- [Perfiles V3/V4 y GPS](V4_GPS.md).
- [Protocolo de firmware](FIRMWARE_PROTOCOL.md).
- [Referencia RadioLib SX126x](https://jgromes.github.io/RadioLib/class_s_x126x.html).

---

**Alcance:** descripción de implementación y metodología. No sustituye la validación física, la calibración de instrumentos ni la evaluación clínica.
