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
  let managedOrderItems = [];
  let editingManagedOrderId = null;

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

  const PRINT_SETTINGS_KEY = "ns-gourmet-print-settings-v1";
  const defaultPrintSettings = {
    layout: "receipt", fontSize: 10, margin: 2, storeName: "NS Gourmet",
    showPhone: true, showAddress: true, showNotes: true, showPayment: true, showPrices: true,
  };
  let printSettings = { ...defaultPrintSettings };

  function loadPrintSettings() {
    try { printSettings = { ...defaultPrintSettings, ...JSON.parse(localStorage.getItem(PRINT_SETTINGS_KEY) || "{}") }; }
    catch { printSettings = { ...defaultPrintSettings }; }
  }
  function savePrintSettings() {
    printSettings = {
      layout: $("print-layout").value === "label" ? "label" : "receipt",
      fontSize: Math.min(12, Math.max(9, Number($("print-font-size").value) || 10)),
      margin: Math.min(4, Math.max(1, Number($("print-margin").value) || 2)),
      storeName: $("print-store-name").value.trim().slice(0, 60) || "NS Gourmet",
      showPhone: $("print-show-phone").checked, showAddress: $("print-show-address").checked,
      showNotes: $("print-show-notes").checked, showPayment: $("print-show-payment").checked,
      showPrices: $("print-show-prices").checked,
    };
    localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(printSettings));
    toast("Configuração de impressão salva neste navegador.");
  }
  function renderPrintSettings() {
    if (!$("print-layout")) return;
    $("print-layout").value = printSettings.layout;
    $("print-font-size").value = String(printSettings.fontSize);
    $("print-margin").value = String(printSettings.margin);
    $("print-store-name").value = printSettings.storeName;
    $("print-show-phone").checked = printSettings.showPhone;
    $("print-show-address").checked = printSettings.showAddress;
    $("print-show-notes").checked = printSettings.showNotes;
    $("print-show-payment").checked = printSettings.showPayment;
    $("print-show-prices").checked = printSettings.showPrices;
  }
  function ensurePrintSettings() {
    if ($("print-settings-card")) return;
    const card = document.createElement("section");
    card.className = "hours-card print-settings-card";
    card.id = "print-settings-card";
    card.innerHTML = `
      <div class="panel-heading"><div><span class="panel-kicker">IMPRESSÃO</span><h2>Impressora térmica / etiquetadora</h2></div><span class="store-mode-status">58 mm</span></div>
      <p>Configure o formato do comprovante. Essas preferências ficam salvas neste navegador e podem ser diferentes em cada computador.</p>
      <div class="print-settings-grid">
        <label class="form-field"><span>Modelo de impressão</span><select id="print-layout"><option value="receipt">Cupom térmico detalhado</option><option value="label">Etiqueta compacta</option></select></label>
        <label class="form-field"><span>Tamanho da fonte</span><select id="print-font-size"><option value="9">Pequena (9 pt)</option><option value="10">Padrão (10 pt)</option><option value="11">Média (11 pt)</option><option value="12">Grande (12 pt)</option></select></label>
        <label class="form-field"><span>Margem (mm)</span><select id="print-margin"><option value="1">1 mm</option><option value="2">2 mm</option><option value="3">3 mm</option><option value="4">4 mm</option></select></label>
        <label class="form-field"><span>Nome no cabeçalho</span><input id="print-store-name" maxlength="60" value="NS Gourmet"></label>
      </div>
      <div class="print-options">
        <label><input id="print-show-phone" type="checkbox"> Incluir telefone do cliente</label>
        <label><input id="print-show-address" type="checkbox"> Incluir endereço / bairro</label>
        <label><input id="print-show-notes" type="checkbox"> Incluir observações</label>
        <label><input id="print-show-payment" type="checkbox"> Incluir forma de pagamento</label>
        <label><input id="print-show-prices" type="checkbox"> Exibir valores dos itens</label>
      </div>
      <div class="print-settings-actions"><button id="save-print-settings" class="primary-button" type="button">Salvar impressão</button><button id="test-print" class="quiet-button" type="button">Imprimir teste</button></div>
      <p class="print-help">Ao imprimir, escolha sua impressora e configure papel personalizado de 58 mm nas preferências do driver. O navegador abrirá a janela de impressão; a impressão silenciosa depende de software/driver local.</p>`;
    const style = document.createElement("style");
    style.textContent = `.print-settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0}.print-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin:12px 0}.print-options label{display:flex;align-items:center;gap:8px;color:#62574f;font-size:13px}.print-settings-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.print-help{font-size:12px;color:#887b71;line-height:1.5;margin-top:14px}.print-order-button{margin-top:8px;padding:7px 11px;border:1px solid #ded4ca;border-radius:7px;background:#fff;color:#59483d;cursor:pointer;font:inherit;font-size:12px}.print-order-button:hover{background:#f7f1eb}@media(max-width:640px){.print-settings-actions button{flex:1}}`;
    document.head.appendChild(style);
    const settings = $("settings-section");
    const hours = settings?.querySelector(".hours-card");
    if (settings) settings.insertBefore(card, hours?.nextSibling || null);
  }
  function printOrder(order) {
    const settings = printSettings;
    const popup = window.open("", "_blank", "width=420,height=720");
    if (!popup) { toast("O navegador bloqueou a janela. Permita pop-ups para este site e tente novamente."); return; }
    const labelMode = settings.layout === "label";
    const itemRows = (order.items || []).map(item => {
      const quantity = Number(item.quantity || 0);
      const price = Number(item.unitPriceCents || 0) * quantity;
      return `<div class="item"><div class="item-name">${esc(quantity + "x " + item.name)}</div>${settings.showPrices && !labelMode ? `<strong>${brl(price)}</strong>` : ""}</div>`;
    }).join("");
    const payment = ({ pix: "Pix", cash: "Dinheiro", debit: "Débito", credit: "Crédito" })[order.paymentMethod] || order.paymentMethod || "Não informado";
    const address = [order.address, order.neighborhood].filter(Boolean).join(" · ");
    const details = [
      settings.showPhone && order.phone ? `<div><b>Telefone:</b> ${esc(order.phone)}</div>` : "",
      settings.showAddress && order.fulfillmentType !== "pickup" && address ? `<div><b>Endereço:</b> ${esc(address)}</div>` : "",
      settings.showPayment ? `<div><b>Pagamento:</b> ${esc(payment)}</div>` : "",
      order.courier ? `<div><b>Entregador:</b> ${esc(order.courier)}</div>` : "",
      settings.showNotes && order.notes ? `<div class="notes"><b>Obs.:</b> ${esc(order.notes)}</div>` : "",
    ].join("");
    const totalBlock = !labelMode ? `<div class="totals"><div><span>Subtotal</span><b>${brl(order.subtotalCents)}</b></div><div><span>Entrega</span><b>${brl(order.deliveryFeeCents)}</b></div><div class="grand"><span>TOTAL</span><b>${brl(order.totalCents)}</b></div></div>` : "";
    const date = order.createdAt ? formatDate(order.createdAt) : formatDate(new Date().toISOString());
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pedido ${esc(order.orderId)}</title>
      <style>@page{size:58mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000}body{width:58mm;padding:${settings.margin}mm;font-family:Arial,Helvetica,sans-serif;font-size:${settings.fontSize}pt;line-height:1.3}.paper{width:100%;overflow-wrap:anywhere}header{text-align:center;border-bottom:1px dashed #000;padding-bottom:7px;margin-bottom:7px}header h1{font-size:1.35em;margin:0 0 3px;font-weight:800}header p{margin:2px 0;font-size:.9em}.order-no{font-size:1.15em;font-weight:800;text-align:center;margin:7px 0}.meta{font-size:.9em;margin:4px 0}.section{border-top:1px dashed #000;margin-top:8px;padding-top:7px}.section-title{font-weight:800;text-transform:uppercase;margin-bottom:5px}.item{display:flex;justify-content:space-between;gap:5px;margin:5px 0}.item-name{flex:1;min-width:0}.totals{border-top:1px dashed #000;margin-top:8px;padding-top:7px}.totals div{display:flex;justify-content:space-between;gap:5px;margin:3px 0}.grand{font-size:1.2em;font-weight:900;border-top:1px solid #000;padding-top:5px;margin-top:6px!important}.notes{border:1px solid #000;padding:5px;margin-top:6px}footer{text-align:center;border-top:1px dashed #000;margin-top:10px;padding-top:7px;font-size:.85em}.label .order-no{font-size:1.4em}.label .section{margin-top:5px;padding-top:5px}</style></head><body><main class="paper ${labelMode ? "label" : ""}">
      <header><h1>${esc(settings.storeName)}</h1><p>${labelMode ? "IDENTIFICAÇÃO DO PEDIDO" : "COMPROVANTE DO PEDIDO"}</p></header>
      <div class="order-no">PEDIDO #${esc(String(order.orderId).slice(-8).toUpperCase())}</div>
      <div class="meta"><b>Cliente:</b> ${esc(order.customerName || "Cliente")}</div><div class="meta"><b>Data:</b> ${esc(date)}</div><div class="meta"><b>Tipo:</b> ${order.fulfillmentType === "pickup" ? "Retirada" : "Entrega"}</div>
      ${details ? `<div class="section">${details}</div>` : ""}<div class="section"><div class="section-title">Itens do pedido</div>${itemRows || "<div>Sem itens</div>"}</div>
      ${totalBlock}${!labelMode ? "<footer>Obrigada pela preferência! ♡</footer>" : ""}
      </main><script>window.addEventListener("load",()=>{setTimeout(()=>{window.focus();window.print();},250)});<\/script></body></html>`);
    popup.document.close();
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
    renderManagedOrders();
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
        <div class="order-total"><strong>${brl(order.totalCents)}</strong><small>${esc((order.paymentMethod || "Pagamento").replace("pix", "Pix").replace("cash", "Dinheiro").replace("debit", "Débito").replace("credit", "Crédito"))}</small><button type="button" class="print-order-button" data-print-order="${esc(order.orderId)}">Imprimir pedido</button></div>
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
      <div class="product-row header"><span>Produto</span><span>Categoria</span><span>Preço</span><span>Estoque</span><span>Situação</span><span>Ações</span></div>
      ${products.length ? products.map(product => `
        <div class="product-row">
          <div class="product-info"><strong>${esc(product.name)}</strong><small>${esc(product.description || "Sem descrição")}</small></div>
          <span>${esc(product.category)}</span>
          <strong class="product-price">${brl(product.unitPriceCents)}</strong>
          <span class="product-stock">${product.stockQuantity === null || typeof product.stockQuantity === "undefined" ? "Ilimitado" : product.stockQuantity > 0 ? `${product.stockQuantity} un.` : "Esgotado"}</span>
          <button class="availability ${product.available && (product.stockQuantity === null || product.stockQuantity > 0) ? "available" : "unavailable"}" type="button" data-toggle-product="${esc(product.id)}">${product.available && (product.stockQuantity === null || product.stockQuantity > 0) ? "Disponível" : "Esgotado"}</button>
          <div class="product-actions"><button type="button" data-edit-product="${esc(product.id)}">Editar</button><button type="button" data-delete-product="${esc(product.id)}">Excluir</button></div>
        </div>`).join("") : '<div class="empty-state">Nenhum produto encontrado.</div>'}`;
  }

  function renderManagedOrders() {
    const query = ($("managed-order-search")?.value || "").toLowerCase().trim();
    const status = $("managed-order-status")?.value || "todos";
    const orders = (overview.orders || []).filter(order =>
      (status === "todos" || order.status === status) &&
      (!query || [order.customerName, order.phone, order.address, order.neighborhood, order.orderId, orderItems(order)].join(" ").toLowerCase().includes(query))
    );
    $("managed-order-list").innerHTML = orders.length ? orders.map(order => `
      <article class="managed-order-card">
        <div class="managed-order-main">
          <div class="managed-order-heading"><div><strong>${esc(order.customerName)}</strong><small>Pedido #${esc(order.orderId)} · ${formatDate(order.createdAt)}</small></div><span class="status-pill ${esc(order.status)}">${esc(statusLabels[order.status] || "Novo")}</span></div>
          <div class="managed-order-meta"><span><b>Telefone:</b> ${esc(order.phone || "Não informado")}</span><span><b>Recebimento:</b> ${order.fulfillmentType === "pickup" ? "Retirada" : "Entrega"}</span><span><b>Pagamento:</b> ${esc(({pix:"Pix",cash:"Dinheiro",debit:"Débito",credit:"Crédito"})[order.paymentMethod] || order.paymentMethod || "Não informado")}</span></div>
          <p class="managed-order-address">${esc([order.address, order.neighborhood].filter(Boolean).join(" · ") || "Sem endereço cadastrado")}</p>
          <p class="managed-order-products">${esc(orderItems(order) || "Sem itens")}</p>
        </div>
        <div class="managed-order-side"><strong>${brl(order.totalCents)}</strong><button class="primary-button" type="button" data-edit-managed-order="${esc(order.orderId)}">Editar pedido</button></div>
      </article>`).join("") : '<div class="empty-state">Nenhum pedido corresponde à pesquisa.</div>';
  }

  function renderManagedOrderItems() {
    const products = overview.products || [];
    $("managed-order-items").innerHTML = managedOrderItems.length ? managedOrderItems.map((item,index) => {
      const known = products.some(product => product.id === item.productId);
      const options = products.map(product => `<option value="${esc(product.id)}" ${product.id === item.productId ? "selected" : ""}>${esc(product.name)} · ${brl(product.unitPriceCents)}</option>`).join("");
      const legacy = !known && item.productId ? `<option value="${esc(item.productId)}" selected>${esc(item.name)} · preço histórico</option>` : "";
      return `<div class="managed-item-row" data-managed-item-index="${index}">
        <label class="form-field"><span>Produto</span><select data-managed-product>${legacy}${options}</select></label>
        <label class="form-field"><span>Quantidade</span><input data-managed-quantity type="number" min="1" max="99" step="1" value="${Math.max(1,Number(item.quantity)||1)}"></label>
        <strong class="managed-item-price">${brl((Number(item.unitPriceCents)||0)*(Number(item.quantity)||0))}</strong>
        <button type="button" class="managed-remove-item" data-remove-managed-item="${index}" aria-label="Remover produto">Remover</button>
      </div>`;
    }).join("") : '<div class="empty-state">Adicione pelo menos um produto ao pedido.</div>';
    updateManagedOrderTotals();
  }

  function updateManagedOrderTotals() {
    const subtotal = managedOrderItems.reduce((sum,item) => sum + (Number(item.unitPriceCents)||0) * (Number(item.quantity)||0),0);
    const fee = Math.max(0,Math.round(Number($("managed-delivery-fee").value||0)*100));
    $("managed-subtotal").textContent = brl(subtotal);
    $("managed-fee-preview").textContent = brl(fee);
    $("managed-total").textContent = brl(subtotal + fee);
    document.querySelectorAll(".managed-item-row").forEach((row,index) => {
      const item=managedOrderItems[index]; const price=row.querySelector(".managed-item-price");
      if(price&&item) price.textContent=brl((Number(item.unitPriceCents)||0)*(Number(item.quantity)||0));
    });
  }

  function openManagedOrderEditor(order) {
    if (!order) return;
    editingManagedOrderId = String(order.orderId);
    $("managed-customer-name").value = order.customerName || "";
    $("managed-customer-phone").value = order.phone || "";
    $("managed-fulfillment").value = order.fulfillmentType || "delivery";
    $("managed-payment").value = order.paymentMethod || "pix";
    $("managed-status").value = order.status || "novo";
    $("managed-courier").value = order.courier || "";
    $("managed-address").value = order.address || "";
    $("managed-neighborhood").value = order.neighborhood || "";
    $("managed-delivery-fee").value = (Number(order.deliveryFeeCents)||0)/100;
    $("managed-notes").value = order.notes || "";
    managedOrderItems = (order.items || []).map(item => ({productId:item.productId,name:item.name,quantity:item.quantity,unitPriceCents:item.unitPriceCents}));
    renderManagedOrderItems();
    $("managed-order-modal").hidden = false;
  }

  function closeManagedOrderEditor() {
    $("managed-order-modal").hidden = true;
    editingManagedOrderId = null;
    managedOrderItems = [];
  }

  async function saveManagedOrder(event) {
    event.preventDefault();
    if (!editingManagedOrderId || !$("managed-order-form").reportValidity()) return;
    if (!managedOrderItems.length || managedOrderItems.some(item => !item.productId || !Number.isInteger(Number(item.quantity)) || Number(item.quantity)<1 || Number(item.quantity)>99)) {
      toast("Confira os produtos e as quantidades do pedido."); return;
    }
    const button=$("save-managed-order"); button.disabled=true; button.textContent="Salvando...";
    const payload={
      customerName:$("managed-customer-name").value.trim(), phone:$("managed-customer-phone").value.trim(),
      fulfillmentType:$("managed-fulfillment").value, paymentMethod:$("managed-payment").value,
      status:$("managed-status").value, courier:$("managed-courier").value.trim(),
      address:$("managed-address").value.trim(), neighborhood:$("managed-neighborhood").value.trim(),
      deliveryFeeCents:Math.round(Number($("managed-delivery-fee").value||0)*100),
      notes:$("managed-notes").value.trim(),
      items:managedOrderItems.map(item=>({productId:item.productId,quantity:Number(item.quantity)}))
    };
    try {
      await api("/api/admin/orders/"+encodeURIComponent(editingManagedOrderId),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      closeManagedOrderEditor(); await refresh(); toast("Pedido atualizado com sucesso.");
    } catch(error) { toast(error.message); }
    finally { button.disabled=false; button.textContent="Salvar alterações"; }
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
    const titles = { dashboard: "Visão geral", orders: "Pedidos", "manage-orders": "Gerenciar pedidos", deliveries: "Entregadores", products: "Produtos", finance: "Financeiro", settings: "Configurações" };
    $("section-title").textContent = titles[section];
    $("admin-sidebar").classList.remove("open");
    if (section === "manage-orders") renderManagedOrders();
  }

  function openProductModal(product = null) {
    $("product-modal").hidden = false;
    $("product-modal-title").textContent = product ? "Editar produto" : "Novo produto";
    $("product-id").value = product?.id || "";
    $("product-name").value = product?.name || "";
    $("product-category").value = product?.category || "";
    $("product-price").value = product ? (product.unitPriceCents / 100).toFixed(2) : "";
    $("product-description").value = product?.description || "";
    $("product-stock").value = product?.stockQuantity ?? "";
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

  $("managed-order-search").addEventListener("input", renderManagedOrders);
  $("managed-order-status").addEventListener("change", renderManagedOrders);
  $("managed-order-list").addEventListener("click", event => {
    const button=event.target.closest("[data-edit-managed-order]");
    if(button) openManagedOrderEditor((overview.orders||[]).find(order=>String(order.orderId)===button.dataset.editManagedOrder));
  });
  $("managed-order-items").addEventListener("change", event => {
    const row=event.target.closest("[data-managed-item-index]"); if(!row)return;
    const index=Number(row.dataset.managedItemIndex); const item=managedOrderItems[index]; if(!item)return;
    if(event.target.matches("[data-managed-product]")) {
      const product=(overview.products||[]).find(value=>value.id===event.target.value);
      if(product) managedOrderItems[index]={...item,productId:product.id,name:product.name,unitPriceCents:product.unitPriceCents};
    }
    if(event.target.matches("[data-managed-quantity]")) item.quantity=Math.min(99,Math.max(1,Number(event.target.value)||1));
    renderManagedOrderItems();
  });
  $("managed-order-items").addEventListener("click", event => {
    const remove=event.target.closest("[data-remove-managed-item]");
    if(remove){managedOrderItems.splice(Number(remove.dataset.removeManagedItem),1);renderManagedOrderItems();}
  });
  $("managed-add-item").addEventListener("click", () => {
    const product=(overview.products||[]).find(item=>item.available);
    if(!product){toast("Não há produtos disponíveis no catálogo.");return;}
    managedOrderItems.push({productId:product.id,name:product.name,quantity:1,unitPriceCents:product.unitPriceCents});
    renderManagedOrderItems();
  });
  $("managed-delivery-fee").addEventListener("input",updateManagedOrderTotals);
  $("managed-fulfillment").addEventListener("change", () => {
    if($("managed-fulfillment").value==="pickup") $("managed-delivery-fee").value="0";
    updateManagedOrderTotals();
  });
  $("managed-order-form").addEventListener("submit",saveManagedOrder);
  $("close-managed-order").addEventListener("click",closeManagedOrderEditor);
  $("cancel-managed-order").addEventListener("click",closeManagedOrderEditor);
  $("managed-order-modal").addEventListener("click",event=>{if(event.target===$("managed-order-modal"))closeManagedOrderEditor();});

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
    const printButton = event.target.closest("[data-print-order]");
    if (printButton) {
      const order = (overview.orders || []).find(item => String(item.orderId) === printButton.dataset.printOrder);
      if (order) printOrder(order);
      return;
    }
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
      stockQuantity: $("product-stock").value === "" ? null : Number($("product-stock").value),
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
  loadPrintSettings();
  ensurePrintSettings();
  renderPrintSettings();
  $("save-print-settings").addEventListener("click", savePrintSettings);
  $("test-print").addEventListener("click", () => printOrder({ orderId: "TESTE-58MM", customerName: "Cliente de teste", phone: "(79) 99999-9999", address: "Rua Exemplo, 123", neighborhood: "Centro", fulfillmentType: "delivery", paymentMethod: "pix", notes: "Teste de impressão da NS Gourmet.", items: [{ name: "Produto de teste", quantity: 2, unitPriceCents: 1500 }], subtotalCents: 3000, deliveryFeeCents: 500, totalCents: 3500, createdAt: new Date().toISOString() }));

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

(() => {
  const $ = id => document.getElementById(id);
  if (!$("save-whatsapp-config")) return;
  const api = async (url, options = {}) => {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível salvar a configuração.");
    return data;
  };
  const toast = message => {
    const element = $("admin-toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    setTimeout(() => element.classList.remove("show"), 2600);
  };
  let slides = [];
  const esc = value => String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function renderSlides() {
    const list = $("hero-slides-list");
    if (!list) return;
    list.innerHTML = slides.length ? slides.map((slide, index) =>
      '<div class="hero-slide-admin"><img src="' + esc(slide.url || slide.imageDataUrl || "") + '" alt=""><span>Slide ' + (index + 1) + '</span><div class="hero-slide-admin-actions">' +
      '<button type="button" data-slide-up="' + index + '"' + (index === 0 ? " disabled" : "") + '>↑</button>' +
      '<button type="button" data-slide-down="' + index + '"' + (index === slides.length - 1 ? " disabled" : "") + '>↓</button>' +
      '<button type="button" data-slide-remove="' + index + '">Remover</button></div></div>'
    ).join("") : '<p class="empty-state">Nenhuma imagem adicionada. O banner principal continuará sendo usado como alternativa.</p>';
  }
  const readFile = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler uma das imagens."));
    reader.readAsDataURL(file);
  });
  async function loadConfig() {
    try {
      const config = await api("/api/admin/store-config");
      $("whatsapp-number").value = config.whatsapp || "";
      $("whatsapp-contact-name").value = config.whatsappContactName || "NS Gourmet";
      $("whatsapp-enabled").checked = config.whatsappEnabled !== false;
      $("whatsapp-template").value = config.whatsappMessageTemplate || "";
      slides = Array.isArray(config.heroSlides) ? config.heroSlides.map(slide => ({url:slide.url,alt:slide.alt || "Destaque da loja"})) : [];
      $("hero-slide-interval").value = String(config.heroSlideIntervalSeconds || 3);
      $("hero-slides-enabled").checked = config.heroSlidesEnabled !== false;
      renderSlides();
    } catch (error) { toast(error.message); }
  }
  $("hero-slides-input").addEventListener("change", async event => {
    const files = [...(event.target.files || [])];
    if (slides.length + files.length > 6) { toast("O carrossel aceita no máximo 6 imagens."); event.target.value = ""; return; }
    if (files.some(file => !["image/png","image/jpeg","image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024)) {
      toast("Cada imagem deve ser JPG, PNG ou WebP e ter até 2 MB."); event.target.value = ""; return;
    }
    try {
      const data = await Promise.all(files.map(readFile));
      data.forEach((imageDataUrl, index) => slides.push({imageDataUrl,alt:files[index].name.replace(/\.[^.]+$/,"").slice(0,120) || "Destaque da loja"}));
      renderSlides();
    } catch (error) { toast(error.message); }
    event.target.value = "";
  });
  $("hero-slides-list").addEventListener("click", event => {
    const remove = event.target.closest("[data-slide-remove]");
    const up = event.target.closest("[data-slide-up]");
    const down = event.target.closest("[data-slide-down]");
    if (remove) slides.splice(Number(remove.dataset.slideRemove),1);
    else if (up) { const i=Number(up.dataset.slideUp); if(i>0) [slides[i-1],slides[i]]=[slides[i],slides[i-1]]; }
    else if (down) { const i=Number(down.dataset.slideDown); if(i<slides.length-1) [slides[i+1],slides[i]]=[slides[i],slides[i+1]]; }
    else return;
    renderSlides();
  });
  $("save-hero-slides").addEventListener("click", async () => {
    const button=$("save-hero-slides"); button.disabled=true; button.textContent="Enviando imagens...";
    try {
      await api("/api/admin/store-config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        heroSlides:slides,heroSlidesEnabled:$("hero-slides-enabled").checked,heroSlideIntervalSeconds:Number($("hero-slide-interval").value || 3)
      })});
      await loadConfig(); toast("Carrossel salvo e imagens enviadas ao armazenamento.");
    } catch(error){toast(error.message);}
    finally{button.disabled=false;button.textContent="Salvar carrossel";}
  });
  $("save-whatsapp-config").addEventListener("click", async () => {
    const button=$("save-whatsapp-config"); button.disabled=true; button.textContent="Salvando...";
    try {
      await api("/api/admin/store-config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        whatsapp:$("whatsapp-number").value,whatsappContactName:$("whatsapp-contact-name").value,
        whatsappEnabled:$("whatsapp-enabled").checked,whatsappMessageTemplate:$("whatsapp-template").value
      })});
      toast("Configuração de WhatsApp salva.");
    } catch(error){toast(error.message);}
    finally{button.disabled=false;button.textContent="Salvar WhatsApp";}
  });
  loadConfig();
})();