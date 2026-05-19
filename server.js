const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const cookieParser = require("cookie-parser");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 10000;
const stateId = process.env.STATE_ID || "control-muebles-resistencia";
const appPassword = process.env.APP_PASSWORD || "";
const sessionToken = crypto.randomBytes(32).toString("hex");
const branches = {
  "el-colorado": "El Colorado",
  "laguna-blanca": "Laguna Blanca",
  pirane: "Pirane",
  clorinda: "Clorinda",
  fontana: "Fontana",
  resistencia: "Resistencia",
};
const defaultBranch = "resistencia";

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
    })
  : null;

app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

app.get("/app.js", (request, response) => {
  response.type("application/javascript");
  const appScript = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const hotfixPath = path.join(__dirname, "hotfix-cristina.js");
  const hotfixScript = fs.existsSync(hotfixPath) ? fs.readFileSync(hotfixPath, "utf8") : "";
  response.send(`${appScript}\n\n${hotfixScript}`);
});

app.use(express.static(__dirname));

function isAuthenticated(request) {
  return !appPassword || request.cookies.stock_session === sessionToken;
}

function requireAuth(request, response, next) {
  if (isAuthenticated(request)) return next();
  return response.status(401).json({ error: "No autorizado" });
}

function normalizeBranch(branch) {
  const value = String(branch || defaultBranch).toLowerCase();
  return branches[value] ? value : defaultBranch;
}

function selectedStateId(request) {
  return stateIdFromBranch(request.query.branch || request.body.branch);
}

function stateIdFromBranch(branch) {
  const normalized = normalizeBranch(branch);
  return normalized === defaultBranch ? stateId : `control-muebles-${normalized}`;
}

function emptyState() {
  return {
    furniture: [],
    materials: [],
    drivers: [],
    sellers: [],
    loads: [],
    transactions: [],
    payments: [],
    materialMoves: [],
    retiredStock: [],
    dispatches: [],
  };
}

async function readState(id, client = pool) {
  const result = await client.query("select data from app_state where id = $1", [id]);
  return { ...emptyState(), ...(result.rows[0] ? result.rows[0].data : {}) };
}

async function writeState(id, data, client = pool) {
  await client.query(
    `
      insert into app_state (id, data, updated_at)
      values ($1, $2, now())
      on conflict (id)
      do update set data = excluded.data, updated_at = now()
    `,
    [id, data]
  );
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
  await writeState(selectedStateId(request), request.body.data || {});
  response.json({ ok: true });
});

app.post("/api/dispatch", requireAuth, async (request, response) => {
  if (!pool) return response.status(500).json({ error: "Falta DATABASE_URL" });
  const from = normalizeBranch(request.body.from);
  const to = normalizeBranch(request.body.to);
  if (from === to) return response.status(400).json({ error: "Selecciona una localidad de destino distinta al origen" });
  const lines = Array.isArray(request.body.lines) ? request.body.lines : [];
  if (!lines.length) return response.status(400).json({ error: "Agrega al menos un mueble" });

  const fromId = stateIdFromBranch(from);
  const toId = stateIdFromBranch(to);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const fromState = await readState(fromId, client);
    const toState = await readState(toId, client);
    const dispatch = {
      id: crypto.randomUUID(),
      date: request.body.date,
      from,
      to,
      note: request.body.note || "",
      lines,
    };

    lines.forEach((line) => {
      const qty = Number(line.qty || 0);
      const originItem = fromState.furniture.find((item) => item.id === line.furnitureId);
      if (!originItem || qty <= 0 || originItem.stock < qty) throw new Error(`Stock insuficiente para ${line.name}`);
      originItem.stock -= qty;
      const destItem = toState.furniture.find((item) => item.name.trim().toLowerCase() === line.name.trim().toLowerCase());
      if (destItem) destItem.stock += qty;
      else toState.furniture.push({ id: crypto.randomUUID(), name: line.name, price: 0, stock: qty, minStock: 0 });
    });

    fromState.dispatches = [...(fromState.dispatches || []), { ...dispatch, direction: "enviado" }];
    toState.dispatches = [...(toState.dispatches || []), { ...dispatch, direction: "recibido" }];
    await writeState(fromId, fromState, client);
    await writeState(toId, toState, client);
    await client.query("commit");
    response.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    response.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
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
