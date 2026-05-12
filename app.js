const STORE_KEY = "control-muebles-v1";
const BRANCH_KEY = "control-muebles-branch";
const branches = {
  resistencia: "Resistencia",
  formosa: "Formosa",
};

const today = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const money = (value) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(value || 0));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

const initialState = {
  furniture: [],
  materials: [],
  drivers: [],
  loads: [],
  transactions: [],
  payments: [],
  materialMoves: [],
};

let currentBranch = localStorage.getItem(BRANCH_KEY) || "resistencia";
let state = loadLocalState();
let currentLoadLines = [];
let currentTripLines = [];
let booting = true;
let saveTimer = null;

function loadLocalState() {
  const saved = localStorage.getItem(`${STORE_KEY}-${currentBranch}`);
  return saved ? { ...initialState, ...JSON.parse(saved) } : initialState;
}

function saveState() {
  localStorage.setItem(`${STORE_KEY}-${currentBranch}`, JSON.stringify(state));
  scheduleServerSave();
}

function setSyncStatus(message) {
  const status = document.querySelector("#syncStatus");
  if (status) status.textContent = message;
  const branchStatus = document.querySelector("#branchStatus");
  if (branchStatus) branchStatus.textContent = branches[currentBranch] || "Resistencia";
}

function showLogin(message = "") {
  document.body.classList.add("auth-required");
  document.querySelector("#loginMessage").textContent = message;
}

function hideLogin() {
  document.body.classList.remove("auth-required");
  document.querySelector("#loginMessage").textContent = "";
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Error de conexion");
  return data;
}

async function loadServerState() {
  setSyncStatus("Cargando datos online...");
  try {
    const data = await apiRequest(`/api/state?branch=${currentBranch}`);
    state = { ...initialState, ...(data.data || {}) };
    localStorage.setItem(`${STORE_KEY}-${currentBranch}`, JSON.stringify(state));
    setSyncStatus("Sincronizado online");
  } catch (error) {
    setSyncStatus("No se pudo cargar la nube. Usando respaldo local.");
    console.error(error);
  }
}

function scheduleServerSave() {
  if (booting) return;
  clearTimeout(saveTimer);
  setSyncStatus("Guardando cambios...");
  saveTimer = setTimeout(saveServerState, 500);
}

async function saveServerState() {
  try {
    await apiRequest("/api/state", {
      method: "PUT",
      body: JSON.stringify({ branch: currentBranch, data: state }),
    });
    setSyncStatus("Sincronizado online");
  } catch (error) {
    setSyncStatus("Error al guardar online. Quedo respaldo local.");
    console.error(error);
  }
}

async function switchBranch(branch) {
  currentBranch = branch === "formosa" ? "formosa" : "resistencia";
  localStorage.setItem(BRANCH_KEY, currentBranch);
  document.querySelector("#loginBranch").value = currentBranch;
  document.querySelector("#branchSwitch").value = currentBranch;
  state = loadLocalState();
  currentLoadLines = [];
  currentTripLines = [];
  booting = true;
  await loadServerState();
  booting = false;
  render();
}

async function initServerSession() {
  try {
    const session = await apiRequest("/api/session");
    if (session.authenticated) {
      hideLogin();
      await loadServerState();
      booting = false;
      return;
    }
    booting = false;
    showLogin();
    setSyncStatus("Esperando ingreso");
  } catch (error) {
    booting = false;
    hideLogin();
    setSyncStatus("Modo local: falta conectar con Render");
    console.error(error);
  }
}

function byId(collection, id) {
  return state[collection].find((item) => item.id === id);
}

function dateInRange(dateValue) {
  const from = document.querySelector("#filterFrom").value;
  const to = document.querySelector("#filterTo").value;
  if (from && dateValue < from) return false;
  if (to && dateValue > to) return false;
  return true;
}

function setRange(range) {
  const now = new Date();
  const start = new Date(now);
  if (range === "today") {
    document.querySelector("#filterFrom").value = today();
    document.querySelector("#filterTo").value = today();
  }
  if (range === "week") {
    const day = now.getDay() || 7;
    start.setDate(now.getDate() - day + 1);
    document.querySelector("#filterFrom").value = start.toISOString().slice(0, 10);
    document.querySelector("#filterTo").value = today();
  }
  if (range === "month") {
    document.querySelector("#filterFrom").value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    document.querySelector("#filterTo").value = today();
  }
  render();
}

function netLoadedQty(loadId, furnitureId) {
  const load = byId("loads", loadId);
  if (!load) return 0;
  const loaded = load.items.filter((item) => item.furnitureId === furnitureId).reduce((sum, item) => sum + item.qty, 0);
  const sold = state.transactions
    .filter((item) => item.loadId === loadId && item.furnitureId === furnitureId && item.type === "venta")
    .reduce((sum, item) => sum + item.qty, 0);
  const returned = state.transactions
    .filter((item) => item.loadId === loadId && item.furnitureId === furnitureId && item.type === "devolucion")
    .reduce((sum, item) => sum + item.qty, 0);
  return loaded - sold - returned;
}

function loadExpected(loadId) {
  return state.transactions
    .filter((item) => item.loadId === loadId && item.type === "venta")
    .reduce((sum, item) => sum + item.amount, 0);
}

function loadPaid(loadId) {
  return state.payments
    .filter((item) => item.loadId === loadId)
    .reduce((sum, item) => sum + item.cash + item.transfer, 0);
}

function loadDriver(loadId) {
  const load = byId("loads", loadId);
  return load ? byId("drivers", load.driverId) : null;
}

function loadedLines(load) {
  if (!load) return [];
  return load.items.map((line) => {
    const furniture = byId("furniture", line.furnitureId);
    return {
      furnitureId: line.furnitureId,
      name: furniture ? furniture.name : "Mueble",
      price: line.price || 0,
      loaded: line.qty,
    };
  });
}

