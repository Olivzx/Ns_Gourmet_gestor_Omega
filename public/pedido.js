(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const form = $("#public-order-form");
  const menuGrid = $("#menu-grid");
  const menuStatus = $("#menu-status");
  const fulfillment = $("#fulfillment-type");
  const addressInput = $("#customer-address");
  const neighborhoodSelect = $("#customer-neighborhood");
  const submitButton = $("#submit-order");
  const confirmation = $("#order-confirmation");
  const mobileCartTrigger = $("#mobile-cart-trigger");
  const mobileCartOverlay = $("#mobile-cart-overlay");
  const mobileCartItems = $("#mobile-cart-items");
  const mobileCartClose = $("#mobile-cart-close");
  const campaignOrigin = new URLSearchParams(window.location.search).get("origem") || "";
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  let products = [];
  let rates = [];
  let businessHours = null;
  let pixSettings = { key: "", receiverName: "", city: "" };
  let activeCategory = "Todas";
  let searchTerm = "";
  let storeIsOpen = true;
  let isSubmitting = false;
  let cart = new Map();
  let activeRequestId = makeId();
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }
  function normalise(value) {
    return String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();
  }
  function money(cents) { return currency.format((Number(cents) || 0) / 100); }
  function pixField(id, value) {
    const text = String(value ?? "");
    return id + String(text.length).padStart(2, "0") + text;
  }
  function pixCrc16(value) {
    let crc = 0xFFFF;
    for (let i = 0; i < value.length; i++) {
      crc ^= value.charCodeAt(i) << 8;
      for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }
  function pixText(value, maxLength) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toUpperCase().replace(/[^A-Z0-9 .-]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }
  function buildPixPayload(orderId, totalCents) {
    const key = String(pixSettings.key || "").trim();
    const name = pixText(pixSettings.receiverName, 25);
    const city = pixText(pixSettings.city, 15);
    if (!key || !name || !city || !Number.isSafeInteger(Number(totalCents)) || Number(totalCents) <= 0) return "";
    const txid = String(orderId || "").replace(/[^a-zA-Z0-9]/g, "").slice(-25) || "***";
    const merchant = pixField("00", "br.gov.bcb.pix") + pixField("01", key);
    const additional = pixField("05", txid);
    const amount = (Number(totalCents) / 100).toFixed(2);
    const payload = pixField("00", "01") + pixField("01", "11") + pixField("26", merchant) +
      pixField("52", "0000") + pixField("53", "986") + pixField("54", amount) +
      pixField("58", "BR") + pixField("59", name) + pixField("60", city) +
      pixField("62", additional) + "6304";
    return payload + pixCrc16(payload);
  }
  function renderPixPayment(orderId, totalCents) {
    const panel = $("#pix-payment");
    if (!panel) return;
    if ($("#payment-method").value !== "pix") { panel.hidden = true; panel.innerHTML = ""; return; }
    const key = String(pixSettings.key || "").trim();
    const name = String(pixSettings.receiverName || "").trim();
    const city = String(pixSettings.city || "").trim();
    if (!key || !name || !city) {
      panel.hidden = false;
      panel.innerHTML = '<h4>Pagamento via Pix</h4><p>A chave Pix ainda não foi configurada pela loja. Seu pedido foi registrado; fale com a NS Gourmet pelo WhatsApp para receber os dados de pagamento.</p>';
      return;
    }
    const payload = buildPixPayload(orderId, totalCents);
    if (!payload) {
      panel.hidden = false;
      panel.innerHTML = '<h4>Pagamento via Pix</h4><p>Não foi possível montar o QR Code. Entre em contato com a loja para receber a chave Pix.</p>';
      return;
    }
    panel.hidden = false;
    panel.innerHTML = '<h4>Finalize seu pagamento via Pix</h4><p class="pix-payment-total">Valor do pedido: <strong>' + money(totalCents) + '</strong></p>' +
      '<img id="pix-qr-code" class="pix-qr-code" alt="QR Code Pix para pagamento de ' + money(totalCents) + '">' +
      '<p class="pix-beneficiary">Recebedor: <strong>' + escapeHtml(name) + '</strong></p>' +
      '<div class="pix-key-line"><span>Chave Pix</span><strong>' + escapeHtml(key) + '</strong><button type="button" data-copy-pix-key>Copiar chave</button></div>' +
      '<label class="pix-copy-label" for="pix-copy-paste">Pix Copia e Cola</label><textarea id="pix-copy-paste" readonly rows="4">' + escapeHtml(payload) + '</textarea>' +
      '<button type="button" class="order-submit pix-copy-button" data-copy-pix>Copiar código Pix</button>' +
      '<p class="pix-manual-note">Após pagar, aguarde a confirmação manual da loja. O envio do pedido ou a exibição deste QR Code não confirma o pagamento.</p>';
    const qrImage = $("#pix-qr-code");
    if (window.QRCode && typeof window.QRCode.toDataURL === "function") {
      window.QRCode.toDataURL(payload, { width: 240, margin: 2, errorCorrectionLevel: "M" }, (error, dataUrl) => {
        if (!error && qrImage) qrImage.src = dataUrl;
        else if (qrImage) { qrImage.hidden = true; }
      });
    } else if (qrImage) {
      qrImage.hidden = true;
      const note = panel.querySelector(".pix-manual-note");
      if (note) note.textContent = "O QR Code não carregou neste navegador. Use o Pix Copia e Cola abaixo.";
    }
  }
  async function copyPixText(value, button) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const field = document.createElement("textarea");
        field.value = value; field.style.position = "fixed"; field.style.opacity = "0";
        document.body.appendChild(field); field.select();
        const copied = document.execCommand("copy"); field.remove();
        if (!copied) throw new Error("A cópia automática não está disponível neste navegador.");
      }
      const original = button.textContent; button.textContent = "Copiado!";
      window.setTimeout(() => { button.textContent = original; }, 1800);
    } catch (_) {
      notify("Não foi possível copiar automaticamente. Selecione e copie o conteúdo manualmente.", "error");
    }
  }

  function notify(text, type) {
    menuStatus.textContent = text || "";
    menuStatus.className = "order-status" + (type ? " " + type : "");
  }
  async function api(url, options) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...(options || {}),
      headers: { ...((options && options.body) ? { "Content-Type": "application/json" } : {}), ...((options && options.headers) || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Não foi possível concluir a operação.");
      error.status = response.status; error.code = data.code;
      throw error;
    }
    return data;
  }

  const BUSINESS_DAY_LABELS = [
    { key: "mon", label: "Segunda" }, { key: "tue", label: "Terça" },
    { key: "wed", label: "Quarta" }, { key: "thu", label: "Quinta" },
    { key: "fri", label: "Sexta" }, { key: "sat", label: "Sábado" },
    { key: "sun", label: "Domingo" }
  ];
  function renderBusinessHours(value) {
    businessHours = value && typeof value === "object" ? value : { enabled: false, isOpen: true, days: {} };
    storeIsOpen = businessHours.isOpen !== false;
    const panel = $("#business-hours-panel");
    const status = $("#business-hours-status");
    const detail = $("#business-hours-detail");
    const badge = $("#business-hours-badge");
    const list = $("#business-hours-list");
    panel.hidden = false;
    if (businessHours.enabled !== true) {
      status.textContent = storeIsOpen ? "Horários ainda não cadastrados" : "A loja não está aceitando pedidos agora";
      detail.textContent = storeIsOpen ? "A loja ainda não informou os horários. Os pedidos online continuam disponíveis." : "O envio de novos pedidos está bloqueado no momento.";
      badge.textContent = storeIsOpen ? "Disponível online" : "Fechada";
      badge.className = "business-hours-public-badge " + (storeIsOpen ? "is-open" : "is-closed");
      list.innerHTML = '<p class="business-hours-no-schedule">A programação de atendimento será exibida aqui quando a loja configurá-la.</p>';
      return;
    }
    status.textContent = storeIsOpen ? "A loja está aberta agora" : "A loja está fechada neste momento";
    detail.textContent = storeIsOpen
      ? "Você pode concluir seu pedido enquanto a loja estiver dentro deste horário."
      : "O envio de novos pedidos está bloqueado até o próximo período de atendimento.";
    badge.textContent = storeIsOpen ? "Aberta" : "Fechada";
    badge.className = "business-hours-public-badge " + (storeIsOpen ? "is-open" : "is-closed");
    list.innerHTML = BUSINESS_DAY_LABELS.map((day) => {
      const item = businessHours.days && businessHours.days[day.key] ? businessHours.days[day.key] : {};
      const hoursText = item.enabled ? escapeHtml(item.open || "") + " às " + escapeHtml(item.close || "") : "Fechado";
      return '<div class="business-hours-public-day"><span>' + day.label + '</span><strong>' + hoursText + '</strong></div>';
    }).join("");
  }

  function productQuantity(id) { return cart.get(id) || 0; }
  $("#menu-search").addEventListener("input", (event) => {
    searchTerm = event.target.value.trim();
    renderMenu();
  });
  $("#menu-categories").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    activeCategory = button.dataset.category;
    renderCategoryFilters();
    renderMenu();
  });
  menuGrid.addEventListener("click", (event) => {
    if (!event.target.closest(".clear-menu-filters")) return;
    activeCategory = "Todas"; searchTerm = ""; $("#menu-search").value = "";
    renderCategoryFilters(); renderMenu();
  });
  function renderCategoryFilters() {
    const categories = ["Todas", ...new Set(products.filter((product) => product && product.available !== false)
      .map((product) => String(product.category || "Cardápio").trim()).filter(Boolean))];
    if (!categories.includes(activeCategory)) activeCategory = "Todas";
    const wrapper = $("#menu-categories");
    wrapper.innerHTML = categories.map((category) =>
      '<button type="button" class="category-chip' + (category === activeCategory ? " is-active" : "") +
      '" data-category="' + escapeHtml(category) + '" aria-pressed="' + (category === activeCategory ? "true" : "false") + '">' +
      escapeHtml(category) + '</button>').join("");
  }
  function renderMenu() {
    const available = products.filter((product) => product && product.available !== false);
    const visible = available.filter((product) => {
      const matchesCategory = activeCategory === "Todas" || String(product.category || "Cardápio").trim() === activeCategory;
      const haystack = normalise([product.name, product.category, product.kind === "combo" ? "combo" : ""].join(" "));
      return matchesCategory && (!searchTerm || haystack.includes(normalise(searchTerm)));
    });
    $("#menu-count").textContent = visible.length + (visible.length === 1 ? " produto" : " produtos");
    if (!visible.length) {
      menuGrid.innerHTML = "";
      const hasFilters = searchTerm || activeCategory !== "Todas";
      menuGrid.innerHTML = '<div class="menu-empty-state"><span>♡</span><strong>' +
        (hasFilters ? "Não encontramos esse sabor." : "Nosso cardápio está sendo preparado.") +
        '</strong><p>' + (hasFilters ? "Tente outro termo ou escolha uma categoria diferente." : "Volte em instantes ou fale com a loja.") + '</p>' +
        (hasFilters ? '<button type="button" class="clear-menu-filters">Limpar filtros</button>' : '') + '</div>';
      if (!hasFilters) notify("O cardápio está sem produtos disponíveis no momento. Fale com a loja pelo WhatsApp.", "error");
      return;
    }
    menuGrid.innerHTML = visible.map((product) => {
      const photo = product.imageDataUrl
        ? '<img src="' + escapeHtml(product.imageDataUrl) + '" alt="' + escapeHtml(product.name) + '" loading="lazy" decoding="async">'
        : '<span class="menu-photo-placeholder" aria-hidden="true">NS</span>';
      const quantity = productQuantity(product.id);
      const controls = quantity
        ? '<button class="quantity-btn" type="button" data-cart-action="minus" data-id="' + escapeHtml(product.id) + '" aria-label="Remover uma unidade">−</button><span class="quantity-value">' + quantity + '</span><button class="quantity-btn" type="button" data-cart-action="plus" data-id="' + escapeHtml(product.id) + '" aria-label="Adicionar uma unidade">+</button>'
        : '<button class="quantity-add" type="button" data-cart-action="plus" data-id="' + escapeHtml(product.id) + '"' + (storeIsOpen ? "" : " disabled") + '>Adicionar +</button>';
      return '<article class="menu-product"><div class="menu-photo">' + photo +
        (product.kind === "combo" ? '<span class="product-type-tag">Combo</span>' : '') +
        '<span class="product-photo-shine" aria-hidden="true"></span></div><div class="menu-product-copy"><span class="menu-category">' +
        escapeHtml(product.category || "Cardápio") + '</span><h3>' + escapeHtml(product.name) + '</h3><span class="menu-price">' +
        money(product.unitPriceCents) + '</span></div><div class="menu-product-controls">' + controls + '</div></article>';
    }).join("");
    menuGrid.querySelectorAll("img").forEach((image) => {
      image.addEventListener("error", () => {
        const wrapper = image.closest(".menu-photo");
        image.remove();
        if (!wrapper || wrapper.querySelector(".menu-photo-placeholder")) return;
        const placeholder = document.createElement("span");
        placeholder.className = "menu-photo-placeholder";
        placeholder.setAttribute("aria-hidden", "true");
        placeholder.textContent = "NS";
        wrapper.append(placeholder);
      }, { once: true });
    });
  }
  function selectedRate() {
    if (fulfillment.value !== "delivery") return { feeCents: 0 };
    return rates.find((rate) => normalise(rate.neighborhood) === normalise(neighborhoodSelect.value)) || null;
  }
  function updateDeliveryFields() {
    const isDelivery = fulfillment.value === "delivery";
    $("#delivery-fields").hidden = !isDelivery;
    addressInput.required = isDelivery;
    neighborhoodSelect.required = isDelivery;
    updateTotals();
  }
  function renderCart() {
    const chosen = products.filter((product) => productQuantity(product.id) > 0);
    const totalQuantity = chosen.reduce((sum, product) => sum + productQuantity(product.id), 0);
    if (!chosen.length) {
      $("#cart-items").innerHTML = '<p class="cart-empty">Adicione produtos do cardápio.</p>';
      mobileCartItems.innerHTML = '<p class="cart-empty">Sua cestinha está vazia. Adicione um produto do cardápio.</p>';
    } else {
      $("#cart-items").innerHTML = chosen.map((product) => {
        const quantity = productQuantity(product.id);
        return '<div class="cart-line"><span class="cart-line-name">' + quantity + ' × ' + escapeHtml(product.name) +
          '<small>' + money(product.unitPriceCents) + ' cada</small></span><strong class="cart-line-price">' +
          money(product.unitPriceCents * quantity) + '</strong></div>';
      }).join("");
      mobileCartItems.innerHTML = chosen.map((product) => {
        const quantity = productQuantity(product.id);
        return '<div class="mobile-cart-line"><div class="mobile-cart-line-copy"><span class="mobile-cart-line-name">' +
          escapeHtml(product.name) + '</span><span class="mobile-cart-line-unit">' + money(product.unitPriceCents) +
          ' por unidade</span><strong class="mobile-cart-line-price">' + money(product.unitPriceCents * quantity) +
          '</strong></div><div class="mobile-cart-line-actions"><button class="quantity-btn" type="button" data-cart-action="minus" data-id="' +
          escapeHtml(product.id) + '" aria-label="Diminuir quantidade de ' + escapeHtml(product.name) +
          '">−</button><span class="quantity-value">' + quantity + '</span><button class="quantity-btn" type="button" data-cart-action="plus" data-id="' +
          escapeHtml(product.id) + '" aria-label="Aumentar quantidade de ' + escapeHtml(product.name) + '"' + (storeIsOpen ? "" : " disabled") + '>+</button></div></div>';
      }).join("");
    }
    $("#cart-item-count").textContent = totalQuantity + " itens";
    const countBadge = $("#mobile-cart-count");
    countBadge.textContent = String(totalQuantity);
    countBadge.hidden = totalQuantity === 0;
    $("#mobile-cart-continue").disabled = totalQuantity === 0;
    mobileCartTrigger.setAttribute("aria-label", totalQuantity > 0
      ? "Abrir carrinho de compras, " + totalQuantity + (totalQuantity === 1 ? " item" : " itens")
      : "Abrir carrinho de compras, cesta vazia");
  }
  function changeCartQuantity(id, action) {
    if (action === "plus" && !storeIsOpen) return;
    const product = products.find((entry) => String(entry.id) === String(id));
    if (!product) return;
    const current = productQuantity(id);
    const next = action === "plus" ? Math.min(current + 1, 99) : Math.max(0, current - 1);
    if (next) cart.set(id, next); else cart.delete(id);
    renderMenu();
    updateTotals();
  }
  function openMobileCart() {
    if (mobileCartOverlay.hidden) {
      mobileCartOverlay.hidden = false;
      document.body.classList.add("cart-open");
      mobileCartClose.focus({ preventScroll: true });
    }
  }
  function closeMobileCart(restoreFocus = true) {
    if (mobileCartOverlay.hidden) return;
    mobileCartOverlay.hidden = true;
    document.body.classList.remove("cart-open");
    if (restoreFocus) mobileCartTrigger.focus({ preventScroll: true });
  }
  mobileCartTrigger.addEventListener("click", openMobileCart);
  mobileCartClose.addEventListener("click", () => closeMobileCart());
  $("#mobile-cart-backdrop").addEventListener("click", () => closeMobileCart());
  $("#mobile-cart-continue").addEventListener("click", () => {
    if (!cart.size) return;
    closeMobileCart(false);
    $(".checkout-panel").scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start"
    });
    $("#customer-name").focus({ preventScroll: true });
  });
  document.addEventListener("keydown", (event) => {
    if (mobileCartOverlay.hidden) return;
    if (event.key === "Escape") {
      closeMobileCart();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(mobileCartOverlay.querySelectorAll(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  function updateTotals() {
    const itemsTotal = products.reduce((sum, product) => sum + product.unitPriceCents * productQuantity(product.id), 0);
    const rate = selectedRate();
    const freight = fulfillment.value === "pickup" ? 0 : rate ? rate.feeCents : null;
    const subtotalLabel = money(itemsTotal);
    const freightLabel = freight === null ? "Selecione o bairro" : money(freight);
    const totalLabel = freight === null ? "—" : money(itemsTotal + freight);
    $("#cart-subtotal").textContent = subtotalLabel;
    $("#cart-freight").textContent = freightLabel;
    $("#cart-total").textContent = totalLabel;
    $("#mobile-cart-subtotal").textContent = subtotalLabel;
    $("#mobile-cart-freight").textContent = freightLabel;
    $("#mobile-cart-total").textContent = totalLabel;
    renderCart();
    submitButton.disabled = isSubmitting || cart.size === 0 || freight === null || products.length === 0 || !storeIsOpen;
  }
  function renderRates() {
    const options = ['<option value="">Selecione seu bairro</option>'].concat(rates.map((rate) =>
      '<option value="' + escapeHtml(rate.neighborhood) + '">' + escapeHtml(rate.neighborhood) + ' — frete ' + money(rate.feeCents) + '</option>'));
    neighborhoodSelect.innerHTML = options.join("");
    if (!rates.length) {
      neighborhoodSelect.innerHTML = '<option value="">Entrega indisponível</option>';
      $("#delivery-help").textContent = "A loja ainda não cadastrou taxas de entrega. Escolha retirada ou fale com a loja.";
    }
  }
  menuGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cart-action]");
    if (!button) return;
    changeCartQuantity(button.dataset.id, button.dataset.cartAction);
  });
  mobileCartItems.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cart-action]");
    if (!button) return;
    changeCartQuantity(button.dataset.id, button.dataset.cartAction);
  });
  fulfillment.addEventListener("change", updateDeliveryFields);
  neighborhoodSelect.addEventListener("change", updateTotals);
  async function loadMenu() {
    try {
      const result = await api("/api/public-order/menu");
      const demoRibbon = $("#demo-ribbon");
      if (demoRibbon) demoRibbon.hidden = result.demo !== true;
      products = Array.isArray(result.products) ? result.products.filter((product) => Number.isSafeInteger(product.unitPriceCents) && product.unitPriceCents >= 0) : [];
      rates = Array.isArray(result.deliveryRates) ? result.deliveryRates : [];
      pixSettings = result.pix && typeof result.pix === "object" ? result.pix : { key: "", receiverName: "", city: "" };
      renderBusinessHours(result.businessHours);
      const storeName = result.storeName || "NS Gourmet";
      document.title = "Cardápio | " + storeName;
      $("#store-brand-name").textContent = storeName;
      $("#footer-store-name").textContent = storeName;
      $("#footer-legal-name").textContent = storeName;
      $("#footer-year").textContent = String(new Date().getFullYear());
      renderRates(); renderCategoryFilters(); renderMenu(); updateDeliveryFields();
      updateTotals();
      if (storeIsOpen) notify("Selecione os produtos e confira o total antes de concluir.", "success");
      else notify("A loja está fechada. Você pode consultar os horários, mas novos pedidos não podem ser enviados agora.", "error");
    } catch (error) {
      products = []; rates = []; renderCategoryFilters(); renderMenu(); renderRates(); updateTotals();
      notify(error.message || "Não foi possível carregar o cardápio. Atualize a página e tente novamente.", "error");
    }
  }
  async function refreshBusinessHours() {
    try {
      const result = await api("/api/public-order/menu");
      renderBusinessHours(result.businessHours);
      renderMenu();
      updateTotals();
    } catch (_) {
      // A validação definitiva continua no servidor ao enviar o pedido.
    }
  }
  window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshBusinessHours();
  }, 60_000);

  confirmation.addEventListener("click", (event) => {
    const payloadButton = event.target.closest("[data-copy-pix]");
    if (payloadButton) { const field = $("#pix-copy-paste"); if (field) void copyPixText(field.value, payloadButton); return; }
    const keyButton = event.target.closest("[data-copy-pix-key]");
    if (keyButton) void copyPixText(String(pixSettings.key || ""), keyButton);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!storeIsOpen) { notify("A loja está fechada neste momento. Confira os horários de atendimento e tente novamente durante o expediente.", "error"); return; }
    if (!form.reportValidity()) return;
    if (!cart.size) { notify("Adicione pelo menos um produto antes de concluir.", "error"); return; }
    if (fulfillment.value === "delivery" && !selectedRate()) { notify("Selecione um bairro com taxa de entrega cadastrada.", "error"); neighborhoodSelect.focus(); return; }
    const orderItems = Array.from(cart.entries()).map(([productId, quantity]) => ({ productId, quantity }));
    let whatsappTab = null;
    try {
      whatsappTab = window.open("about:blank", "_blank");
      if (whatsappTab && !whatsappTab.closed) {
        whatsappTab.document.title = "Preparando seu pedido";
        whatsappTab.document.body.innerHTML = '<p style="font-family:system-ui;padding:28px;color:#70434f">Seu pedido está sendo preparado para o WhatsApp…</p>';
      }
    } catch (_) { whatsappTab = null; }
    isSubmitting = true;
    updateTotals();
    submitButton.textContent = "Registrando pedido…";
    notify("Conferindo preços e registrando seu pedido com a loja…");
    try {
      const result = await api("/api/public-order/orders", {
        method: "POST",
        body: JSON.stringify({
          requestId: activeRequestId,
          customerName: $("#customer-name").value.trim(),
          phone: $("#customer-phone").value.trim(),
          address: addressInput.value.trim(),
          neighborhood: neighborhoodSelect.value,
          fulfillmentType: fulfillment.value,
          paymentMethod: $("#payment-method").value,
          notes: $("#order-notes").value.trim(),
          items: orderItems,
          origin: campaignOrigin
        })
      });
      const whatsappUrl = result.whatsappUrl || "";
      form.hidden = true;
      confirmation.hidden = false;
      $("#confirmation-message").textContent = result.demo
        ? "Pedido registrado somente nesta demonstração local. Nenhuma mensagem foi enviada à loja. Total demonstrativo: " + money(result.totalCents) + "."
        : "Pedido #" + String(result.orderId || "").slice(-8).toUpperCase() + " registrado. Total confirmado: " + money(result.totalCents) + (whatsappUrl ? ". Envie a mensagem no WhatsApp para concluir o contato com a loja." : ". Aguarde o contato da loja.");
      renderPixPayment(result.orderId, result.totalCents);
      $("#confirmation-whatsapp").hidden = !whatsappUrl;
      if (whatsappUrl) $("#confirmation-whatsapp").href = whatsappUrl;
      if (whatsappTab && !whatsappTab.closed && whatsappUrl) {
        whatsappTab.location.replace(whatsappUrl);
      } else if (whatsappTab && !whatsappTab.closed) {
        whatsappTab.close();
      }
      notify("Pedido registrado com sucesso.", "success");
      activeRequestId = makeId();
    } catch (error) {
      if (whatsappTab && !whatsappTab.closed) whatsappTab.close();
      isSubmitting = false;
      if (error.code === "STORE_CLOSED") {
        storeIsOpen = false;
        renderBusinessHours({ ...(businessHours || {}), enabled: true, isOpen: false });
        updateTotals();
      }
      notify(error.message || "Não foi possível registrar o pedido. Tente novamente.", "error");
      updateTotals();
      submitButton.innerHTML = 'Concluir e abrir WhatsApp <span aria-hidden="true">→</span>';
    }
  });
  void loadMenu();
})();