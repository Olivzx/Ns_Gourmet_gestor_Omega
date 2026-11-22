(() => {
  const $ = id => document.getElementById(id);
  const brl = cents => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((Number(cents) || 0) / 100);
  const esc = value => String(value || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const statusLabels = { novo: "Novo", preparando: "Preparando", pronto: "Pronto", saiu_entrega: "Em entrega", entregue: "Entregue", cancelado: "Cancelado" };
  let overview = { totals: {}, orders: [], products: [], paymentTotals: {} };
  let orderFilter = "todos";
  let heroImageDataUrl = "";
  let pollingTimer = null;
  let deliveryRates = [];

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Não foi possível concluir a operação.");
      error.statusCode = response.status;
      throw error;
    }
    return data;
  }

  function toast(message) {
    $("admin-toast").textContent = message;
    $("admin-toast").classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $("admin-toast").classList.remove("show"), 2600);
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function mapsUrl(order) {
    const address = [order.address, order.neighborhood, "Aracaju", "SE"].filter(Boolean).join(", ");
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
  }

  function orderItems(order) {
    return (order.items || []).map(item => `${item.quantity}× ${item.name}`).join(", ");
  }

  function statusSelect(order) {
    return `<select data-order-status="${esc(order.orderId)}" aria-label="Status do pedido ${esc(order.orderId)}">${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${order.status === value ? "selected" : ""}>${label}</option>`).join("")}</select>`;
  }

  function render() {
    const totals = overview.totals || {};
    $("metric-gross").textContent = brl(totals.grossCents);
    $("metric-pending").textContent = totals.pending || 0;
    $("metric-delivered").textContent = totals.delivered || 0;
    $("metric-delivered-value").textContent = `${brl(totals.deliveredCents)} recebido`;
    $("metric-products").textContent = totals.availableProducts || 0;
    $("metric-products-total").textContent = `${totals.products || 0} no catálogo`;
    $("pending-badge").textContent = totals.pending || 0;

    const activeCount = totals.orders || 0;
    $("finance-average").textContent = brl(activeCount ? totals.grossCents / activeCount : 0);

    const periods = overview.financePeriods || {};
    $("finance-daily").textContent = brl(periods.dailyCents);
    $("finance-weekly").textContent = brl(periods.weeklyCents);
    $("finance-monthly").textContent = brl(periods.monthlyCents);
    $("finance-month-label").textContent = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date());
    renderTopProducts();

    renderPayments();
    renderRecentOrders();
    renderOrders();
    renderDeliveries();
    renderProducts();
    renderFinanceStatus();
  }

  function renderPayments() {
    const payments = overview.paymentTotals || {};
    const labels = { pix: "Pix", cash: "Dinheiro", debit: "Débito", credit: "Crédito", outros: "Outros" };
    const max = Math.max(...Object.values(payments), 1);
    const html = Object.entries(payments).length
      ? Object.entries(payments).map(([key, cents]) => `<div class="payment-row"><span>${esc(labels[key] || key)}</span><div class="payment-bar"><i style="width:${Math.max(5, cents / max * 100)}%"></i></div><strong>${brl(cents)}</strong></div>`).join("")
      : '<div class="empty-state">Nenhuma movimentação registrada.</div>';
    $("payment-breakdown").innerHTML = html;
    $("finance-payment").innerHTML = html;
  }

  function renderTopProducts() {
    const products = overview.topProducts || [];
    const max = Math.max(...products.map(product => product.quantity), 1);
    $("top-products").innerHTML = products.length ? products.map(product => `
      <div class="top-product-row">
        <span>${esc(product.name)}</span>
        <div class="top-product-bar"><i style="width:${Math.max(5, product.quantity / max * 100)}%"></i></div>
        <b>${product.quantity}</b>
      </div>`).join("") : '<div class="empty-state">Nenhuma venda registrada.</div>';
  }

  function renderRecentOrders() {
    const orders = (overview.orders || []).slice(0, 6);
    $("recent-orders").innerHTML = orders.length ? orders.map(order => `
      <div class="recent-order">
        <div><strong>${esc(order.customerName)}</strong><small>${formatDate(order.createdAt)} · ${esc(order.orderId)}</small></div>
        <span class="status-pill ${esc(order.status)}">${esc(statusLabels[order.status] || "Novo")}</span>
        <small>${esc(order.fulfillmentType === "pickup" ? "Retirada" : "Entrega")}</small>
        <strong>${brl(order.totalCents)}</strong>
      </div>`).join("") : '<div class="empty-state">Nenhum pedido registrado.</div>';
  }

  function renderOrders() {
    const query = ($("order-search")?.value || "").toLowerCase().trim();
    const orders = (overview.orders || []).filter(order =>
      (orderFilter === "todos" || order.status === orderFilter) &&
      (!query || [order.customerName, order.orderId, order.neighborhood, order.address].join(" ").toLowerCase().includes(query))
    );
    $("orders-list").innerHTML = orders.length ? orders.map(order => `
      <article class="order-card">
        <div class="order-client"><strong>${esc(order.customerName)}</strong><small>${esc(order.phone || "Sem telefone")} · ${formatDate(order.createdAt)}</small><span class="status-pill ${esc(order.status)}">${esc(statusLabels[order.status] || "Novo")}</span></div>
        <div class="order-address"><strong>${esc(order.fulfillmentType === "pickup" ? "Retirada na loja" : "Entrega")}</strong><small>${esc(order.address || "Sem endereço")}${order.neighborhood ? " · " + esc(order.neighborhood) : ""}</small><div class="order-items">${esc(orderItems(order))}</div>${order.fulfillmentType !== "pickup" && order.address ? `<a class="map-link" href="${mapsUrl(order)}" target="_blank" rel="noopener noreferrer">Abrir no Google Maps ↗</a>` : ""}</div>
        <div class="order-actions">${statusSelect(order)}<input data-courier="${esc(order.orderId)}" value="${esc(order.courier || "")}" placeholder="Nome do entregador" aria-label="Entregador"></div>
        <div class="order-total"><strong>${brl(order.totalCents)}</strong><small>${esc((order.paymentMethod || "Pagamento").replace("pix", "Pix").replace("cash", "Dinheiro").replace("debit", "Débito").replace("credit", "Crédito"))}</small></div>
      </article>`).join("") : '<div class="empty-state">Nenhum pedido encontrado.</div>';
  }

  function renderDeliveries() {
    const deliveries = (overview.orders || []).filter(order =>
      order.fulfillmentType === "delivery" &&
      !["cancelado", "entregue"].includes(order.status)
    );
    $("delivery-list").innerHTML = deliveries.length ? deliveries.map(order => `
      <article class="delivery-card">
        <header><div><h3>${esc(order.customerName)}</h3><span class="status-pill ${esc(order.status)}">${esc(statusLabels[order.status] || "Novo")}</span></div><strong>${brl(order.totalCents)}</strong></header>
        <p>${esc(order.address || "Endereço não informado")}<br>${esc(order.neighborhood || "")}</p>
        <label class="courier-field"><span>Entregador responsável</span><input data-courier-card="${esc(order.orderId)}" value="${esc(order.courier || "")}" placeholder="Nome do entregador"></label>
        <div class="delivery-actions"><a href="${mapsUrl(order)}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a><button type="button" data-confirm-delivery="${esc(order.orderId)}">Confirmar entrega</button></div>
      </article>`).join("") : '<div class="empty-state">Nenhuma entrega pendente.</div>';
  }

  function renderFinanceStatus() {
    const counts = {};
    (overview.orders || []).forEach(order => {
      const status = order.status || "novo";
      counts[status] = (counts[status] || 0) + 1;
    });
    $("finance-status").innerHTML = Object.entries(statusLabels).map(([status, label]) => `
      <div class="status-breakdown-row"><span>${esc(label)}</span><strong>${counts[status] || 0}</strong></div>`).join("");
  }

  function renderProducts() {
    const query = ($("product-search")?.value || "").toLowerCase();
    const category = $("product-category-filter")?.value || "";
    const categories = [...new Set((overview.products || []).map(product => product.category).filter(Boolean))].sort();
    const currentCategory = category;
    $("product-category-filter").innerHTML = '<option value="">Todas as categorias</option>' + categories.map(value => `<option value="${esc(value)}" ${value === currentCategory ? "selected" : ""}>${esc(value)}</option>`).join("");
    $("category-options").innerHTML = categories.map(value => `<option value="${esc(value)}"></option>`).join("");
    const products = (overview.products || []).filter(product =>
      (!query || [product.name, product.category, product.description].join(" ").toLowerCase().includes(query)) &&
      (!category || product.category === category)
    );
    $("products-list").innerHTML = `
      <div class="product-row header"><span>Produto</span><span>Categoria</span><span>Preço</span><span>Situação</span><span>Ações</span></div>
      ${products.length ? products.map(product => `
        <div class="product-row">
          <div class="product-info"><strong>${esc(product.name)}</strong><small>${esc(product.description || "Sem descrição")}</small></div>
          <span>${esc(product.category)}</span>
          <strong class="product-price">${brl(product.unitPriceCents)}</strong>
          <button class="availability ${product.available ? "available" : "unavailable"}" type="button" data-toggle-product="${esc(product.id)}">${product.available ? "Disponível" : "Indisponível"}</button>
          <div class="product-actions"><button type="button" data-edit-product="${esc(product.id)}">Editar</button><button type="button" data-delete-product="${esc(product.id)}">Excluir</button></div>
        </div>`).join("") : '<div class="empty-state">Nenhum produto encontrado.</div>'}`;
  }

  async function refresh({ silent = true } = {}) {
    try {
      overview = await api("/api/admin/overview");
      render();
      const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
      $("sync-status").innerHTML = `<i></i> Atualizado às ${time}`;
      $("sidebar-updated").textContent = `Atualizado às ${time}`;
    } catch (error) {
      if (error.statusCode === 401 || /autenticação/i.test(error.message)) location.reload();
      if (!silent) toast(error.message);
      $("sync-status").innerHTML = "<i style=\"background:#b66d62\"></i> Falha na atualização";
    }
  }

  function openSection(section) {
    document.querySelectorAll(".admin-section").forEach(element => element.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(element => element.classList.toggle("active", element.dataset.section === section));
    $(section + "-section").classList.add("active");
    const titles = { dashboard: "Visão geral", orders: "Pedidos", deliveries: "Entregadores", products: "Produtos", finance: "Financeiro", settings: "Configurações" };
    $("section-title").textContent = titles[section];
    $("admin-sidebar").classList.remove("open");
  }

  function openProductModal(product = null) {
    $("product-modal").hidden = false;
    $("product-modal-title").textContent = product ? "Editar produto" : "Novo produto";
    $("product-id").value = product?.id || "";
    $("product-name").value = product?.name || "";
    $("product-category").value = product?.category || "";
    $("product-price").value = product ? (product.unitPriceCents / 100).toFixed(2) : "";
    $("product-description").value = product?.description || "";
    $("product-available").checked = product ? product.available : true;
    $("product-image").value = "";
  }

  function closeProductModal() {
    $("product-modal").hidden = true;
  }

  document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => openSection(button.dataset.section)));
  document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => openSection(button.dataset.go)));
  $("mobile-menu").addEventListener("click", () => $("admin-sidebar").classList.add("open"));
  $("sidebar-close").addEventListener("click", () => $("admin-sidebar").classList.remove("open"));

  $("order-filters").addEventListener("click", event => {
    const button = event.target.closest("[data-status]");
    if (!button) return;
    orderFilter = button.dataset.status;
    document.querySelectorAll("#order-filters button").forEach(item => item.classList.toggle("active", item === button));
    renderOrders();
  });
  $("order-search").addEventListener("input", renderOrders);
  $("product-search").addEventListener("input", renderProducts);
  $("product-category-filter").addEventListener("change", renderProducts);

  document.addEventListener("change", async event => {
    const statusSelect = event.target.closest("[data-order-status]");
    if (statusSelect) {
      try {
        await api("/api/admin/orders/" + encodeURIComponent(statusSelect.dataset.orderStatus), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: statusSelect.value }) });
        toast("Status do pedido atualizado.");
        await refresh();
      } catch (error) { toast(error.message); }
    }
  });

  document.addEventListener("change", async event => {
    const courierInput = event.target.closest("[data-courier]");
    if (!courierInput) return;
    try {
      await api("/api/admin/orders/" + encodeURIComponent(courierInput.dataset.courier), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courier: courierInput.value }) });
      toast("Entregador atribuído.");
      await refresh();
    } catch (error) { toast(error.message); }
  });

  document.addEventListener("change", async event => {
    const courierCard = event.target.closest("[data-courier-card]");
    if (!courierCard) return;
    try {
      await api("/api/admin/orders/" + encodeURIComponent(courierCard.dataset.courierCard), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courier: courierCard.value }) });
    } catch (error) { toast(error.message); }
  });

  document.addEventListener("click", async event => {
    const confirmation = event.target.closest("[data-confirm-delivery]");
    if (confirmation) {
      try {
        await api("/api/admin/orders/" + encodeURIComponent(confirmation.dataset.confirmDelivery), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "entregue" }) });
        toast("Entrega confirmada.");
        await refresh();
      } catch (error) { toast(error.message); }
    }

    const toggle = event.target.closest("[data-toggle-product]");
    if (toggle) {
      const product = overview.products.find(item => item.id === toggle.dataset.toggleProduct);
      if (!product) return;
      try {
        await api("/api/admin/products/" + encodeURIComponent(product.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ available: !product.available }) });
        toast(product.available ? "Produto marcado como indisponível." : "Produto disponibilizado.");
        await refresh();
      } catch (error) { toast(error.message); }
    }

    const edit = event.target.closest("[data-edit-product]");
    if (edit) openProductModal(overview.products.find(item => item.id === edit.dataset.editProduct));

    const remove = event.target.closest("[data-delete-product]");
    if (remove) {
      const product = overview.products.find(item => item.id === remove.dataset.deleteProduct);
      if (!product || !window.confirm(`Excluir o produto "${product.name}"?`)) return;
      try {
        await api("/api/admin/products/" + encodeURIComponent(product.id), { method: "DELETE" });
        toast("Produto excluído.");
        await refresh();
      } catch (error) { toast(error.message); }
    }
  });

  $("new-product").addEventListener("click", () => openProductModal());
  $("close-product-modal").addEventListener("click", closeProductModal);
  $("cancel-product").addEventListener("click", closeProductModal);
  $("product-modal").addEventListener("click", event => { if (event.target === $("product-modal")) closeProductModal(); });

  $("product-form").addEventListener("submit", async event => {
    event.preventDefault();
    const id = $("product-id").value;
    const payload = {
      name: $("product-name").value,
      category: $("product-category").value,
      priceReais: Number($("product-price").value),
      description: $("product-description").value,
      available: $("product-available").checked,
    };
    const file = $("product-image").files[0];
    const save = async imageDataUrl => {
      if (typeof imageDataUrl === "string") payload.imageDataUrl = imageDataUrl;
      try {
        if (id) {
          await api("/api/admin/products/" + encodeURIComponent(id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          toast("Produto atualizado.");
        } else {
          await api("/api/admin/products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          toast("Produto criado.");
        }
        closeProductModal();
        await refresh();
      } catch (error) {
        toast(error.message);
      }
    };
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast("A imagem do produto deve ter até 2 MB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => save(reader.result);
      reader.readAsDataURL(file);
    } else {
      await save();
    }
  });

  function setPreview(value) {
    heroImageDataUrl = value;
    $("hero-preview-image").hidden = !value;
    $("preview-empty").hidden = Boolean(value);
    if (value) $("hero-preview-image").src = value;
  }

  function renderHours(schedule) {
    const labels = { mon: "Segunda-feira", tue: "Terça-feira", wed: "Quarta-feira", thu: "Quinta-feira", fri: "Sexta-feira", sat: "Sábado", sun: "Domingo" };
    $("hours-grid").innerHTML = Object.entries(labels).map(([key, label]) => {
      const value = schedule[key] || { closed: key === "sun", open: "09:00", close: "18:00" };
      return `<div class="hour-row" data-hour-day="${key}">
        <strong>${label}</strong>
        <label><input type="checkbox" data-hour-closed ${value.closed ? "checked" : ""}> Fechado</label>
        <input type="time" data-hour-open value="${esc(value.open || "09:00")}" ${value.closed ? "disabled" : ""}>
        <input type="time" data-hour-close value="${esc(value.close || "18:00")}" ${value.closed ? "disabled" : ""}>
      </div>`;
    }).join("");
  }

  document.addEventListener("change", event => {
    const closed = event.target.closest("[data-hour-closed]");
    if (!closed) return;
    const row = closed.closest("[data-hour-day]");
    row.querySelector("[data-hour-open]").disabled = closed.checked;
    row.querySelector("[data-hour-close]").disabled = closed.checked;
  });

  function renderDeliveryRates() {
    $("delivery-rates-list").innerHTML = deliveryRates.length ? deliveryRates.map(rate => `
      <div class="delivery-rate-row" data-rate-name="${esc(rate.neighborhood)}">
        <input data-rate-neighborhood value="${esc(rate.neighborhood)}" aria-label="Nome do bairro">
        <input data-rate-price type="number" min="0" step="0.01" value="${(Number(rate.feeCents || 0) / 100).toFixed(2)}" aria-label="Valor do frete">
        <div class="delivery-rate-actions"><button type="button" data-save-rate="${esc(rate.neighborhood)}">Salvar</button><button type="button" data-delete-rate="${esc(rate.neighborhood)}">Excluir</button></div>
      </div>`).join("") : '<div class="empty-state">Nenhum bairro cadastrado.</div>';
  }

  async function loadDeliveryRates() {
    try {
      const data = await api("/api/admin/delivery-rates");
      deliveryRates = data.rates || [];
      renderDeliveryRates();
    } catch (error) {
      toast(error.message);
    }
  }

  async function loadConfig() {
    try {
      const config = await api("/api/admin/store-config");
      setPreview(config.heroImageDataUrl || "");
      renderHours(config.businessHours || {});
      $("origin-address").value = config.originAddress || "";
      renderStoreMode(config.manualOpenOverride);
      $("fallback-cents").value = ((Number(config.deliveryFallbackCents ?? 200)) / 100).toFixed(2);
      $("fallback-km").value = config.deliveryFallbackKm ?? 3;
    } catch (error) {
      toast(error.message);
    }
  }

  $("hero-image-input").addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast("Escolha uma imagem com até 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(file);
  });
  $("remove-image").addEventListener("click", () => {
    $("hero-image-input").value = "";
    setPreview("");
  });
  $("save-image").addEventListener("click", async () => {
    const button = $("save-image");
    button.disabled = true;
    button.textContent = "Salvando...";
    try {
      await api("/api/admin/store-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heroImageDataUrl }),
      });
      toast("Imagem atualizada no cardápio.");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Salvar alteração";
    }
  });

  $("save-hours").addEventListener("click", async () => {
    const businessHours = {};
    document.querySelectorAll("[data-hour-day]").forEach(row => {
      const key = row.dataset.hourDay;
      businessHours[key] = {
        closed: row.querySelector("[data-hour-closed]").checked,
        open: row.querySelector("[data-hour-open]").value,
        close: row.querySelector("[data-hour-close]").value,
      };
    });
    const button = $("save-hours");
    button.disabled = true;
    const previousLabel = button.textContent;
    button.textContent = "Salvando...";
    try {
      const result = await api("/api/admin/store-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessHours }),
      });
      if (!result.config?.businessHours) throw new Error("O servidor não confirmou os horários gravados.");
      await loadConfig();
      toast("Horários salvos e conferidos no banco.");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  });

  function ensureAcceptanceControl() {
    if ($("store-mode-controls")) return;
    // Remove the legacy checkbox section when the browser still has the previous cached HTML.
    const legacyToggle = $("accepting-orders-toggle");
    legacyToggle?.closest(".hours-card")?.remove();
    const section = document.createElement("section");
    section.className = "hours-card order-acceptance-card";
    section.innerHTML = '<div class="panel-heading"><div><span class="panel-kicker">STATUS DA LOJA</span><h2>Controle de funcionamento</h2></div><span id="store-mode-status" class="store-mode-status">Carregando...</span></div><p>Escolha se a loja segue a programação ou se ficará aberta/fechada manualmente. A abertura manual libera pedidos mesmo fora do expediente.</p><div id="store-mode-controls" class="store-mode-controls"><button class="quiet-button" type="button" data-store-mode="auto">Automático</button><button class="primary-button" type="button" data-store-mode="open">Abrir loja agora</button><button class="quiet-button" type="button" data-store-mode="closed">Fechar loja agora</button></div>';
    const settings = $("settings-section");
    const hoursCard = settings?.querySelector(".hours-card");
    if (settings && hoursCard) settings.insertBefore(section, hoursCard);
  }
  function renderStoreMode(mode) {
    const status = $("store-mode-status");
    if (!status) return;
    status.textContent = mode === true ? "Aberta manualmente" : mode === false ? "Fechada manualmente" : "Automático";
    const activeMode = mode === true ? "open" : mode === false ? "closed" : "auto";
    document.querySelectorAll("[data-store-mode]").forEach(button => button.classList.toggle("active", button.dataset.storeMode === activeMode));
  }
  ensureAcceptanceControl();

  $("store-mode-controls").addEventListener("click", async event => {
    const button = event.target.closest("[data-store-mode]");
    if (!button) return;
    const mode = button.dataset.storeMode;
    const manualOpenOverride = mode === "auto" ? null : mode === "open";
    const controls = $("store-mode-controls");
    controls.querySelectorAll("button").forEach(item => item.disabled = true);
    try {
      const result = await api("/api/admin/store-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualOpenOverride }),
      });
      if (result.config?.manualOpenOverride !== manualOpenOverride) throw new Error("O servidor não confirmou o modo de funcionamento.");
      await loadConfig();
      toast(mode === "open" ? "Loja aberta manualmente. Pedidos liberados agora." : mode === "closed" ? "Loja fechada manualmente." : "Funcionamento automático restaurado.");
    } catch (error) {
      toast(error.message);
    } finally {
      controls.querySelectorAll("button").forEach(item => item.disabled = false);
    }
  });

  $("logout-button").addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" });
    location.reload();
  });

  $("save-delivery-config").addEventListener("click", async () => {
    try {
      await api("/api/admin/store-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originAddress: $("origin-address").value,
          deliveryFallbackCents: Math.round(Number($("fallback-cents").value || 0) * 100),
          deliveryFallbackKm: Number($("fallback-km").value || 3),
        }),
      });
      toast("Configuração de entrega atualizada.");
    } catch (error) {
      toast(error.message);
    }
  });

  $("delivery-rate-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await api("/api/admin/delivery-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          neighborhood: $("delivery-rate-neighborhood").value,
          feeReais: Number($("delivery-rate-price").value),
        }),
      });
      $("delivery-rate-neighborhood").value = "";
      $("delivery-rate-price").value = "";
      await loadDeliveryRates();
      toast("Bairro cadastrado.");
    } catch (error) {
      toast(error.message);
    }
  });

  document.addEventListener("click", async event => {
    const save = event.target.closest("[data-save-rate]");
    if (save) {
      const row = save.closest("[data-rate-name]");
      try {
        await api("/api/admin/delivery-rates/" + encodeURIComponent(save.dataset.saveRate), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            neighborhood: row.querySelector("[data-rate-neighborhood]").value,
            feeReais: Number(row.querySelector("[data-rate-price]").value),
          }),
        });
        await loadDeliveryRates();
        toast("Bairro atualizado.");
      } catch (error) {
        toast(error.message);
      }
    }

    const remove = event.target.closest("[data-delete-rate]");
    if (remove) {
      if (!window.confirm(`Excluir o frete do bairro "${remove.dataset.deleteRate}"?`)) return;
      try {
        await api("/api/admin/delivery-rates/" + encodeURIComponent(remove.dataset.deleteRate), { method: "DELETE" });
        await loadDeliveryRates();
        toast("Bairro removido.");
      } catch (error) {
        toast(error.message);
      }
    }
  });

  loadConfig();
  loadDeliveryRates();
  refresh({ silent: false });
  pollingTimer = setInterval(() => refresh(), 5000);
})();