function existingLoadTransactions(loadId) {
  return state.transactions.filter((item) => item.loadId === loadId);
}

function loadIsClosed(loadId) {
  const load = byId("loads", loadId);
  if (!load) return false;
  const moved = existingLoadTransactions(loadId).reduce((sum, item) => sum + item.qty, 0);
  const loaded = load.items.reduce((sum, item) => sum + item.qty, 0);
  return loaded > 0 && moved >= loaded;
}

function driverStats(driverId) {
  const loads = state.loads.filter((item) => item.driverId === driverId);
  const loadIds = loads.map((item) => item.id);
  const transactions = state.transactions.filter((item) => loadIds.includes(item.loadId) && dateInRange(item.date));
  const payments = state.payments.filter((item) => item.driverId === driverId && dateInRange(item.date));
  const sold = transactions.filter((item) => item.type === "venta");
  const returned = transactions.filter((item) => item.type === "devolucion");
  const expected = sold.reduce((sum, item) => sum + item.amount, 0);
  const paid = payments.reduce((sum, item) => sum + item.cash + item.transfer, 0);
  return {
    soldQty: sold.reduce((sum, item) => sum + item.qty, 0),
    returnedQty: returned.reduce((sum, item) => sum + item.qty, 0),
    cash: payments.reduce((sum, item) => sum + item.cash, 0),
    transfer: payments.reduce((sum, item) => sum + item.transfer, 0),
    expected,
    pending: 0,
    received: paid,
  };
}

function render() {
  renderSelects();
  renderSummary();
  renderFurniture();
  renderMaterials();
  renderDrivers();
  renderTrips();
  renderLoads();
  renderSettlement();
  renderSales();
  renderPayments();
  renderMovements();
  applyMobileTableLabels();
  saveState();
}

function applyMobileTableLabels() {
  document.querySelectorAll("table").forEach((table) => {
    const labels = Array.from(table.querySelectorAll("thead th")).map((cell) => cell.textContent.trim());
    table.querySelectorAll("tbody tr").forEach((row) => {
      Array.from(row.children).forEach((cell, index) => {
        if (cell.classList.contains("empty")) return;
        cell.dataset.label = labels[index] || "";
      });
    });
  });
}

function renderSelects() {
  fillSelect("#loadDriver", state.drivers, "Seleccionar chofer");
  fillSelect("#tripDriver", state.drivers, "Seleccionar chofer");
  fillSelect("#paymentDriver", state.drivers, "Seleccionar chofer");
  fillSelect("#materialMoveItem", state.materials, "Seleccionar material");
  fillSelect("#loadFurniture", state.furniture, "Seleccionar mueble");
  fillSelect("#tripFurniture", state.furniture, "Seleccionar mueble");
  fillSelect("#saleFurniture", state.furniture, "Seleccionar mueble");
  fillSelect("#saleLoad", state.loads, "Seleccionar salida", formatLoadOption);
  fillSelect("#paymentLoad", state.loads, "Sin salida asignada", formatLoadOption, true);
  fillSelect("#settlementLoad", state.loads.filter((load) => !loadIsClosed(load.id)), "Seleccionar salida pendiente", formatLoadOption);
  fillSelect("#tripCloseLoad", state.loads.filter((load) => !loadIsClosed(load.id)), "Seleccionar salida pendiente", formatLoadOption);
}

function fillSelect(selector, items, emptyLabel, formatter, allowEmpty = false) {
  const select = document.querySelector(selector);
  if (!select) return;
  const current = select.value;
  select.innerHTML = `${allowEmpty ? `<option value="">${emptyLabel}</option>` : `<option value="">${emptyLabel}</option>`}${items
    .map((item) => `<option value="${item.id}">${formatter ? formatter(item) : item.name}</option>`)
    .join("")}`;
  select.value = items.some((item) => item.id === current) || allowEmpty ? current : "";
}

function selectedFurniturePrice() {
  return 0;
}

function updateSaleAmount() {
  const id = document.querySelector("#saleId").value;
  const transaction = id ? byId("transactions", id) : null;
  const amountInput = document.querySelector("#saleAmount");
  if (transaction && Number(amountInput.value) === transaction.amount) return;
  const qty = Number(document.querySelector("#saleQty").value || 0);
  amountInput.value = selectedFurniturePrice() * qty;
}

function validateTransactionQty(transaction) {
  const load = byId("loads", transaction.loadId);
  if (!load) return "Selecciona una salida valida.";
  const loaded = load.items
    .filter((item) => item.furnitureId === transaction.furnitureId)
    .reduce((sum, item) => sum + item.qty, 0);
  if (!loaded) return "Ese mueble no esta cargado en la salida elegida.";

  const alreadyMoved = state.transactions
    .filter((item) => item.loadId === transaction.loadId && item.furnitureId === transaction.furnitureId && item.id !== transaction.id)
    .reduce((sum, item) => sum + item.qty, 0);
  const available = loaded - alreadyMoved;
  if (transaction.qty > available) {
    return `Solo quedan ${available} unidades pendientes para esa salida.`;
  }
  return "";
}

function formatLoadOption(load) {
  const driver = byId("drivers", load.driverId);
  return `${load.date} - ${driver ? driver.name : "Sin chofer"}`;
}

