# Resultados: originales privados y fichas por escenario

La documentación y las plantillas pueden versionarse tras revisión. El área
`privado/` está ignorada por Git: contiene copias de adjuntos del usuario y
puede incluir IDs, nombres, coordenadas o datos del sensor. Que esté ignorada
no cifra los archivos ni impide que un ZIP manual los incluya.

## Organización

- [Escenario 1: parque](01_parque/README.md).
- [Escenario 2: edificios y puente](02_edificios_puente/README.md).
- [Escenario 3: estacionamiento en sótano](03_estacionamiento_sotano/README.md).
- [Plantilla de ficha](PLANTILLA_FICHA_ENSAYO.md).
- `privado/`: originales de campo, diagnósticos y fotos recuperados.
- `privado/manifest.json`: procedencia, nombres de destino, tamaño y SHA-256.

Se rescataron los cuatro adjuntos de escenarios identificados, el registro
GPS r2 con NMEA válido, dos registros MAX y dos fotos GPS disponibles. Los
originales en sus ubicaciones anteriores no se modifican ni se mueven.
La copia se verifica por SHA-256. Esto no valida el contenido ni sus cálculos.

Los nombres A/B de archivos de parque son identificadores de adjunto, **no
roles emisor/receptor verificados**. Esos dos archivos tienen idéntico hash:
`E8E29236E6FDF8D8F5C0BDBC7A91722DB3FCA73EF11ED99C2B5B7C8085EE9205`.
No contarlos como dos muestras independientes.

Algunas imágenes temporales antiguas del MAX/anuncio de compra ya no estaban
disponibles en disco. El manifiesto registra las ausencias; no se reconstruyen
ni se inventan archivos. Los datos de contexto proceden de lo aportado en el chat.
Esta selección no pretende ser una exportación completa de todos los adjuntos.

## Cómo añadir una prueba nueva

1. Copiar la plantilla y asignar ID inequívoco de ensayo.
2. Guardar exportaciones de ambos teléfonos bajo el mismo runId, con rol.
3. Conservarlos en `privado/` o almacenamiento seguro externo; no editarlos.
4. Guardar cálculos, filtros y gráficas en otra carpeta privada del ensayo,
   distinguiendo derivados de originales.
5. Registrar versiones, parámetros RF, sentido, escenario y cierre.
6. Antes de publicación crear una copia anonimizada y revisar consentimiento.
   No utilizar `git add -f` para saltarse la exclusión de datos privados.

Para un traslado privado copiar también `privado/` con protección adecuada.
Para compartir documentación/código públicamente, excluirla junto con claves,
credenciales, historiales de teléfonos y archivos de firma.
