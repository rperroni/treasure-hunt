# treasure-hunt

App web mobile-first para una busqueda del tesoro en Cordoba.

## Probar localmente

Como la app carga datos desde un JSON local, conviene levantar un servidor simple (no abrir el HTML directo con `file://`).

```bash
cd "/home/rocio/Documents/UNC/Proyecto map/treasure-hunt"
python3 -m http.server 5500
```

Abrir en el navegador:

`http://localhost:5500`

## Codigos de ejemplo

- PUMA1
- CONDOR2
- HORNERO3
- YAGUARETE4
- GUANACO5
- CARPINCHO6
- FLAMENCO7
- TATU8
- PINGUINO9
- VICUNA10

## Como funciona

- Las pistas se leen de `missions.json` (cada equipo tiene su set propio de 6 misiones + puzzle final).
- La Mision 1 pide: nombre de equipo, integrantes dinamicos (minimo 2, maximo 6), trivia multiple choice y selfie grupal.
- Desde Mision 2 en adelante: trivia multiple choice + foto obligatorias.
- Se muestra solo una mision a la vez. Al habilitar la siguiente, la anterior se oculta.
- Hay boton para volver atras y revisar misiones ya completas.
- Cada mision muestra una pista extra para resolver el puzzle final.
- Al completar la Mision 6, se ocultan las misiones y aparece una respuesta abierta para el puzzle final.
- Progreso por equipo en `localStorage`.
- Fotos guardadas localmente en `IndexedDB`.
- La capa de persistencia esta preparada para pasar a Firebase despues (adapter en `script.js`).