function renderSummary() {
  const sales = state.transactions.filter((item) => item.type === "venta" && dateInRange(item.date));
  const returns = state.transactions.filter((item) => item.type === "devolucion" && dateInRange(item.date));
  const payments = state.payments.filter((item) => dateInRange(item.date));
  const cash = payments.reduce((sum, item) => sum + item.cash, 0);
  const transfer = payments.reduce((sum, item) => sum + item.transfer, 0);
  document.querySelector("#metricSales").textContent = money(cash + transfer);
  document.querySelector("#metricCash").textContent = money(cash);
  document.querySelector("#metricTransfer").textContent = money(transfer);
  document.querySelector("#metricSold").textContent = sales.reduce((sum, item) => sum + item.qty, 0);
  document.querySelector("#metricReturned").textContent = returns.reduce((sum, item) => sum + item.qty, 0);
  document.querySelector("#metricPending").textContent = state.loads.filter((load) => loadIsClosed(load.id)).length;

  document.querySelector("#driverSummaryRows").innerHTML = state.drivers.length
    ? state.drivers
        .map((driver) => {
          const stats = driverStats(driver.id);
          return `<tr><td>${driver.name}</td><td>${stats.soldQty}</td><td>${stats.returnedQty}</td><td>${money(stats.cash)}</td><td>${money(stats.transfer)}</td><td>${money(stats.received)}</td></tr>`;
        })
        .join("")
    : `<tr><td class="empty" colspan="6">Todavia no hay choferes cargados.</td></tr>`;
}

function renderFurniture() {
  document.querySelector("#furnitureRows").innerHTML = state.furniture.length
    ? state.furniture
        .map((item) => {
          const low = item.stock <= item.minStock;
          return `<tr>
            <td>${item.name}</td><td>${item.stock}</td><td>${item.minStock}</td>
            <td><span class="status ${low ? "warn" : "ok"}">${low ? "Bajo" : "Bien"}</span></td>
            <td><button class="small" onclick="editFurniture('${item.id}')">Editar</button></td>
          </tr>`;
        })
        .join("")
    : `<tr><td class="empty" colspan="5">Agrega tu primer mueble para empezar.</td></tr>`;
}

function renderMaterials() {
  document.querySelector("#materialRows").innerHTML = state.materials.length
    ? state.materials
        .map((item) => `<tr><td>${item.name}</td><td>${item.stock}</td><td>${item.unit || "-"}</td><td><button class="small" onclick="editMaterial('${item.id}')">Editar</button></td></tr>`)
        .join("")
    : `<tr><td class="empty" colspan="4">No hay materiales cargados.</td></tr>`;
}

function renderDrivers() {
  const search = document.querySelector("#driverSearch").value.toLowerCase();
  const drivers = state.drivers.filter((driver) => driver.name.toLowerCase().includes(search));
  document.querySelector("#driverCards").innerHTML = drivers.length
    ? drivers
        .map((driver) => {
          const stats = driverStats(driver.id);
          const activeLoads = state.loads.filter((load) => load.driverId === driver.id).length;
          return `<article class="driver-card">
            <div class="panel-title"><h3>${driver.name}</h3><button class="small" onclick="editDriver('${driver.id}')">Editar</button></div>
            <div class="driver-stats">
              <span>Salidas<strong>${activeLoads}</strong></span>
              <span>Vendidos<strong>${stats.soldQty}</strong></span>
              <span>Devueltos<strong>${stats.returnedQty}</strong></span>
              <span>Efectivo<strong>${money(stats.cash)}</strong></span>
              <span>Transferencia<strong>${money(stats.transfer)}</strong></span>
              <span>Recibido<strong>${money(stats.received)}</strong></span>
            </div>
          </article>`;
        })
        .join("")
    : `<p class="empty">No hay choferes para mostrar.</p>`;
}

function renderLoadLines() {
  document.querySelector("#loadLines").innerHTML = currentLoadLines
    .map((line, index) => {
      const item = byId("furniture", line.furnitureId);
      return `<span class="chip">${item ? item.name : "Mueble"} x ${line.qty} <button type="button" onclick="removeLoadLine(${index})">x</button></span>`;
    })
    .join("");
  const total = currentLoadLines.reduce((sum, line) => {
    const item = byId("furniture", line.furnitureId);
    return sum + (item ? item.price * line.qty : 0);
  }, 0);
  document.querySelector("#loadTotal").textContent = money(total);
}

function renderTripLines() {
  document.querySelector("#tripLines").innerHTML = currentTripLines.length
    ? currentTripLines
        .map((line, index) => {
          const item = byId("furniture", line.furnitureId);
          return `<span class="chip">${item ? item.name : "Mueble"} x ${line.qty} <button type="button" onclick="removeTripLine(${index})">x</button></span>`;
        })
        .join("")
    : `<span class="empty">Agrega los muebles que lleva el chofer.</span>`;
  const total = currentTripLines.reduce((sum, line) => {
    return sum + line.qty;
  }, 0);
  document.querySelector("#tripTotal").textContent = `${total} muebles`;
  const editing = Boolean(document.querySelector("#tripId").value);
  document.querySelector("#tripFormTitle").textContent = editing ? "Editar salida" : "Nueva salida";
  document.querySelector("#tripSubmit").textContent = editing ? "Guardar cambios" : "Guardar salida";
  document.querySelector("#cancelTripEdit").style.display = editing ? "" : "none";
}

function tripCloseLines(load) {
  if (!load) return [];
  return loadedLines(load).map((line) => {
    const input = document.querySelector(`[data-trip-returned="${line.furnitureId}"]`);
    const returned = Math.min(line.loaded, Math.max(0, Number(input ? input.value : 0)));
    const sold = line.loaded - returned;
    return { ...line, returned, sold, amount: 0 };
  });
}

