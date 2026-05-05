# Control de Muebles online

Sistema para controlar stock, salidas de choferes, ventas, devoluciones, materiales y dinero recibido.

Esta version esta preparada para publicarse en Render con una base PostgreSQL de Render. No usa Supabase.

## Archivos

- `index.html`: interfaz principal.
- `styles.css`: estilos.
- `app.js`: logica del sistema en el navegador.
- `server.js`: servidor Express y API para guardar los datos.
- `package.json`: dependencias y comando de arranque para Render.

## Como funciona online

Render corre `server.js`. El servidor:

- muestra la app web;
- protege el acceso con una contrasena si se configura `APP_PASSWORD`;
- guarda y lee el estado compartido en PostgreSQL usando `DATABASE_URL`.

## Variables en Render

En el Web Service de Render configurar:

```text
DATABASE_URL = Internal Database URL de la base PostgreSQL de Render
APP_PASSWORD = contrasena para entrar al sistema
NODE_ENV = production
```

`APP_PASSWORD` puede ser cualquier contrasena que quieras usar para entrar al sistema.

## Crear en Render

1. Subir estos archivos a GitHub.
2. En Render, crear una **Postgres Database**.
3. Copiar el **Internal Database URL** de esa base.
4. Crear un **Web Service** conectado al repositorio de GitHub.
5. Usar:

```text
Build Command: npm install
Start Command: npm start
```

6. En **Environment**, pegar las variables indicadas arriba.
7. Deploy.

## Orden recomendado de uso

1. Cargar los muebles en **Stock muebles**.
2. Cargar materiales en **Materiales** si corresponde.
3. Cargar choferes en **Choferes**.
4. Crear una salida en **Salida chofer**.
5. Cerrar la salida en **Cierre / rendicion** cargando efectivo y transferencia.
6. Usar **Ventas y devoluciones** solo si necesitas cargar o editar un movimiento manual.
7. Revisar totales en **Resumen** con filtros por dia, semana, mes o fechas.

## Nota

El sistema tambien guarda un respaldo local en el navegador. Si se corta internet, puede conservar una copia local, pero la base compartida es PostgreSQL en Render.
