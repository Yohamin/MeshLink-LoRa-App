# Prototipo final y PCB

Estado al 6 de noviembre de 2026: ideas y alternativas discutidas, sin PCB
diseñada, batería seleccionada ni archivos de fabricación. No confundir esta
propuesta con hardware implementado o probado.

## Requisitos expresados por el usuario

- Explorar dos formatos: dispositivo de mano inspirado en Flipper Zero y
  accesorio acoplado a la parte posterior de un celular.
- El acople al celular es mecánico; no se ha pedido cargar el teléfono.
- El MAX30102 debe quedar integrado en el dispositivo y accesible al dedo.
- La batería aún no está elegida. Una batería de referencia para un boceto
  no establece capacidad, autonomía, conector ni dimensiones finales.

## Arquitectura propuesta

Como primera revisión se propuso una PCB base que monte la Heltec V4.3 y
organice MAX, GPS L76K, batería, controles y fijaciones. Se conservarían el
hardware y las conexiones funcionales actuales. Una PCB que sustituya por
completo la Heltec es otra alternativa, con desarrollo de alimentación y RF.
Ninguna de las dos alternativas está aprobada como diseño definitivo.

La placa base podría estudiarse inicialmente con dos capas. Su viabilidad,
grosor y dimensiones requieren el modelo mecánico real y la colocación de
conectores, componentes y zonas libres de las antenas. La opción acoplada debe
evaluarse con el teléfono, su funda y el sistema de fijación presentes.

## Decisiones necesarias antes de fabricar

1. Confirmar formato y dimensiones de la carcasa y la posición del dedo.
2. Medir Heltec, GPS, sensor, antenas, conectores y alturas de montaje.
3. Seleccionar batería, protección, conector y compatibilidad con el cargador.
4. Decidir entre montar el módulo MAX actual o integrar el chip y sus auxiliares.
5. Elaborar esquema, lista de componentes y PCB; revisar ERC, DRC y modelo 3D.
6. Fabricar y comprobar alimentación, BLE, LoRa, GPS y adquisición del MAX.

Para el MAX del perfil actual se conservan SDA GPIO4 y SCL GPIO6. El chip
MAX30102 y los módulos comerciales tienen requisitos de alimentación
distintos; la integración directa exige comprobar las dos alimentaciones,
desacoplo y niveles de interfaz en la ficha del fabricante. La ubicación de
las antenas y el acceso óptico forman parte del diseño mecánico y electrónico.

## Referencias consultadas

- [Esquemático Heltec V4.3](https://resource.heltec.cn/download/WiFi_LoRa_32_V4/Schematic/HTIT-WB32LAF_V4.3.pdf).
- [Ficha MAX30102](https://www.analog.com/media/en/technical-documentation/data-sheets/max30102.pdf).
- [Diseño PCB ESP32-S3](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/pcb-layout-design.html).
- [Flujo de diseño KiCad](https://docs.kicad.org/9.0/en/getting_started_in_kicad/getting_started_in_kicad.html).