function renderTripClose() {
  const load = byId("loads", document.querySelector("#tripCloseLoad").value);
  const cashInput = document.querySelector("#tripCash");
  const transferInput = document.querySelector("#tripTransfer");

  if (!load) {
    document.querySelector("#tripReturnRows").innerHTML = `<p class="empty">Elegi una salida pendiente para cerrarla.</p>`;
    document.querySelector("#tripCashTotal").textContent = money(0);
    document.querySelector("#tripTransferTotal").textContent = money(0);
    document.querySelector("#tripPaidTotal").textContent = money(0);
    document.querySelector("#tripCloseNote").textContent = "";
    return;
  }

  const lines = tripCloseLines(load);
  const cash = Number(cashInput.value || 0);
  const transfer = Number(transferInput.value || 0);
  const paidTotal = cash + transfer;
  document.querySelector("#tripReturnRows").innerHTML = lines
    .map(
      (line) => `<article class="return-row">
        <div><strong>${line.name}</strong><span>Llevo ${line.loaded}</span></div>
        <label>Volvio con <input data-trip-returned="${line.furnitureId}" type="number" min="0" max="${line.loaded}" step="1" value="${line.returned}" /></label>
        <div class="return-result"><span>Vendio</span><strong>${line.sold}</strong></div>
      </article>`
    )
    .join("");
  document.querySelector("#tripCashTotal").textContent = money(cash);
  document.querySelector("#tripTransferTotal").textContent = money(transfer);
  document.querySelector("#tripPaidTotal").textContent = money(paidTotal);
  document.querySelector("#tripCloseNote").textContent = `Vendidos: ${lines.reduce((sum, line) => sum + line.sold, 0)}. Devueltos: ${lines.reduce((sum, line) => sum + line.returned, 0)}. Entrego: ${money(paidTotal)}.`;
  document.querySelectorAll("[data-trip-returned]").forEach((input) => input.addEventListener("input", renderTripClose));
}

function renderTrips() {
  renderTripLines();
  renderTripClose();
  document.querySelector("#tripCards").innerHTML = state.loads.length
    ? state.loads
        .slice()
        .reverse()
        .map((load) => {
          const driver = byId("drivers", load.driverId);
          const lines = loadedLines(load);
          const sold = state.transactions.filter((item) => item.loadId === load.id && item.type === "venta");
          const returned = state.transactions.filter((item) => item.loadId === load.id && item.type === "devolucion");
          const paid = state.payments.filter((item) => item.loadId === load.id).reduce((sum, item) => sum + item.cash + item.transfer, 0);
          const closed = loadIsClosed(load.id);
          const carried = lines.map((line) => `${line.name} x ${line.loaded}`).join(", ");
          return `<article class="driver-card trip-card">
            <div class="panel-title"><h3>${driver ? driver.name : "Sin chofer"}</h3><span class="status ${closed ? "ok" : "warn"}">${closed ? "Cerrado" : "Pendiente"}</span></div>
            <p>${load.date} - ${carried}</p>
            <div class="driver-stats">
              <span>Vendio<strong>${sold.reduce((sum, item) => sum + item.qty, 0)}</strong></span>
              <span>Volvio<strong>${returned.reduce((sum, item) => sum + item.qty, 0)}</strong></span>
              <span>Entrego<strong>${money(paid)}</strong></span>
            </div>
            ${
              closed
                ? ""
                : `<div class="trip-actions">
                    <button class="small" type="button" onclick="editTrip('${load.id}')">Editar salida</button>
                    <button class="small danger" type="button" onclick="deleteTrip('${load.id}')">Eliminar viaje</button>
                  </div>`
            }
          </article>`;
        })
        .join("")
    : `<p class="empty">Todavia no hay viajes cargados.</p>`;
}

function renderLoads() {
  renderLoadLines();
  document.querySelector("#loadRows").innerHTML = state.loads.length
    ? state.loads
        .slice()
        .reverse()
        .map((load) => {
          const driver = byId("drivers", load.driverId);
          const items = load.items
            .map((line) => {
              const item = byId("furniture", line.furnitureId);
              return `${item ? item.name : "Mueble"} x ${line.qty}`;
            })
            .join(", ");
          const closed = loadIsClosed(load.id);
          return `<tr><td>${load.date}</td><td>${driver ? driver.name : "-"}</td><td>${items}</td><td>${money(load.total)}</td><td><span class="status ${closed ? "ok" : "warn"}">${closed ? "Cerrada" : "Pendiente"}</span></td><td><button class="small" onclick="editLoad('${load.id}')">Editar</button></td></tr>`;
        })
        .join("")
    : `<tr><td class="empty" colspan="6">Todavia no cargaste salidas.</td></tr>`;
}

function settlementReceived() {
  return Number(document.querySelector("#settlementCash").value || 0) + Number(document.querySelector("#settlementTransfer").value || 0);
}

function automaticSingleItemSettlement(load) {
  const line = loadedLines(load)[0];
  if (!line || line.price <= 0) return [];
  const sold = Math.min(line.loaded, Math.floor(settlementReceived() / line.price));
  return [{ ...line, returned: line.loaded - sold, sold, amount: sold * line.price }];
}

function manualSettlement(load) {
  return loadedLines(load).map((line) => {
    const input = document.querySelector(`[data-returned="${line.furnitureId}"]`);
    const returned = Math.min(line.loaded, Math.max(0, Number(input ? input.value : 0)));
    const sold = line.loaded - returned;
    return { ...line, returned, sold, amount: sold * line.price };
  });
}

function settlementLines(load) {
  if (!load) return [];
  return load.items.length === 1 ? automaticSingleItemSettlement(load) : manualSettlement(load);
}

