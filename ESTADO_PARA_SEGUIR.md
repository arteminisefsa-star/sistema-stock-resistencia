# Estado para seguir

Fecha: 05/05/2026

## Proyecto

Sistema online de stock y viajes de choferes.

Link online:

https://sistema-stock-resistencia.onrender.com

Repositorio GitHub:

https://github.com/arteminisefsa-star/sistema-stock-resistencia

## Cambios hechos

- Sistema publicado en Render.
- Base PostgreSQL creada en Render.
- App adaptada para celular.
- Pantalla principal nueva: **Viajes**.
- Se simplifico el flujo:
  - el chofer lleva muebles;
  - al guardar salida se descuenta stock;
  - al cerrar viaje se carga cuanto volvio;
  - el sistema calcula automaticamente cuanto vendio;
  - lo que volvio vuelve al stock;
  - se carga efectivo y transferencia entregada.
- Se quitaron precios del alta de muebles.
- Se agrego boton **Borrar movimientos** para borrar viajes/movimientos sin borrar muebles ni choferes.
- Se cambio el selector de provincia por selector de localidad:
  - El Colorado
  - Laguna Blanca
  - Pirane
  - Clorinda
  - Formosa
  - Fontana
  - Resistencia
- Cada localidad guarda datos separados en la misma app.
- En despachos ahora se elige la localidad destino.

## Archivos modificados que hay que subir a GitHub

Subir estos archivos cuando se quiera publicar los ultimos cambios:

- `index.html`
- `app.js`
- `server.js`
- `styles.css`

## Pendiente para mañana

1. Subir los ultimos archivos a GitHub si todavia no se hizo.
2. Esperar deploy de Render.
3. Probar login/entrada con localidad:
   - El Colorado
   - Laguna Blanca
   - Pirane
   - Clorinda
   - Formosa
   - Fontana
   - Resistencia
4. Probar caso real:
   - Lucas lleva 5 muebles.
   - Vuelve con 2.
   - El sistema debe calcular vendidos 3.
   - El stock debe bajar neto 3.
   - Cargar efectivo y transferencia.
5. Decidir si se quita la contrasena:
   - en Render, variable `APP_PASSWORD`.
   - si se borra o queda vacia, entra sin contrasena.

## Nota importante

Los cambios estan guardados localmente en esta carpeta:

`C:\Users\Intel\OneDrive\Desktop\sistema stock resistencia`

Para que queden online hay que subirlos a GitHub y dejar que Render redeploye.
