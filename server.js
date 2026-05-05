const crypto = require("crypto");
const path = require("path");
const cookieParser = require("cookie-parser");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 10000;
const stateId = process.env.STATE_ID || "control-muebles-resistencia";
const appPassword = process.env.APP_PASSWORD || "";
const sessionToken = crypto.randomBytes(32).toString("hex");

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
    })
  : null;

app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());
app.use(express.static(__dirname));

function isAuthenticated(request) {
  return !appPassword || request.cookies.stock_session === sessionToken;
}

function requireAuth(request, response, next) {
  if (isAuthenticated(request)) return next();
  return response.status(401).json({ error: "No autorizado" });
}

function selectedStateId(request) {
  const branch = String(request.query.branch || request.body.branch || "resistencia").toLowerCase();
  return branch === "formosa" ? "control-muebles-formosa" : stateId;
}

async function ensureDatabase() {
  if (!pool) return;
  await pool.query(`
    create table if not exists app_state (
      id text primary key,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    )
  `);
}

app.get("/api/session", (request, response) => {
  response.json({
    authRequired: Boolean(appPassword),
    authenticated: isAuthenticated(request),
  });
});

app.post("/api/login", (request, response) => {
  if (!appPassword || request.body.password === appPassword) {
    response.cookie("stock_session", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
    return response.json({ ok: true });
  }
  return response.status(401).json({ error: "Contrasena incorrecta" });
});

app.get("/api/state", requireAuth, async (request, response) => {
  if (!pool) return response.status(500).json({ error: "Falta DATABASE_URL" });
  const result = await pool.query("select data from app_state where id = $1", [selectedStateId(request)]);
  response.json({ data: result.rows[0] ? result.rows[0].data : {} });
});

app.put("/api/state", requireAuth, async (request, response) => {
  if (!pool) return response.status(500).json({ error: "Falta DATABASE_URL" });
  await pool.query(
    `
      insert into app_state (id, data, updated_at)
      values ($1, $2, now())
      on conflict (id)
      do update set data = excluded.data, updated_at = now()
    `,
    [selectedStateId(request), request.body.data || {}]
  );
  response.json({ ok: true });
});

app.get("*", (request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});

ensureDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Sistema online escuchando en puerto ${port}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo preparar la base de datos", error);
    process.exit(1);
  });