function renderSettlement() {
  const load = byId("loads", document.querySelector("#settlementLoad").value);
  const driver = load ? loadDriver(load.id) : null;
  const received = settlementReceived();
  document.querySelector("#settlementReceived").textContent = money(received);
  document.querySelector("#settlementTitle").textContent = load ? `${driver ? driver.name : "Chofer"} - salida ${load.date}` : "Elegir una salida";

  if (!load) {
    document.querySelector("#settlementRows").innerHTML = `<tr><td class="empty" colspan="6">Selecciona una salida para calcular la rendicion.</td></tr>`;
    document.querySelector("#settlementNote").textContent = "";
    return;
  }

  const lines = settlementLines(load);
  const expected = lines.reduce((sum, line) => sum + line.amount, 0);
  const difference = received - expected;
  document.querySelector("#settlementRows").innerHTML = lines
    .map((line) => {
      const returnedControl =
        load.items.length === 1
          ? `${line.returned}`
          : `<input data-returned="${line.furnitureId}" type="number" min="0" max="${line.loaded}" step="1" value="${line.returned}" />`;
      return `<tr>
        <td>${line.name}</td>
        <td>${line.loaded}</td>
        <td>${money(line.price)}</td>
        <td>${returnedControl}</td>
        <td>${line.sold}</td>
        <td>${money(line.amount)}</td>
      </tr>`;
    })
    .join("");

  if (load.items.length === 1) {
    const line = lines[0];
    const remainder = received - line.amount;
    document.querySelector("#settlementNote").textContent =
      remainder > 0
        ? `Calculo automatico: vendio ${line.sold}, volvio ${line.returned}. Sobran ${money(remainder)} sobre el precio exacto.`
        : `Calculo automatico: vendio ${line.sold}, volvio ${line.returned}.`;
  } else {
    document.querySelector("#settlementNote").textContent =
      difference === 0
        ? "El dinero recibido coincide con lo vendido segun las devoluciones cargadas."
        : `Diferencia entre dinero recibido y ventas calculadas: ${money(difference)}.`;
    document.querySelectorAll("[data-returned]").forEach((input) => input.addEventListener("input", renderSettlement));
  }
}

function renderSales() {
  document.querySelector("#saleRows").innerHTML = state.transactions.length
    ? state.transactions
        .slice()
        .reverse()
        .map((item) => {
          const load = byId("loads", item.loadId);
          const driver = load ? byId("drivers", load.driverId) : null;
          const furniture = byId("furniture", item.furnitureId);
          return `<tr><td>${item.date}</td><td>${driver ? driver.name : "-"}</td><td>${furniture ? furniture.name : "-"}</td><td>${item.type}</td><td>${item.qty}</td><td>${item.payment}</td><td>${money(item.amount)}</td><td><button class="small" onclick="editSale('${item.id}')">Editar</button></td></tr>`;
        })
        .join("")
    : `<tr><td class="empty" colspan="8">No hay ventas ni devoluciones cargadas.</td></tr>`;
}

function renderPayments() {
  document.querySelector("#paymentRows").innerHTML = state.payments.length
    ? state.payments
        .slice()
        .reverse()
        .map((item) => {
          const driver = byId("drivers", item.driverId);
          const load = item.loadId ? byId("loads", item.loadId) : null;
          return `<tr><td>${item.date}</td><td>${driver ? driver.name : "-"}</td><td>${load ? formatLoadOption(load) : "-"}</td><td>${money(item.cash)}</td><td>${money(item.transfer)}</td><td><button class="small" onclick="editPayment('${item.id}')">Editar</button></td></tr>`;
        })
        .join("")
    : `<tr><td class="empty" colspan="6">No hay dinero recibido cargado.</td></tr>`;
}

function renderMovements() {
  const stockMoves = [
    ...state.loads.map((item) => ({ date: item.date, type: "Salida chofer", detail: formatLoadOption(item), impact: `-${item.items.reduce((sum, line) => sum + line.qty, 0)} muebles` })),
    ...state.transactions.map((item) => {
      const furniture = byId("furniture", item.furnitureId);
      return { date: item.date, type: item.type, detail: furniture ? furniture.name : "Mueble", impact: `${item.type === "devolucion" ? "+" : "0"}${item.type === "devolucion" ? item.qty : " vendido"}` };
    }),
    ...state.materialMoves.map((item) => {
      const material = byId("materials", item.materialId);
      return { date: item.date, type: `Material ${item.type}`, detail: material ? material.name : "Material", impact: `${item.type === "entrada" ? "+" : "-"}${item.qty}` };
    }),
  ].sort((a, b) => b.date.localeCompare(a.date));

  document.querySelector("#movementRows").innerHTML = stockMoves.length
    ? stockMoves.map((item) => `<tr><td>${item.date}</td><td>${item.type}</td><td>${item.detail}</td><td>${item.impact}</td></tr>`).join("")
    : `<tr><td class="empty" colspan="4">Los movimientos van a aparecer aca.</td></tr>`;
}

function resetForm(formId) {
  document.querySelector(formId).reset();
  document.querySelectorAll(`${formId} input[type="hidden"]`).forEach((input) => (input.value = ""));
}

function editFurniture(id) {
  const item = byId("furniture", id);
  document.querySelector("#furnitureId").value = item.id;
  document.querySelector("#furnitureName").value = item.name;
  document.querySelector("#furnitureStock").value = item.stock;
  document.querySelector("#furnitureMin").value = item.minStock;
}

function editMaterial(id) {
  const item = byId("materials", id);
  document.querySelector("#materialId").value = item.id;
  document.querySelector("#materialName").value = item.name;
  document.querySelector("#materialStock").value = item.stock;
  document.querySelector("#materialUnit").value = item.unit || "";
}

function editDriver(id) {
  const item = byId("drivers", id);
  document.querySelector("#driverId").value = item.id;
  document.querySelector("#driverName").value = item.name;
  document.querySelector("#driverPhone").value = item.phone || "";
}

function editLoad(id) {
  const item = byId("loads", id);
  document.querySelector("#loadId").value = item.id;
  document.querySelector("#loadDate").value = item.date;
  document.querySelector("#loadDriver").value = item.driverId;
  document.querySelector("#loadNote").value = item.note || "";
  currentLoadLines = item.items.map((line) => ({ ...line }));
  renderLoadLines();
}

function editSale(id) {
  const item = byId("transactions", id);
  document.querySelector("#saleId").value = item.id;
  document.querySelector("#saleDate").value = item.date;
  document.querySelector("#saleLoad").value = item.loadId;
  document.querySelector("#saleFurniture").value = item.furnitureId;
  document.querySelector("#saleType").value = item.type;
  document.querySelector("#saleQty").value = item.qty;
  document.querySelector("#salePayment").value = item.payment;
  document.querySelector("#saleAmount").value = item.amount;
}

