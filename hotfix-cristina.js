(() => {
  const localityNames = {
    "el-colorado": "El Colorado",
    "laguna-blanca": "Laguna Blanca",
    pirane: "Pirane",
    clorinda: "Clorinda",
    formosa: "Formosa",
    fontana: "Fontana",
    resistencia: "Resistencia",
  };
  Object.assign(branches, localityNames);

  const defaultLocality = "resistencia";
  const validBranch = (branch) => (branches[branch] ? branch : defaultLocality);
  const branchOptionsHtml = (selected = currentBranch, excluded = "") =>
    Object.entries(branches)
      .filter(([id]) => id !== excluded)
      .map(([id, name]) => `<option value="${id}"${id === selected ? " selected" : ""}>${name}</option>`)
      .join("");

  function syncBranchControls() {
    const loginBranch = document.querySelector("#loginBranch");
    const branchSwitch = document.querySelector("#branchSwitch");
    if (loginBranch) loginBranch.innerHTML = branchOptionsHtml(validBranch(currentBranch));
    if (branchSwitch) branchSwitch.innerHTML = branchOptionsHtml(validBranch(currentBranch));
    if (loginBranch) loginBranch.value = validBranch(currentBranch);
    if (branchSwitch) branchSwitch.value = validBranch(currentBranch);
  }

  function ensureDispatchDestinationSelect() {
    const dispatchTo = document.querySelector("#dispatchTo");
    if (!dispatchTo || dispatchTo.tagName === "SELECT") return document.querySelector("#dispatchTo");
    const select = document.createElement("select");
    select.id = "dispatchTo";
    select.required = true;
    dispatchTo.replaceWith(select);
    select.addEventListener("change", renderDispatches);
    return select;
  }

  function chooseFirstPending(selector) {
    const select = document.querySelector(selector);
    if (select && !select.value && select.options.length > 1) select.selectedIndex = 1;
  }

  function txQty(loadId, furnitureId, type, predicate = () => true) {
    return state.transactions
      .filter((item) => item.loadId === loadId && item.furnitureId === furnitureId && item.type === type && predicate(item))
      .reduce((sum, item) => sum + item.qty, 0);
  }

  function pendingLoaded(load) {
    return loadedLines(load)
      .map((line) => {
        const sold = txQty(load.id, line.furnitureId, "venta", (item) => item.note !== "Pedido");
        const returned = txQty(load.id, line.furnitureId, "devolucion");
        const pending = Math.max(0, line.loaded - sold - returned);
        return { ...line, originalLoaded: line.loaded, loaded: pending, alreadyMoved: sold + returned };
      })
      .filter((line) => line.loaded > 0);
  }

  function pendingOrders(load) {
    const totals = (load.orders || []).reduce((acc, line) => {
      acc[line.furnitureId] = (acc[line.furnitureId] || 0) + line.qty;
      return acc;
    }, {});
    return Object.entries(totals)
      .map(([furnitureId, qty]) => {
        const sold = txQty(load.id, furnitureId, "venta", (item) => item.note === "Pedido");
        return { furnitureId, qty: Math.max(0, qty - sold) };
      })
      .filter((line) => line.qty > 0);
  }

  switchBranch = async function (branch) {
    currentBranch = validBranch(branch);
    localStorage.setItem(BRANCH_KEY, currentBranch);
    syncBranchControls();
    state = loadLocalState();
    currentLoadLines = [];
    currentTripLines = [];
    currentTripOrders = [];
    currentTripRetired = [];
    currentDispatchLines = [];
    booting = true;
    await loadServerState();
    booting = false;
    render();
  };

  loadIsClosed = function (loadId) {
    const load = byId("loads", loadId);
    if (!load) return false;
    return Boolean(load.closedAt || load.closedDate);
  };

  tripCloseLines = function (load) {
    const lines = pendingLoaded(load);
    const closeLines = lines.length ? lines : loadedLines(load);
    return closeLines.map((line) => {
      const input = document.querySelector(`[data-trip-returned="${line.furnitureId}"]`);
      const returned = Math.min(line.loaded, Math.max(0, Number(input ? input.value : 0)));
      return { ...line, returned, sold: line.loaded - returned, amount: 0 };
    });
  };

  const oldRenderSelects = renderSelects;
  renderSelects = function () {
    oldRenderSelects();
    chooseFirstPending("#tripCloseLoad");
  };

  renderTripClose = function () {
    chooseFirstPending("#tripCloseLoad");
    const load = byId("loads", document.querySelector("#tripCloseLoad").value);
    const cash = Number(document.querySelector("#tripCash").value || 0);
    const transfer = Number(document.querySelector("#tripTransfer").value || 0);
    if (!load) {
      document.querySelector("#tripReturnRows").innerHTML = `<p class="empty">Elegi una salida pendiente para cerrarla.</p>`;
      document.querySelector("#tripCashTotal").textContent = money(0);
      document.querySelector("#tripTransferTotal").textContent = money(0);
      document.querySelector("#tripPaidTotal").textContent = money(0);
      document.querySelector("#tripCloseNote").textContent = "";
      renderTripRetiredLines();
      return;
    }
    const lines = tripCloseLines(load);
    const orderQty = pendingOrders(load).reduce((sum, line) => sum + line.qty, 0);
    document.querySelector("#tripReturnRows").innerHTML = lines.length
      ? lines
          .map(
            (line) => `<article class="return-row">
        <div><strong>${line.name}</strong><span>Pendiente ${line.loaded}${line.alreadyMoved ? ` de ${line.originalLoaded}` : ""}</span></div>
        <label>Volvio con <input data-trip-returned="${line.furnitureId}" type="number" min="0" max="${line.loaded}" step="1" value="${line.returned}" /></label>
        <div class="return-result"><span>Vendio</span><strong>${line.sold}</strong></div>
      </article>`
          )
          .join("")
      : `<p class="empty">No quedan muebles cargados pendientes. Podes registrar el dinero, retirados o cerrar el viaje.</p>`;
    document.querySelector("#tripCashTotal").textContent = money(cash);
    document.querySelector("#tripTransferTotal").textContent = money(transfer);
    document.querySelector("#tripPaidTotal").textContent = money(cash + transfer);
    document.querySelector("#tripCloseNote").textContent = `Vendidos: ${lines.reduce((sum, line) => sum + line.sold, 0)}. Pedidos: ${orderQty}. Devueltos: ${lines.reduce((sum, line) => sum + line.returned, 0)}. Entrego: ${money(cash + transfer)}.`;
    document.querySelectorAll("[data-trip-returned]").forEach((input) => input.addEventListener("input", renderTripClose));
    renderTripRetiredLines();
  };

  renderTrips = function () {
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
            <p>${load.date} - Carga: ${carried || "-"}</p>
            <div class="driver-stats">
              <span>Vendio<strong>${sold.reduce((sum, item) => sum + item.qty, 0)}</strong></span>
              <span>Volvio<strong>${returned.reduce((sum, item) => sum + item.qty, 0)}</strong></span>
              <span>Entrego<strong>${money(paid)}</strong></span>
            </div>
            ${closed ? "" : `<div class="trip-actions"><button class="small" type="button" onclick="prepareTripClose('${load.id}')">Cerrar viaje</button><button class="small" type="button" onclick="editTrip('${load.id}')">Editar salida</button><button class="small danger" type="button" onclick="deleteTrip('${load.id}')">Eliminar viaje</button></div>`}
          </article>`;
          })
          .join("")
      : `<p class="empty">Todavia no hay viajes cargados.</p>`;
  };

  renderDispatches = function () {
    const dispatchTo = ensureDispatchDestinationSelect();
    if (!dispatchTo) return;
    const currentTo = dispatchTo.value && dispatchTo.value !== currentBranch ? dispatchTo.value : "";
    const toBranch = currentTo || Object.keys(branches).find((id) => id !== currentBranch) || defaultLocality;
    document.querySelector("#dispatchFrom").value = branches[currentBranch];
    dispatchTo.innerHTML = branchOptionsHtml(toBranch, currentBranch);
    document.querySelector("#dispatchLines").innerHTML = currentDispatchLines.length
      ? currentDispatchLines.map((line, index) => `<span class="chip">${line.name} x ${line.qty} <button type="button" onclick="removeDispatchLine(${index})">x</button></span>`).join("")
      : `<span class="empty">Agrega los muebles para enviar a ${branches[toBranch]}.</span>`;
    document.querySelector("#dispatchTotal").textContent = `${currentDispatchLines.reduce((sum, line) => sum + line.qty, 0)} muebles`;
    document.querySelector("#dispatchCards").innerHTML = (state.dispatches || []).length
      ? state.dispatches
          .slice()
          .reverse()
          .map((dispatch) => {
            const lines = dispatch.lines.map((line) => `${line.name} x ${line.qty}`).join(", ");
            const label = dispatch.direction === "recibido" ? `Recibido desde ${branches[dispatch.from] || dispatch.from}` : `Enviado a ${branches[dispatch.to] || dispatch.to}`;
            return `<article class="driver-card trip-card"><div class="panel-title"><h3>${label}</h3><span class="status ok">${dispatch.date}</span></div><p>${lines}</p>${dispatch.note ? `<p>${dispatch.note}</p>` : ""}</article>`;
          })
          .join("")
      : `<p class="empty">Todavia no hay despachos.</p>`;
  };

  renderMovements = function () {
    const retiredTotals = state.retiredStock.reduce((acc, item) => {
      acc[item.name] = (acc[item.name] || 0) + item.qty;
      return acc;
    }, {});
    document.querySelector("#retiredSummary").innerHTML = Object.keys(retiredTotals).length
      ? `<h3>Muebles retirados para retocar</h3><div class="chips">${Object.entries(retiredTotals).map(([name, qty]) => `<span class="chip">${name} x ${qty}</span>`).join("")}</div>`
      : `<p class="empty">No hay muebles retirados para retocar.</p>`;
    const head = document.querySelector("#movimientos thead tr");
    if (head && head.children.length < 5) head.insertAdjacentHTML("beforeend", "<th></th>");
    const moves = [
      ...state.loads.map((item) => ({
        date: item.date,
        type: "Salida chofer",
        detail: formatLoadOption(item),
        impact: `-${[...(item.items || []), ...(item.orders || [])].reduce((sum, line) => sum + line.qty, 0)} muebles`,
        action: `<button class="small" type="button" onclick="prepareTripClose('${item.id}')">${loadIsClosed(item.id) ? "Ver" : "Cerrar"}</button>`,
      })),
      ...state.transactions.map((item) => {
        const furniture = byId("furniture", item.furnitureId);
        return { date: item.date, type: item.type, detail: furniture ? furniture.name : "Mueble", impact: `${item.type === "devolucion" ? "+" : "0"}${item.type === "devolucion" ? item.qty : " vendido"}` };
      }),
      ...state.materialMoves.map((item) => {
        const material = byId("materials", item.materialId);
        return { date: item.date, type: `Material ${item.type}`, detail: material ? material.name : "Material", impact: `${item.type === "entrada" ? "+" : "-"}${item.qty}` };
      }),
      ...state.retiredStock.map((item) => ({ date: item.date, type: "Retirado para retocar", detail: `${item.name}${item.sellerName ? ` - ${item.sellerName}` : ""}`, impact: `+${item.qty}` })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    document.querySelector("#movementRows").innerHTML = moves.length
      ? moves.map((item) => `<tr><td>${item.date}</td><td>${item.type}</td><td>${item.detail}</td><td>${item.impact}</td><td>${item.action || ""}</td></tr>`).join("")
      : `<tr><td class="empty" colspan="5">Los movimientos van a aparecer aca.</td></tr>`;
  };

  prepareTripClose = function (id) {
    const load = byId("loads", id);
    const select = document.querySelector("#tripCloseLoad");
    if (load && select && !Array.from(select.options).some((option) => option.value === id)) {
      select.insertAdjacentHTML("beforeend", `<option value="${id}">${formatLoadOption(load)}</option>`);
    }
    document.querySelectorAll(".nav-button, .view").forEach((item) => item.classList.remove("active"));
    const tripButton = document.querySelector('[data-view="viajes"]');
    if (tripButton) tripButton.classList.add("active");
    document.querySelector("#viajes").classList.add("active");
    document.querySelector("#viewTitle").textContent = "Viajes";
    document.querySelector("#tripCloseLoad").value = id;
    renderTripClose();
    document.querySelector("#tripCloseForm").scrollIntoView({ behavior: "smooth", block: "start" });
  };

  document.querySelector("#tripCloseForm").addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const load = byId("loads", document.querySelector("#tripCloseLoad").value);
      if (!load) return alert("Selecciona una salida pendiente.");
      if (loadIsClosed(load.id)) return alert("Esta salida ya fue cerrada.");
      const cash = Number(document.querySelector("#tripCash").value || 0);
      const transfer = Number(document.querySelector("#tripTransfer").value || 0);
      const lines = tripCloseLines(load);
      const date = document.querySelector("#tripCloseDate").value;
      lines.forEach((line) => {
        if (line.sold > 0) state.transactions.push({ id: uid(), date, loadId: load.id, furnitureId: line.furnitureId, type: "venta", qty: line.sold, payment: cash && transfer ? "mixto" : cash ? "efectivo" : transfer ? "transferencia" : "-", amount: 0 });
        if (line.returned > 0) {
          const transaction = { id: uid(), date, loadId: load.id, furnitureId: line.furnitureId, type: "devolucion", qty: line.returned, payment: "-", amount: 0 };
          stockDeltaFromTransaction(transaction);
          state.transactions.push(transaction);
        }
      });
      pendingOrders(load).forEach((line) => {
        state.transactions.push({ id: uid(), date, loadId: load.id, furnitureId: line.furnitureId, type: "venta", qty: line.qty, payment: cash && transfer ? "mixto" : cash ? "efectivo" : transfer ? "transferencia" : "-", amount: 0, note: "Pedido" });
      });
      currentTripRetired.forEach((line) => state.retiredStock.push({ id: uid(), date, loadId: load.id, driverId: load.driverId, furnitureId: line.furnitureId, name: line.name, sellerId: line.sellerId, sellerName: line.sellerName, qty: line.qty }));
      state.payments.push({ id: uid(), date, driverId: load.driverId, loadId: load.id, cash, transfer, note: "Cierre de viaje" });
      state.loads = state.loads.map((entry) => (entry.id === load.id ? { ...entry, closedAt: date } : entry));
      resetForm("#tripCloseForm");
      document.querySelector("#tripCloseDate").value = today();
      document.querySelector("#tripCash").value = 0;
      document.querySelector("#tripTransfer").value = 0;
      currentTripRetired = [];
      renderTripRetiredLines();
      render();
    },
    true
  );

  document.querySelector("#dispatchForm").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!currentDispatchLines.length) return alert("Agrega al menos un mueble para despachar.");
      const toBranch = validBranch(document.querySelector("#dispatchTo").value);
      if (toBranch === currentBranch) return alert("Selecciona una localidad de destino distinta al origen.");
      if (!confirm(`Enviar ${document.querySelector("#dispatchTotal").textContent} de ${branches[currentBranch]} a ${branches[toBranch]}?`)) return;
      setSyncStatus("Guardando despacho...");
      try {
        await apiRequest("/api/dispatch", {
          method: "POST",
          body: JSON.stringify({
            from: currentBranch,
            to: toBranch,
            date: document.querySelector("#dispatchDate").value,
            note: document.querySelector("#dispatchNote").value.trim(),
            lines: currentDispatchLines,
          }),
        });
        currentDispatchLines = [];
        resetForm("#dispatchForm");
        document.querySelector("#dispatchDate").value = today();
        await loadServerState();
        render();
      } catch (error) {
        alert(error.message || "No se pudo guardar el despacho.");
        setSyncStatus("Error al guardar despacho.");
        console.error(error);
      }
    },
    true
  );

  syncBranchControls();
  ensureDispatchDestinationSelect();
  render();
})();