function editPayment(id) {
  const item = byId("payments", id);
  document.querySelector("#paymentId").value = item.id;
  document.querySelector("#paymentDate").value = item.date;
  document.querySelector("#paymentDriver").value = item.driverId;
  document.querySelector("#paymentLoad").value = item.loadId || "";
  document.querySelector("#paymentCash").value = item.cash;
  document.querySelector("#paymentTransfer").value = item.transfer;
  document.querySelector("#paymentNote").value = item.note || "";
}

function removeLoadLine(index) {
  currentLoadLines.splice(index, 1);
  renderLoadLines();
}

function removeTripLine(index) {
  currentTripLines.splice(index, 1);
  renderTripLines();
}

function resetTripForm() {
  currentTripLines = [];
  resetForm("#tripForm");
  document.querySelector("#tripDate").value = today();
  renderTripLines();
}

function editTrip(id) {
  const load = byId("loads", id);
  if (!load) return;
  if (loadIsClosed(load.id) || existingLoadTransactions(load.id).length) {
    alert("Solo se pueden editar salidas pendientes.");
    return;
  }
  document.querySelector("#tripId").value = load.id;
  document.querySelector("#tripDate").value = load.date;
  document.querySelector("#tripDriver").value = load.driverId;
  document.querySelector("#tripNote").value = load.note || "";
  currentTripLines = load.items.map((line) => ({ ...line }));
  document.querySelector("#viajes").scrollIntoView({ behavior: "smooth", block: "start" });
  renderTripLines();
}

function deleteTrip(id) {
  const load = byId("loads", id);
  if (!load) return;
  if (loadIsClosed(load.id) || existingLoadTransactions(load.id).length) {
    alert("Solo se pueden eliminar viajes pendientes.");
    return;
  }
  const driver = byId("drivers", load.driverId);
  const confirmed = confirm(`Eliminar el viaje pendiente de ${driver ? driver.name : "este chofer"}? El stock se devuelve automaticamente.`);
  if (!confirmed) return;
  reverseStockDeltaFromLoad(load);
  state.loads = state.loads.filter((item) => item.id !== id);
  if (document.querySelector("#tripId").value === id) resetTripForm();
  render();
}

function stockDeltaFromLoad(load) {
  load.items.forEach((line) => {
    const item = byId("furniture", line.furnitureId);
    if (item) item.stock -= line.qty;
  });
}

function reverseStockDeltaFromLoad(load) {
  load.items.forEach((line) => {
    const item = byId("furniture", line.furnitureId);
    if (item) item.stock += line.qty;
  });
}

function stockDeltaFromTransaction(transaction) {
  const item = byId("furniture", transaction.furnitureId);
  if (item && transaction.type === "devolucion") item.stock += transaction.qty;
}

function reverseStockDeltaFromTransaction(transaction) {
  const item = byId("furniture", transaction.furnitureId);
  if (item && transaction.type === "devolucion") item.stock -= transaction.qty;
}

function clearMovementsOnly() {
  const confirmed = confirm("Esto borra viajes, ventas, devoluciones, cobros y movimientos de materiales. Muebles y choferes quedan guardados. Continuar?");
  if (!confirmed) return;
  state.loads.forEach(reverseStockDeltaFromLoad);
  state.transactions.forEach(reverseStockDeltaFromTransaction);
  state.materialMoves.forEach((move) => {
    const material = byId("materials", move.materialId);
    if (material) material.stock += move.type === "entrada" ? -move.qty : move.qty;
  });
  state.loads = [];
  state.transactions = [];
  state.payments = [];
  state.materialMoves = [];
  currentLoadLines = [];
  currentTripLines = [];
  render();
}

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-button, .view").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.view}`).classList.add("active");
    document.querySelector("#viewTitle").textContent = button.textContent;
  });
});

document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => setRange(button.dataset.range)));
document.querySelector("#filterFrom").addEventListener("change", render);
document.querySelector("#filterTo").addEventListener("change", render);
document.querySelector("#driverSearch").addEventListener("input", renderDrivers);
document.querySelector("#filterToggle").addEventListener("click", () => {
  document.querySelector(".topbar").classList.toggle("filters-open");
});
document.querySelector("#filterClose").addEventListener("click", () => {
  document.querySelector(".topbar").classList.remove("filters-open");
});
document.querySelector("#branchSwitch").addEventListener("change", (event) => {
  switchBranch(event.target.value);
});
document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.querySelector("#loginPassword").value;
  currentBranch = document.querySelector("#loginBranch").value;
  localStorage.setItem(BRANCH_KEY, currentBranch);
  document.querySelector("#branchSwitch").value = currentBranch;
  document.querySelector("#loginMessage").textContent = "Ingresando...";
  try {
    await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    hideLogin();
    booting = true;
    await loadServerState();
    booting = false;
    render();
  } catch (error) {
    showLogin("Contrasena incorrecta o servidor sin configurar.");
    console.error(error);
  }
});

document.querySelector("#furnitureForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = document.querySelector("#furnitureId").value || uid();
  const old = byId("furniture", id);
  const item = {
    id,
    name: document.querySelector("#furnitureName").value.trim(),
    price: 0,
    stock: Number(document.querySelector("#furnitureStock").value),
    minStock: Number(document.querySelector("#furnitureMin").value || 0),
  };
  state.furniture = old ? state.furniture.map((entry) => (entry.id === id ? item : entry)) : [...state.furniture, item];
  resetForm("#furnitureForm");
  render();
});

document.querySelector("#materialForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = document.querySelector("#materialId").value || uid();
  const old = byId("materials", id);
  const item = {
    id,
    name: document.querySelector("#materialName").value.trim(),
    stock: Number(document.querySelector("#materialStock").value),
    unit: document.querySelector("#materialUnit").value.trim(),
  };
  state.materials = old ? state.materials.map((entry) => (entry.id === id ? item : entry)) : [...state.materials, item];
  resetForm("#materialForm");
  render();
});

document.querySelector("#materialMoveForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const material = byId("materials", document.querySelector("#materialMoveItem").value);
  const qty = Number(document.querySelector("#materialMoveQty").value);
  const type = document.querySelector("#materialMoveType").value;
  if (!material) return;
  material.stock += type === "entrada" ? qty : -qty;
  state.materialMoves.push({ id: uid(), date: today(), materialId: material.id, type, qty, note: document.querySelector("#materialMoveNote").value.trim() });
  resetForm("#materialMoveForm");
  render();
});

document.querySelector("#driverForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = document.querySelector("#driverId").value || uid();
  const old = byId("drivers", id);
  const item = { id, name: document.querySelector("#driverName").value.trim(), phone: document.querySelector("#driverPhone").value.trim() };
  state.drivers = old ? state.drivers.map((entry) => (entry.id === id ? item : entry)) : [...state.drivers, item];
  resetForm("#driverForm");
  render();
});

document.querySelector("#addTripLine").addEventListener("click", () => {
  const furnitureId = document.querySelector("#tripFurniture").value;
  const qty = Number(document.querySelector("#tripQty").value);
  if (!furnitureId || qty <= 0) return;
  const furniture = byId("furniture", furnitureId);
  const editingLoad = byId("loads", document.querySelector("#tripId").value);
  const originalQty = editingLoad
    ? editingLoad.items.filter((line) => line.furnitureId === furnitureId).reduce((sum, line) => sum + line.qty, 0)
    : 0;
  const already = currentTripLines.filter((line) => line.furnitureId === furnitureId).reduce((sum, line) => sum + line.qty, 0);
  const available = furniture ? furniture.stock + originalQty : 0;
  if (furniture && qty + already > available) return alert(`Stock disponible de ${furniture.name}: ${available}.`);
  const existing = currentTripLines.find((line) => line.furnitureId === furnitureId);
  if (existing) existing.qty += qty;
  else currentTripLines.push({ furnitureId, qty });
  document.querySelector("#tripQty").value = "";
  renderTripLines();
});

document.querySelector("#tripForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!currentTripLines.length) return alert("Agrega al menos un mueble.");
  const id = document.querySelector("#tripId").value || uid();
  const old = byId("loads", id);
  if (old && (loadIsClosed(old.id) || existingLoadTransactions(old.id).length)) return alert("Solo se pueden editar salidas pendientes.");
  if (old) reverseStockDeltaFromLoad(old);
  const total = currentTripLines.reduce((sum, line) => {
    return sum + line.qty;
  }, 0);
  const load = {
    id,
    date: document.querySelector("#tripDate").value,
    driverId: document.querySelector("#tripDriver").value,
    note: document.querySelector("#tripNote").value.trim(),
    items: currentTripLines.map((line) => ({ ...line })),
    total,
  };
  stockDeltaFromLoad(load);
  state.loads = old ? state.loads.map((entry) => (entry.id === id ? load : entry)) : [...state.loads, load];
  resetTripForm();
  render();
});

document.querySelector("#tripCloseForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const load = byId("loads", document.querySelector("#tripCloseLoad").value);
  if (!load) return alert("Selecciona una salida pendiente.");
  if (loadIsClosed(load.id) || existingLoadTransactions(load.id).length) return alert("Esta salida ya fue cerrada.");

  const cash = Number(document.querySelector("#tripCash").value || 0);
  const transfer = Number(document.querySelector("#tripTransfer").value || 0);
  const lines = tripCloseLines(load);
  if (lines.some((line) => line.returned < 0 || line.returned > line.loaded)) return alert("Revisa las cantidades que volvieron.");

  const date = document.querySelector("#tripCloseDate").value;
  lines.forEach((line) => {
    if (line.sold > 0) {
      state.transactions.push({
        id: uid(),
        date,
        loadId: load.id,
        furnitureId: line.furnitureId,
        type: "venta",
        qty: line.sold,
        payment: cash && transfer ? "mixto" : cash ? "efectivo" : transfer ? "transferencia" : "-",
        amount: 0,
      });
    }
    if (line.returned > 0) {
      const transaction = {
        id: uid(),
        date,
        loadId: load.id,
        furnitureId: line.furnitureId,
        type: "devolucion",
        qty: line.returned,
        payment: "-",
        amount: 0,
      };
      stockDeltaFromTransaction(transaction);
      state.transactions.push(transaction);
    }
  });

  state.payments.push({
    id: uid(),
    date,
    driverId: load.driverId,
    loadId: load.id,
    cash,
    transfer,
    note: "Cierre de viaje",
  });

  resetForm("#tripCloseForm");
  document.querySelector("#tripCloseDate").value = today();
  document.querySelector("#tripCash").value = 0;
  document.querySelector("#tripTransfer").value = 0;
  render();
});

document.querySelector("#addLoadLine").addEventListener("click", () => {
  const furnitureId = document.querySelector("#loadFurniture").value;
  const qty = Number(document.querySelector("#loadQty").value);
  if (!furnitureId || qty <= 0) return;
  const existing = currentLoadLines.find((line) => line.furnitureId === furnitureId);
  if (existing) existing.qty += qty;
  else currentLoadLines.push({ furnitureId, qty });
  document.querySelector("#loadQty").value = "";
  renderLoadLines();
});

document.querySelector("#loadForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!currentLoadLines.length) return alert("Agrega al menos un mueble a la salida.");
  const id = document.querySelector("#loadId").value || uid();
  const old = byId("loads", id);
  if (old) reverseStockDeltaFromLoad(old);
  const total = currentLoadLines.reduce((sum, line) => {
    const item = byId("furniture", line.furnitureId);
    return sum + (item ? item.price * line.qty : 0);
  }, 0);
  const load = {
    id,
    date: document.querySelector("#loadDate").value,
    driverId: document.querySelector("#loadDriver").value,
    note: document.querySelector("#loadNote").value.trim(),
    items: currentLoadLines.map((line) => ({ ...line })),
    total,
  };
  stockDeltaFromLoad(load);
  state.loads = old ? state.loads.map((entry) => (entry.id === id ? load : entry)) : [...state.loads, load];
  currentLoadLines = [];
  resetForm("#loadForm");
  document.querySelector("#loadDate").value = today();
  render();
});

document.querySelector("#saleForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = document.querySelector("#saleId").value || uid();
  const old = byId("transactions", id);
  const transaction = {
    id,
    date: document.querySelector("#saleDate").value,
    loadId: document.querySelector("#saleLoad").value,
    furnitureId: document.querySelector("#saleFurniture").value,
    type: document.querySelector("#saleType").value,
    qty: Number(document.querySelector("#saleQty").value),
    payment: document.querySelector("#salePayment").value,
    amount: Number(document.querySelector("#saleAmount").value),
  };
  const error = validateTransactionQty(transaction);
  if (error) return alert(error);
  if (old) reverseStockDeltaFromTransaction(old);
  stockDeltaFromTransaction(transaction);
  state.transactions = old ? state.transactions.map((entry) => (entry.id === id ? transaction : entry)) : [...state.transactions, transaction];
  resetForm("#saleForm");
  document.querySelector("#saleDate").value = today();
  render();
});

document.querySelector("#paymentForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = document.querySelector("#paymentId").value || uid();
  const old = byId("payments", id);
  const item = {
    id,
    date: document.querySelector("#paymentDate").value,
    driverId: document.querySelector("#paymentDriver").value,
    loadId: document.querySelector("#paymentLoad").value,
    cash: Number(document.querySelector("#paymentCash").value || 0),
    transfer: Number(document.querySelector("#paymentTransfer").value || 0),
    note: document.querySelector("#paymentNote").value.trim(),
  };
  state.payments = old ? state.payments.map((entry) => (entry.id === id ? item : entry)) : [...state.payments, item];
  resetForm("#paymentForm");
  document.querySelector("#paymentDate").value = today();
  render();
});

document.querySelector("#settlementForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const load = byId("loads", document.querySelector("#settlementLoad").value);
  if (!load) return alert("Selecciona una salida para cerrar.");
  if (loadIsClosed(load.id)) return alert("Esta salida ya esta cerrada.");
  if (existingLoadTransactions(load.id).length) {
    return alert("Esta salida ya tiene ventas o devoluciones cargadas. Editalas desde Ventas y devoluciones, o usa una salida sin movimientos.");
  }

  const cash = Number(document.querySelector("#settlementCash").value || 0);
  const transfer = Number(document.querySelector("#settlementTransfer").value || 0);
  const received = cash + transfer;
  const lines = settlementLines(load);
  const expected = lines.reduce((sum, line) => sum + line.amount, 0);
  if (received !== expected) {
    return alert(`El dinero recibido (${money(received)}) no coincide con lo vendido (${money(expected)}). Revisa efectivo, transferencia o devoluciones.`);
  }

  const date = document.querySelector("#settlementDate").value;
  const paymentType = cash && transfer ? "mixto" : cash ? "efectivo" : "transferencia";
  lines.forEach((line) => {
    if (line.sold > 0) {
      state.transactions.push({
        id: uid(),
        date,
        loadId: load.id,
        furnitureId: line.furnitureId,
        type: "venta",
        qty: line.sold,
        payment: paymentType,
        amount: line.amount,
      });
    }
    if (line.returned > 0) {
      const transaction = {
        id: uid(),
        date,
        loadId: load.id,
        furnitureId: line.furnitureId,
        type: "devolucion",
        qty: line.returned,
        payment: "-",
        amount: 0,
      };
      stockDeltaFromTransaction(transaction);
      state.transactions.push(transaction);
    }
  });

  state.payments.push({
    id: uid(),
    date,
    driverId: load.driverId,
    loadId: load.id,
    cash,
    transfer,
    note: "Cierre automatico de salida",
  });

  resetForm("#settlementForm");
  document.querySelector("#settlementDate").value = today();
  render();
});

document.querySelector("#clearFurniture").addEventListener("click", () => resetForm("#furnitureForm"));
document.querySelector("#clearMaterial").addEventListener("click", () => resetForm("#materialForm"));
document.querySelector("#clearDriver").addEventListener("click", () => resetForm("#driverForm"));
document.querySelector("#clearSale").addEventListener("click", () => resetForm("#saleForm"));
document.querySelector("#clearPayment").addEventListener("click", () => resetForm("#paymentForm"));
document.querySelector("#clearMovements").addEventListener("click", clearMovementsOnly);
document.querySelector("#cancelTripEdit").addEventListener("click", resetTripForm);
document.querySelector("#saleFurniture").addEventListener("change", updateSaleAmount);
document.querySelector("#saleQty").addEventListener("input", updateSaleAmount);
document.querySelector("#settlementLoad").addEventListener("change", renderSettlement);
document.querySelector("#settlementCash").addEventListener("input", renderSettlement);
document.querySelector("#settlementTransfer").addEventListener("input", renderSettlement);
document.querySelector("#calculateSettlement").addEventListener("click", renderSettlement);
document.querySelector("#tripCloseLoad").addEventListener("change", renderTripClose);
document.querySelector("#tripCash").addEventListener("input", renderTripClose);
document.querySelector("#tripTransfer").addEventListener("input", renderTripClose);

async function initApp() {
  document.querySelector("#loginBranch").value = currentBranch;
  document.querySelector("#branchSwitch").value = currentBranch;
  document.querySelector("#loadDate").value = today();
  document.querySelector("#tripDate").value = today();
  document.querySelector("#tripCloseDate").value = today();
  document.querySelector("#saleDate").value = today();
  document.querySelector("#paymentDate").value = today();
  document.querySelector("#settlementDate").value = today();
  await initServerSession();
  setRange("today");
}

initApp();
