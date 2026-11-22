const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const MAX_ORDER_BYTES = 32 * 1024;
const MAX_ADMIN_BYTES = 3 * 1024 * 1024;
const ADMIN_EMAIL = "ns_gourmet@profissional.com";
const ADMIN_LOGIN_HTML = "<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>Acesso | NS Gourmet</title>\n  <style>\n    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#332921;color:#332921;font:14px \"Segoe UI\",sans-serif}.login-card{width:min(380px,calc(100% - 32px));background:#fff;border-radius:10px;padding:28px}.login-brand{font:700 22px Georgia;margin-bottom:24px}.login-card h1{font:500 28px Georgia;margin:0 0 6px}.login-card p{color:#786b62;font-size:12px;margin:0 0 22px}.login-field{display:grid;gap:6px;margin-bottom:12px;font-size:11px}.login-field input{height:44px;border:1px solid #e5ded6;border-radius:7px;padding:0 11px}.login-button{width:100%;height:44px;border:0;border-radius:7px;background:#825f4d;color:#fff;font-weight:700;margin-top:6px}.login-status{min-height:18px;color:#9a5b52;font-size:11px;margin:10px 0 0}\n  </style>\n</head>\n<body>\n  <main class=\"login-card\">\n    <div class=\"login-brand\">NS Gourmet</div>\n    <h1>Acesso administrativo</h1>\n    <p>Entre com as credenciais configuradas no ambiente seguro.</p>\n    <form id=\"login-form\">\n      <label class=\"login-field\"><span>E-mail</span><input id=\"username\" type=\"email\" autocomplete=\"username\" placeholder=\"ns_gourmet@profissional.com\" required></label>\n      <label class=\"login-field\"><span>Senha</span><input id=\"password\" type=\"password\" autocomplete=\"current-password\" required></label>\n      <button class=\"login-button\" type=\"submit\">Entrar no painel</button>\n      <p class=\"login-status\" id=\"login-status\" role=\"status\"></p>\n    </form>\n  </main>\n  <script src=\"/admin-login.js\" defer></script>\n</body>\n</html>\n";
const ADMIN_LOGIN_JS = "(() => {\n  const form = document.getElementById(\"login-form\");\n  if (!form) return;\n\n  const email = document.getElementById(\"username\");\n  const password = document.getElementById(\"password\");\n  const status = document.getElementById(\"login-status\");\n  const button = form.querySelector('button[type=\"submit\"]');\n\n  form.addEventListener(\"submit\", async event => {\n    event.preventDefault();\n    status.textContent = \"\";\n    button.disabled = true;\n    button.textContent = \"Entrando...\";\n\n    try {\n      const response = await fetch(\"/api/admin/login\", {\n        method: \"POST\",\n        credentials: \"same-origin\",\n        headers: { \"Content-Type\": \"application/json\", \"Accept\": \"application/json\" },\n        body: JSON.stringify({ username: email.value.trim(), password: password.value })\n      });\n      const data = await response.json().catch(() => ({}));\n      if (!response.ok) throw new Error(data.error || \"Não foi possível autenticar.\");\n\n      const sessionResponse = await fetch(\"/api/admin/session\", {\n        method: \"GET\",\n        credentials: \"same-origin\",\n        cache: \"no-store\",\n        headers: { \"Accept\": \"application/json\" }\n      });\n      const session = await sessionResponse.json().catch(() => ({}));\n      if (!sessionResponse.ok || session.authenticated !== true) {\n        throw new Error(\"A senha foi aceita, mas o navegador não confirmou a sessão administrativa. Verifique se os cookies deste site estão permitidos e tente novamente.\");\n      }\n\n      status.textContent = \"Acesso confirmado. Abrindo painel...\";\n      location.replace(\"/admin\");\n    } catch (error) {\n      status.textContent = error instanceof Error ? error.message : \"Falha inesperada ao entrar.\";\n      password.value = \"\";\n      password.focus();\n      button.disabled = false;\n      button.textContent = \"Entrar no painel\";\n    }\n  });\n})();\n";
const ADMIN_APP_JS = "(() => {\n  const $ = id => document.getElementById(id);\n  const brl = cents => new Intl.NumberFormat(\"pt-BR\", { style: \"currency\", currency: \"BRL\" }).format((Number(cents) || 0) / 100);\n  const esc = value => String(value || \"\").replace(/[&<>\"']/g, character => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[character]));\n  const statusLabels = { novo: \"Novo\", preparando: \"Preparando\", pronto: \"Pronto\", saiu_entrega: \"Em entrega\", entregue: \"Entregue\", cancelado: \"Cancelado\" };\n  let overview = { totals: {}, orders: [], products: [], paymentTotals: {} };\n  let orderFilter = \"todos\";\n  let heroImageDataUrl = \"\";\n  let pollingTimer = null;\n  let deliveryRates = [];\n\n  async function api(url, options = {}) {\n    const response = await fetch(url, options);\n    const data = await response.json().catch(() => ({}));\n    if (!response.ok) {\n      const error = new Error(data.error || \"Não foi possível concluir a operação.\");\n      error.statusCode = response.status;\n      throw error;\n    }\n    return data;\n  }\n\n  function toast(message) {\n    $(\"admin-toast\").textContent = message;\n    $(\"admin-toast\").classList.add(\"show\");\n    clearTimeout(toast.timer);\n    toast.timer = setTimeout(() => $(\"admin-toast\").classList.remove(\"show\"), 2600);\n  }\n\n  function formatDate(value) {\n    if (!value) return \"\";\n    const date = new Date(value);\n    return Number.isNaN(date.getTime()) ? \"\" : new Intl.DateTimeFormat(\"pt-BR\", { day: \"2-digit\", month: \"2-digit\", hour: \"2-digit\", minute: \"2-digit\" }).format(date);\n  }\n\n  function mapsUrl(order) {\n    const address = [order.address, order.neighborhood, \"Aracaju\", \"SE\"].filter(Boolean).join(\", \");\n    return \"https://www.google.com/maps/search/?api=1&query=\" + encodeURIComponent(address);\n  }\n\n  function orderItems(order) {\n    return (order.items || []).map(item => `${item.quantity}× ${item.name}`).join(\", \");\n  }\n\n  function statusSelect(order) {\n    return `<select data-order-status=\"${esc(order.orderId)}\" aria-label=\"Status do pedido ${esc(order.orderId)}\">${Object.entries(statusLabels).map(([value, label]) => `<option value=\"${value}\" ${order.status === value ? \"selected\" : \"\"}>${label}</option>`).join(\"\")}</select>`;\n  }\n\n  function render() {\n    const totals = overview.totals || {};\n    $(\"metric-gross\").textContent = brl(totals.grossCents);\n    $(\"metric-pending\").textContent = totals.pending || 0;\n    $(\"metric-delivered\").textContent = totals.delivered || 0;\n    $(\"metric-delivered-value\").textContent = `${brl(totals.deliveredCents)} recebido`;\n    $(\"metric-products\").textContent = totals.availableProducts || 0;\n    $(\"metric-products-total\").textContent = `${totals.products || 0} no catálogo`;\n    $(\"pending-badge\").textContent = totals.pending || 0;\n\n    const activeCount = totals.orders || 0;\n    $(\"finance-average\").textContent = brl(activeCount ? totals.grossCents / activeCount : 0);\n\n    const periods = overview.financePeriods || {};\n    $(\"finance-daily\").textContent = brl(periods.dailyCents);\n    $(\"finance-weekly\").textContent = brl(periods.weeklyCents);\n    $(\"finance-monthly\").textContent = brl(periods.monthlyCents);\n    $(\"finance-month-label\").textContent = new Intl.DateTimeFormat(\"pt-BR\", { month: \"long\" }).format(new Date());\n    renderTopProducts();\n\n    renderPayments();\n    renderRecentOrders();\n    renderOrders();\n    renderDeliveries();\n    renderProducts();\n    renderFinanceStatus();\n  }\n\n  function renderPayments() {\n    const payments = overview.paymentTotals || {};\n    const labels = { pix: \"Pix\", cash: \"Dinheiro\", debit: \"Débito\", credit: \"Crédito\", outros: \"Outros\" };\n    const max = Math.max(...Object.values(payments), 1);\n    const html = Object.entries(payments).length\n      ? Object.entries(payments).map(([key, cents]) => `<div class=\"payment-row\"><span>${esc(labels[key] || key)}</span><div class=\"payment-bar\"><i style=\"width:${Math.max(5, cents / max * 100)}%\"></i></div><strong>${brl(cents)}</strong></div>`).join(\"\")\n      : '<div class=\"empty-state\">Nenhuma movimentação registrada.</div>';\n    $(\"payment-breakdown\").innerHTML = html;\n    $(\"finance-payment\").innerHTML = html;\n  }\n\n  function renderTopProducts() {\n    const products = overview.topProducts || [];\n    const max = Math.max(...products.map(product => product.quantity), 1);\n    $(\"top-products\").innerHTML = products.length ? products.map(product => `\n      <div class=\"top-product-row\">\n        <span>${esc(product.name)}</span>\n        <div class=\"top-product-bar\"><i style=\"width:${Math.max(5, product.quantity / max * 100)}%\"></i></div>\n        <b>${product.quantity}</b>\n      </div>`).join(\"\") : '<div class=\"empty-state\">Nenhuma venda registrada.</div>';\n  }\n\n  function renderRecentOrders() {\n    const orders = (overview.orders || []).slice(0, 6);\n    $(\"recent-orders\").innerHTML = orders.length ? orders.map(order => `\n      <div class=\"recent-order\">\n        <div><strong>${esc(order.customerName)}</strong><small>${formatDate(order.createdAt)} · ${esc(order.orderId)}</small></div>\n        <span class=\"status-pill ${esc(order.status)}\">${esc(statusLabels[order.status] || \"Novo\")}</span>\n        <small>${esc(order.fulfillmentType === \"pickup\" ? \"Retirada\" : \"Entrega\")}</small>\n        <strong>${brl(order.totalCents)}</strong>\n      </div>`).join(\"\") : '<div class=\"empty-state\">Nenhum pedido registrado.</div>';\n  }\n\n  function renderOrders() {\n    const query = ($(\"order-search\")?.value || \"\").toLowerCase().trim();\n    const orders = (overview.orders || []).filter(order =>\n      (orderFilter === \"todos\" || order.status === orderFilter) &&\n      (!query || [order.customerName, order.orderId, order.neighborhood, order.address].join(\" \").toLowerCase().includes(query))\n    );\n    $(\"orders-list\").innerHTML = orders.length ? orders.map(order => `\n      <article class=\"order-card\">\n        <div class=\"order-client\"><strong>${esc(order.customerName)}</strong><small>${esc(order.phone || \"Sem telefone\")} · ${formatDate(order.createdAt)}</small><span class=\"status-pill ${esc(order.status)}\">${esc(statusLabels[order.status] || \"Novo\")}</span></div>\n        <div class=\"order-address\"><strong>${esc(order.fulfillmentType === \"pickup\" ? \"Retirada na loja\" : \"Entrega\")}</strong><small>${esc(order.address || \"Sem endereço\")}${order.neighborhood ? \" · \" + esc(order.neighborhood) : \"\"}</small><div class=\"order-items\">${esc(orderItems(order))}</div>${order.fulfillmentType !== \"pickup\" && order.address ? `<a class=\"map-link\" href=\"${mapsUrl(order)}\" target=\"_blank\" rel=\"noopener noreferrer\">Abrir no Google Maps ↗</a>` : \"\"}</div>\n        <div class=\"order-actions\">${statusSelect(order)}<input data-courier=\"${esc(order.orderId)}\" value=\"${esc(order.courier || \"\")}\" placeholder=\"Nome do entregador\" aria-label=\"Entregador\"></div>\n        <div class=\"order-total\"><strong>${brl(order.totalCents)}</strong><small>${esc((order.paymentMethod || \"Pagamento\").replace(\"pix\", \"Pix\").replace(\"cash\", \"Dinheiro\").replace(\"debit\", \"Débito\").replace(\"credit\", \"Crédito\"))}</small></div>\n      </article>`).join(\"\") : '<div class=\"empty-state\">Nenhum pedido encontrado.</div>';\n  }\n\n  function renderDeliveries() {\n    const deliveries = (overview.orders || []).filter(order =>\n      order.fulfillmentType === \"delivery\" &&\n      ![\"cancelado\", \"entregue\"].includes(order.status)\n    );\n    $(\"delivery-list\").innerHTML = deliveries.length ? deliveries.map(order => `\n      <article class=\"delivery-card\">\n        <header><div><h3>${esc(order.customerName)}</h3><span class=\"status-pill ${esc(order.status)}\">${esc(statusLabels[order.status] || \"Novo\")}</span></div><strong>${brl(order.totalCents)}</strong></header>\n        <p>${esc(order.address || \"Endereço não informado\")}<br>${esc(order.neighborhood || \"\")}</p>\n        <label class=\"courier-field\"><span>Entregador responsável</span><input data-courier-card=\"${esc(order.orderId)}\" value=\"${esc(order.courier || \"\")}\" placeholder=\"Nome do entregador\"></label>\n        <div class=\"delivery-actions\"><a href=\"${mapsUrl(order)}\" target=\"_blank\" rel=\"noopener noreferrer\">Google Maps ↗</a><button type=\"button\" data-confirm-delivery=\"${esc(order.orderId)}\">Confirmar entrega</button></div>\n      </article>`).join(\"\") : '<div class=\"empty-state\">Nenhuma entrega pendente.</div>';\n  }\n\n  function renderFinanceStatus() {\n    const counts = {};\n    (overview.orders || []).forEach(order => {\n      const status = order.status || \"novo\";\n      counts[status] = (counts[status] || 0) + 1;\n    });\n    $(\"finance-status\").innerHTML = Object.entries(statusLabels).map(([status, label]) => `\n      <div class=\"status-breakdown-row\"><span>${esc(label)}</span><strong>${counts[status] || 0}</strong></div>`).join(\"\");\n  }\n\n  function renderProducts() {\n    const query = ($(\"product-search\")?.value || \"\").toLowerCase();\n    const category = $(\"product-category-filter\")?.value || \"\";\n    const categories = [...new Set((overview.products || []).map(product => product.category).filter(Boolean))].sort();\n    const currentCategory = category;\n    $(\"product-category-filter\").innerHTML = '<option value=\"\">Todas as categorias</option>' + categories.map(value => `<option value=\"${esc(value)}\" ${value === currentCategory ? \"selected\" : \"\"}>${esc(value)}</option>`).join(\"\");\n    $(\"category-options\").innerHTML = categories.map(value => `<option value=\"${esc(value)}\"></option>`).join(\"\");\n    const products = (overview.products || []).filter(product =>\n      (!query || [product.name, product.category, product.description].join(\" \").toLowerCase().includes(query)) &&\n      (!category || product.category === category)\n    );\n    $(\"products-list\").innerHTML = `\n      <div class=\"product-row header\"><span>Produto</span><span>Categoria</span><span>Preço</span><span>Situação</span><span>Ações</span></div>\n      ${products.length ? products.map(product => `\n        <div class=\"product-row\">\n          <div class=\"product-info\"><strong>${esc(product.name)}</strong><small>${esc(product.description || \"Sem descrição\")}</small></div>\n          <span>${esc(product.category)}</span>\n          <strong class=\"product-price\">${brl(product.unitPriceCents)}</strong>\n          <button class=\"availability ${product.available ? \"available\" : \"unavailable\"}\" type=\"button\" data-toggle-product=\"${esc(product.id)}\">${product.available ? \"Disponível\" : \"Indisponível\"}</button>\n          <div class=\"product-actions\"><button type=\"button\" data-edit-product=\"${esc(product.id)}\">Editar</button><button type=\"button\" data-delete-product=\"${esc(product.id)}\">Excluir</button></div>\n        </div>`).join(\"\") : '<div class=\"empty-state\">Nenhum produto encontrado.</div>'}`;\n  }\n\n  async function refresh({ silent = true } = {}) {\n    try {\n      overview = await api(\"/api/admin/overview\");\n      render();\n      const time = new Intl.DateTimeFormat(\"pt-BR\", { hour: \"2-digit\", minute: \"2-digit\", second: \"2-digit\" }).format(new Date());\n      $(\"sync-status\").innerHTML = `<i></i> Atualizado às ${time}`;\n      $(\"sidebar-updated\").textContent = `Atualizado às ${time}`;\n    } catch (error) {\n      if (error.statusCode === 401 || /autenticação/i.test(error.message)) location.reload();\n      if (!silent) toast(error.message);\n      $(\"sync-status\").innerHTML = \"<i style=\\\"background:#b66d62\\\"></i> Falha na atualização\";\n    }\n  }\n\n  function openSection(section) {\n    document.querySelectorAll(\".admin-section\").forEach(element => element.classList.remove(\"active\"));\n    document.querySelectorAll(\".nav-item\").forEach(element => element.classList.toggle(\"active\", element.dataset.section === section));\n    $(section + \"-section\").classList.add(\"active\");\n    const titles = { dashboard: \"Visão geral\", orders: \"Pedidos\", deliveries: \"Entregadores\", products: \"Produtos\", finance: \"Financeiro\", settings: \"Configurações\" };\n    $(\"section-title\").textContent = titles[section];\n    $(\"admin-sidebar\").classList.remove(\"open\");\n  }\n\n  function openProductModal(product = null) {\n    $(\"product-modal\").hidden = false;\n    $(\"product-modal-title\").textContent = product ? \"Editar produto\" : \"Novo produto\";\n    $(\"product-id\").value = product?.id || \"\";\n    $(\"product-name\").value = product?.name || \"\";\n    $(\"product-category\").value = product?.category || \"\";\n    $(\"product-price\").value = product ? (product.unitPriceCents / 100).toFixed(2) : \"\";\n    $(\"product-description\").value = product?.description || \"\";\n    $(\"product-available\").checked = product ? product.available : true;\n    $(\"product-image\").value = \"\";\n  }\n\n  function closeProductModal() {\n    $(\"product-modal\").hidden = true;\n  }\n\n  document.querySelectorAll(\".nav-item\").forEach(button => button.addEventListener(\"click\", () => openSection(button.dataset.section)));\n  document.querySelectorAll(\"[data-go]\").forEach(button => button.addEventListener(\"click\", () => openSection(button.dataset.go)));\n  $(\"mobile-menu\").addEventListener(\"click\", () => $(\"admin-sidebar\").classList.add(\"open\"));\n  $(\"sidebar-close\").addEventListener(\"click\", () => $(\"admin-sidebar\").classList.remove(\"open\"));\n\n  $(\"order-filters\").addEventListener(\"click\", event => {\n    const button = event.target.closest(\"[data-status]\");\n    if (!button) return;\n    orderFilter = button.dataset.status;\n    document.querySelectorAll(\"#order-filters button\").forEach(item => item.classList.toggle(\"active\", item === button));\n    renderOrders();\n  });\n  $(\"order-search\").addEventListener(\"input\", renderOrders);\n  $(\"product-search\").addEventListener(\"input\", renderProducts);\n  $(\"product-category-filter\").addEventListener(\"change\", renderProducts);\n\n  document.addEventListener(\"change\", async event => {\n    const statusSelect = event.target.closest(\"[data-order-status]\");\n    if (statusSelect) {\n      try {\n        await api(\"/api/admin/orders/\" + encodeURIComponent(statusSelect.dataset.orderStatus), { method: \"PATCH\", headers: { \"Content-Type\": \"application/json\" }, body: JSON.stringify({ status: statusSelect.value }) });\n        toast(\"Status do pedido atualizado.\");\n        await refresh();\n      } catch (error) { toast(error.message); }\n    }\n  });\n\n  document.addEventListener(\"change\", async event => {\n    const courierInput = event.target.closest(\"[data-courier]\");\n    if (!courierInput) return;\n    try {\n      await api(\"/api/admin/orders/\" + encodeURIComponent(courierInput.dataset.courier), { method: \"PATCH\", headers: { \"Content-Type\": \"application/json\" }, body: JSON.stringify({ courier: courierInput.value }) });\n      toast(\"Entregador atribuído.\");\n      await refresh();\n    } catch (error) { toast(error.message); }\n  });\n\n  document.addEventListener(\"change\", async event => {\n    const courierCard = event.target.closest(\"[data-courier-card]\");\n    if (!courierCard) return;\n    try {\n      await api(\"/api/admin/orders/\" + encodeURIComponent(courierCard.dataset.courierCard), { method: \"PATCH\", headers: { \"Content-Type\": \"application/json\" }, body: JSON.stringify({ courier: courierCard.value }) });\n    } catch (error) { toast(error.message); }\n  });\n\n  document.addEventListener(\"click\", async event => {\n    const confirmation = event.target.closest(\"[data-confirm-delivery]\");\n    if (confirmation) {\n      try {\n        await api(\"/api/admin/orders/\" + encodeURIComponent(confirmation.dataset.confirmDelivery), { method: \"PATCH\", headers: { \"Content-Type\": \"application/json\" }, body: JSON.stringify({ status: \"entregue\" }) });\n        toast(\"Entrega confirmada.\");\n        await refresh();\n      } catch (error) { toast(error.message); }\n    }\n\n    const toggle = event.target.closest(\"[data-toggle-product]\");\n    if (toggle) {\n      const product = overview.products.find(item => item.id === toggle.dataset.toggleProduct);\n      if (!product) return;\n      try {\n        await api(\"/api/admin/products/\" + encodeURIComponent(product.id), { method: \"PATCH\", headers: { \"Content-Type\": \"application/json\" }, body: JSON.stringify({ available: !product.available }) });\n        toast(product.available ? \"Produto marcado como indisponível.\" : \"Produto disponibilizado.\");\n        await refresh();\n      } catch (error) { toast(error.message); }\n    }\n\n    const edit = event.target.closest(\"[data-edit-product]\");\n    if (edit) openProductModal(overview.products.find(item => item.id === edit.dataset.editProduct));\n\n    const remove = event.target.closest(\"[data-delete-product]\");\n    if (remove) {\n      const product = overview.products.find(item => item.id === remove.dataset.deleteProduct);\n      if (!product || !window.confirm(`Excluir o produto \"${product.name}\"?`)) return;\n      try {\n        await api(\"/api/admin/products/\" + encodeURIComponent(product.id), { method: \"DELETE\" });\n        toast(\"Produto excluído.\");\n        await refresh();\n      } catch (error) { toast(error.message); }\n    }\n  });\n\n  $(\"new-product\").addEventListener(\"click\", () => openProductModal());\n  $(\"close-product-modal\").addEventListener(\"click\", closeProductModal);\n  $(\"cancel-product\").addEventListener(\"click\", closeProductModal);\n  $(\"product-modal\").addEventListener(\"click\", event => { if (event.target === $(\"product-modal\")) closeProductModal(); });\n\n  $(\"product-form\").addEventListener(\"submit\", async event => {\n    event.preventDefault();\n    const id = $(\"product-id\").value;\n    const payload = {\n      name: $(\"product-name\").value,\n      category: $(\"product-category\").value,\n      priceReais: Number($(\"product-price\").value),\n      description: $(\"product-description\").value,\n      available: $(\"product-available\").checked,\n    };\n    const file = $(\"product-image\").files[0];\n    const save = async imageDataUrl => {\n      if (typeof imageDataUrl === \"string\") payload.imageDataUrl = imageDataUrl;\n      try {\n        if (id) {\n          await api(\"/api/admin/products/\" + encodeURIComponent(id), {\n            method: \"PATCH\",\n            headers: { \"Content-Type\": \"application/json\" },\n            body: JSON.stringify(payload),\n          });\n          toast(\"Produto atualizado.\");\n        } else {\n          await api(\"/api/admin/products\", {\n            method: \"POST\",\n            headers: { \"Content-Type\": \"application/json\" },\n            body: JSON.stringify(payload),\n          });\n          toast(\"Produto criado.\");\n        }\n        closeProductModal();\n        await refresh();\n      } catch (error) {\n        toast(error.message);\n      }\n    };\n    if (file) {\n      if (file.size > 2 * 1024 * 1024) {\n        toast(\"A imagem do produto deve ter até 2 MB.\");\n        return;\n      }\n      const reader = new FileReader();\n      reader.onload = () => save(reader.result);\n      reader.readAsDataURL(file);\n    } else {\n      await save();\n    }\n  });\n\n  function setPreview(value) {\n    heroImageDataUrl = value;\n    $(\"hero-preview-image\").hidden = !value;\n    $(\"preview-empty\").hidden = Boolean(value);\n    if (value) $(\"hero-preview-image\").src = value;\n  }\n\n  function renderHours(schedule) {\n    const labels = { mon: \"Segunda-feira\", tue: \"Terça-feira\", wed: \"Quarta-feira\", thu: \"Quinta-feira\", fri: \"Sexta-feira\", sat: \"Sábado\", sun: \"Domingo\" };\n    $(\"hours-grid\").innerHTML = Object.entries(labels).map(([key, label]) => {\n      const value = schedule[key] || { closed: key === \"sun\", open: \"09:00\", close: \"18:00\" };\n      return `<div class=\"hour-row\" data-hour-day=\"${key}\">\n        <strong>${label}</strong>\n        <label><input type=\"checkbox\" data-hour-closed ${value.closed ? \"checked\" : \"\"}> Fechado</label>\n        <input type=\"time\" data-hour-open value=\"${esc(value.open || \"09:00\")}\" ${value.closed ? \"disabled\" : \"\"}>\n        <input type=\"time\" data-hour-close value=\"${esc(value.close || \"18:00\")}\" ${value.closed ? \"disabled\" : \"\"}>\n      </div>`;\n    }).join(\"\");\n  }\n\n  document.addEventListener(\"change\", event => {\n    const closed = event.target.closest(\"[data-hour-closed]\");\n    if (!closed) return;\n    const row = closed.closest(\"[data-hour-day]\");\n    row.querySelector(\"[data-hour-open]\").disabled = closed.checked;\n    row.querySelector(\"[data-hour-close]\").disabled = closed.checked;\n  });\n\n  function renderDeliveryRates() {\n    $(\"delivery-rates-list\").innerHTML = deliveryRates.length ? deliveryRates.map(rate => `\n      <div class=\"delivery-rate-row\" data-rate-name=\"${esc(rate.neighborhood)}\">\n        <input data-rate-neighborhood value=\"${esc(rate.neighborhood)}\" aria-label=\"Nome do bairro\">\n        <input data-rate-price type=\"number\" min=\"0\" step=\"0.01\" value=\"${(Number(rate.feeCents || 0) / 100).toFixed(2)}\" aria-label=\"Valor do frete\">\n        <div class=\"delivery-rate-actions\"><button type=\"button\" data-save-rate=\"${esc(rate.neighborhood)}\">Salvar</button><button type=\"button\" data-delete-rate=\"${esc(rate.neighborhood)}\">Excluir</button></div>\n      </div>`).join(\"\") : '<div class=\"empty-state\">Nenhum bairro cadastrado.</div>';\n  }\n\n  async function loadDeliveryRates() {\n    try {\n      const data = await api(\"/api/admin/delivery-rates\");\n      deliveryRates = data.rates || [];\n      renderDeliveryRates();\n    } catch (error) {\n      toast(error.message);\n    }\n  }\n\n  async function loadConfig() {\n    try {\n      const config = await api(\"/api/admin/store-config\");\n      setPreview(config.heroImageDataUrl || \"\");\n      renderHours(config.businessHours || {});\n      $(\"origin-address\").value = config.originAddress || \"\";\n      renderStoreMode(config.manualOpenOverride);\n      $(\"fallback-cents\").value = ((Number(config.deliveryFallbackCents ?? 200)) / 100).toFixed(2);\n      $(\"fallback-km\").value = config.deliveryFallbackKm ?? 3;\n    } catch (error) {\n      toast(error.message);\n    }\n  }\n\n  $(\"hero-image-input\").addEventListener(\"change\", event => {\n    const file = event.target.files[0];\n    if (!file) return;\n    if (file.size > 2 * 1024 * 1024) {\n      toast(\"Escolha uma imagem com até 2 MB.\");\n      return;\n    }\n    const reader = new FileReader();\n    reader.onload = () => setPreview(reader.result);\n    reader.readAsDataURL(file);\n  });\n  $(\"remove-image\").addEventListener(\"click\", () => {\n    $(\"hero-image-input\").value = \"\";\n    setPreview(\"\");\n  });\n  $(\"save-image\").addEventListener(\"click\", async () => {\n    const button = $(\"save-image\");\n    button.disabled = true;\n    button.textContent = \"Salvando...\";\n    try {\n      await api(\"/api/admin/store-config\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ heroImageDataUrl }),\n      });\n      toast(\"Imagem atualizada no cardápio.\");\n    } catch (error) {\n      toast(error.message);\n    } finally {\n      button.disabled = false;\n      button.textContent = \"Salvar alteração\";\n    }\n  });\n\n  $(\"save-hours\").addEventListener(\"click\", async () => {\n    const businessHours = {};\n    document.querySelectorAll(\"[data-hour-day]\").forEach(row => {\n      const key = row.dataset.hourDay;\n      businessHours[key] = {\n        closed: row.querySelector(\"[data-hour-closed]\").checked,\n        open: row.querySelector(\"[data-hour-open]\").value,\n        close: row.querySelector(\"[data-hour-close]\").value,\n      };\n    });\n    const button = $(\"save-hours\");\n    button.disabled = true;\n    const previousLabel = button.textContent;\n    button.textContent = \"Salvando...\";\n    try {\n      const result = await api(\"/api/admin/store-config\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ businessHours }),\n      });\n      if (!result.config?.businessHours) throw new Error(\"O servidor não confirmou os horários gravados.\");\n      await loadConfig();\n      toast(\"Horários salvos e conferidos no banco.\");\n    } catch (error) {\n      toast(error.message);\n    } finally {\n      button.disabled = false;\n      button.textContent = previousLabel;\n    }\n  });\n\n  function ensureAcceptanceControl() {\n    if ($(\"store-mode-controls\")) return;\n    // Remove the legacy checkbox section when the browser still has the previous cached HTML.\n    const legacyToggle = $(\"accepting-orders-toggle\");\n    legacyToggle?.closest(\".hours-card\")?.remove();\n    const section = document.createElement(\"section\");\n    section.className = \"hours-card order-acceptance-card\";\n    section.innerHTML = '<div class=\"panel-heading\"><div><span class=\"panel-kicker\">STATUS DA LOJA</span><h2>Controle de funcionamento</h2></div><span id=\"store-mode-status\" class=\"store-mode-status\">Carregando...</span></div><p>Escolha se a loja segue a programação ou se ficará aberta/fechada manualmente. A abertura manual libera pedidos mesmo fora do expediente.</p><div id=\"store-mode-controls\" class=\"store-mode-controls\"><button class=\"quiet-button\" type=\"button\" data-store-mode=\"auto\">Automático</button><button class=\"primary-button\" type=\"button\" data-store-mode=\"open\">Abrir loja agora</button><button class=\"quiet-button\" type=\"button\" data-store-mode=\"closed\">Fechar loja agora</button></div>';\n    const settings = $(\"settings-section\");\n    const hoursCard = settings?.querySelector(\".hours-card\");\n    if (settings && hoursCard) settings.insertBefore(section, hoursCard);\n  }\n  function renderStoreMode(mode) {\n    const status = $(\"store-mode-status\");\n    if (!status) return;\n    status.textContent = mode === true ? \"Aberta manualmente\" : mode === false ? \"Fechada manualmente\" : \"Automático\";\n    const activeMode = mode === true ? \"open\" : mode === false ? \"closed\" : \"auto\";\n    document.querySelectorAll(\"[data-store-mode]\").forEach(button => button.classList.toggle(\"active\", button.dataset.storeMode === activeMode));\n  }\n  ensureAcceptanceControl();\n\n  $(\"store-mode-controls\").addEventListener(\"click\", async event => {\n    const button = event.target.closest(\"[data-store-mode]\");\n    if (!button) return;\n    const mode = button.dataset.storeMode;\n    const manualOpenOverride = mode === \"auto\" ? null : mode === \"open\";\n    const controls = $(\"store-mode-controls\");\n    controls.querySelectorAll(\"button\").forEach(item => item.disabled = true);\n    try {\n      const result = await api(\"/api/admin/store-config\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ manualOpenOverride }),\n      });\n      if (result.config?.manualOpenOverride !== manualOpenOverride) throw new Error(\"O servidor não confirmou o modo de funcionamento.\");\n      await loadConfig();\n      toast(mode === \"open\" ? \"Loja aberta manualmente. Pedidos liberados agora.\" : mode === \"closed\" ? \"Loja fechada manualmente.\" : \"Funcionamento automático restaurado.\");\n    } catch (error) {\n      toast(error.message);\n    } finally {\n      controls.querySelectorAll(\"button\").forEach(item => item.disabled = false);\n    }\n  });\n\n  $(\"logout-button\").addEventListener(\"click\", async () => {\n    await api(\"/api/admin/logout\", { method: \"POST\" });\n    location.reload();\n  });\n\n  $(\"save-delivery-config\").addEventListener(\"click\", async () => {\n    try {\n      await api(\"/api/admin/store-config\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({\n          originAddress: $(\"origin-address\").value,\n          deliveryFallbackCents: Math.round(Number($(\"fallback-cents\").value || 0) * 100),\n          deliveryFallbackKm: Number($(\"fallback-km\").value || 3),\n        }),\n      });\n      toast(\"Configuração de entrega atualizada.\");\n    } catch (error) {\n      toast(error.message);\n    }\n  });\n\n  $(\"delivery-rate-form\").addEventListener(\"submit\", async event => {\n    event.preventDefault();\n    try {\n      await api(\"/api/admin/delivery-rates\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({\n          neighborhood: $(\"delivery-rate-neighborhood\").value,\n          feeReais: Number($(\"delivery-rate-price\").value),\n        }),\n      });\n      $(\"delivery-rate-neighborhood\").value = \"\";\n      $(\"delivery-rate-price\").value = \"\";\n      await loadDeliveryRates();\n      toast(\"Bairro cadastrado.\");\n    } catch (error) {\n      toast(error.message);\n    }\n  });\n\n  document.addEventListener(\"click\", async event => {\n    const save = event.target.closest(\"[data-save-rate]\");\n    if (save) {\n      const row = save.closest(\"[data-rate-name]\");\n      try {\n        await api(\"/api/admin/delivery-rates/\" + encodeURIComponent(save.dataset.saveRate), {\n          method: \"PATCH\",\n          headers: { \"Content-Type\": \"application/json\" },\n          body: JSON.stringify({\n            neighborhood: row.querySelector(\"[data-rate-neighborhood]\").value,\n            feeReais: Number(row.querySelector(\"[data-rate-price]\").value),\n          }),\n        });\n        await loadDeliveryRates();\n        toast(\"Bairro atualizado.\");\n      } catch (error) {\n        toast(error.message);\n      }\n    }\n\n    const remove = event.target.closest(\"[data-delete-rate]\");\n    if (remove) {\n      if (!window.confirm(`Excluir o frete do bairro \"${remove.dataset.deleteRate}\"?`)) return;\n      try {\n        await api(\"/api/admin/delivery-rates/\" + encodeURIComponent(remove.dataset.deleteRate), { method: \"DELETE\" });\n        await loadDeliveryRates();\n        toast(\"Bairro removido.\");\n      } catch (error) {\n        toast(error.message);\n      }\n    }\n  });\n\n  loadConfig();\n  loadDeliveryRates();\n  refresh({ silent: false });\n  pollingTimer = setInterval(() => refresh(), 5000);\n})();\n";
const PUBLIC_ORDER_JS = "(() => {\nconst $ = id => document.getElementById(id);\nconst brl = cents => new Intl.NumberFormat(\"pt-BR\",{style:\"currency\",currency:\"BRL\"}).format(cents/100);\nconst state = {products:[],rates:[],cart:{},category:\"Todos\",fallbackCents:200,fallbackKm:3,ordersOpen:false};\nconst esc = s => String(s||\"\").replace(/[&<>\"']/g,c=>({\"&\":\"&amp;\",\"<\":\"&lt;\",\">\":\"&gt;\",'\"':\"&quot;\",\"'\":\"&#39;\"}[c]));\nasync function init(){\n try{\n  const response=await fetch(\"/api/public-order/menu\"); if(!response.ok)throw Error(\"Falha ao carregar cardápio.\");\n  const data=await response.json();state.products=data.products||[];state.rates=data.deliveryRates||[];state.fallbackCents=Number(data.deliveryFallbackCents??200);state.fallbackKm=Number(data.deliveryFallbackKm??3);if($(\"fallback-distance-help\"))$(\"fallback-distance-help\").textContent=`Usaremos ${brl(state.fallbackCents)} a cada ${state.fallbackKm} km para bairros não cadastrados.`;\n  $(\"demo-ribbon\").hidden=!data.demo;\n  const heroImage=$(\"store-hero-image\");\n  if(data.heroImageDataUrl){heroImage.src=data.heroImageDataUrl;heroImage.hidden=false;$(\"store-hero\").classList.add(\"has-image\");}\n  categories();products();neighborhoods();hours(data.businessHours);\n }catch(e){$(\"menu-status\").textContent=e.message;}\n}\nfunction categories(){const names=[\"Todos\",...new Set(state.products.map(p=>p.category))];$(\"category-tabs\").innerHTML=names.map(n=>'<button class=\"category-tab '+(state.category===n?'active':'')+'\" data-category=\"'+esc(n)+'\">'+esc(n)+'</button>').join(\"\");}\nfunction products(){\n const q=$(\"menu-search\").value.toLowerCase().trim();\n const list=state.products.filter(p=>(state.category===\"Todos\"||p.category===state.category)&&(p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q)));\n $(\"menu-count\").textContent=list.length+\" \"+(list.length===1?\"produto\":\"produtos\");\n const categoryNames=[...new Set(list.map(p=>p.category))];\n $(\"menu-grid\").innerHTML=categoryNames.map(category=>{\n  const items=list.filter(p=>p.category===category);\n  const cards=items.map(p=>'\\u003carticle class=\"menu-product\"\\u003e\\u003cdiv class=\"menu-photo\"\\u003e'+(p.imageDataUrl?'\\u003cimg src=\"'+p.imageDataUrl+'\" alt=\"'+esc(p.name)+'\" style=\"width:100%;height:100%;object-fit:cover\"\\u003e':'✳')+'\\u003c/div\\u003e\\u003cdiv class=\"menu-product-copy\"\\u003e\\u003ch3\\u003e'+esc(p.name)+'\\u003c/h3\\u003e\\u003cp\\u003e'+esc(p.category)+'\\u003c/p\\u003e\\u003cstrong class=\"menu-price\"\\u003e'+brl(p.unitPriceCents)+'\\u003c/strong\\u003e\\u003c/div\\u003e\\u003cdiv class=\"menu-product-controls\"\\u003e\\u003cspan\\u003e'+(state.cart[p.id]||0)+' no carrinho\\u003c/span\\u003e\\u003cbutton class=\"quantity-add\" data-add=\"'+esc(p.id)+'\"\\u003eAdicionar +\\u003c/button\\u003e\\u003c/div\\u003e\\u003c/article\\u003e').join(\"\");\n  return '\\u003csection class=\"menu-category\"\\u003e\\u003cdiv class=\"menu-category-heading\"\\u003e\\u003cspan\\u003e'+esc(category)+'\\u003c/span\\u003e\\u003cb\\u003e'+items.length+' '+(items.length===1?'opção':'opções')+'\\u003c/b\\u003e\\u003c/div\\u003e\\u003cdiv class=\"menu-category-grid\"\\u003e'+cards+'\\u003c/div\\u003e\\u003c/section\\u003e';\n }).join(\"\");\n $(\"menu-empty\").hidden=list.length>0;$(\"menu-status\").textContent=\"Selecione os produtos para adicionar à sua cestinha.\";\n}\nfunction neighborhoods(){ $(\"customer-neighborhood\").innerHTML='<option value=\"\">Selecione seu bairro</option>'+state.rates.map(r=>'<option value=\"'+esc(r.neighborhood)+'\">'+esc(r.neighborhood)+' · '+brl(r.feeCents)+'</option>').join(\"\")+'<option value=\"__unregistered\">Outro bairro / não cadastrado</option>'; }\nfunction hours(h){\n if(!h)return;\n state.ordersOpen=h.isOpen===true;\n const days=[[\"mon\",\"Seg\"],[\"tue\",\"Ter\"],[\"wed\",\"Qua\"],[\"thu\",\"Qui\"],[\"fri\",\"Sex\"],[\"sat\",\"Sáb\"],[\"sun\",\"Dom\"]];\n const formatTime=value=>String(value||\"\").slice(0,5).replace(\":\",\"h\");\n const schedule=h.schedule||{};\n const detail=h.enabled\n  ? days.map(([key,label])=>{const day=schedule[key];if(!day)return label+\": não definido\";return label+\": \"+(day.closed?\"fechado\":formatTime(day.open)+\"–\"+formatTime(day.close));}).join(\" · \")\n  : \"Horário automático desativado.\";\n const open=state.ordersOpen;\n $(\"business-hours-status\").textContent=open?\"Estamos recebendo pedidos\":(h.enabled?\"No momento estamos fechados\":\"Recebimento de pedidos pausado pela loja\");\n $(\"business-hours-badge\").textContent=open?\"Aberto\":\"Fechado\";\n $(\"business-hours-badge\").classList.toggle(\"is-open\",open);\n $(\"business-hours-detail\").textContent=detail;\n cart();\n}\nfunction updateFallbackDistance(){ const unregistered=$(\"customer-neighborhood\").value===\"__unregistered\"; $(\"fallback-distance-field\").hidden=!unregistered; $(\"delivery-distance\").required=unregistered; $(\"customer-neighborhood-name\").required=unregistered; if(!unregistered){$(\"delivery-distance\").value=\"\";$(\"customer-neighborhood-name\").value=\"\";} }\nfunction fee(){if($(\"fulfillment-type\").value!==\"delivery\")return 0;const r=state.rates.find(x=>x.neighborhood===$(\"customer-neighborhood\").value);if(r)return r.feeCents;if($(\"customer-neighborhood\").value===\"__unregistered\"){const distance=Math.max(0,Number($(\"delivery-distance\").value||0));return Math.ceil(distance/(state.fallbackKm||3))*(state.fallbackCents||200);}return 0;}\nfunction cart(){\n const items=Object.entries(state.cart).filter(x=>x[1]>0);\n $(\"cart-items\").innerHTML=items.length?items.map(([id,n])=>{const p=state.products.find(x=>x.id===id);return '<div class=\"cart-row\"><span>'+esc(p.name)+' × '+n+'</span><span>'+brl(p.unitPriceCents*n)+' <button data-minus=\"'+id+'\">−</button></span></div>';}).join(\"\"):'<p class=\"cart-empty\">Sua cestinha ainda está vazia.</p>';\n const sub=items.reduce((s,[id,n])=>s+state.products.find(p=>p.id===id).unitPriceCents*n,0),total=sub+fee();\n $(\"cart-subtotal\").textContent=brl(sub);$(\"cart-freight\").textContent=brl(fee());$(\"cart-total\").textContent=brl(total);\n const count=items.reduce((s,x)=>s+x[1],0);$(\"mobile-cart-count\").textContent=count;$(\"mobile-cart-count\").hidden=!count;\n $(\"submit-order\").disabled=!count||!state.ordersOpen;\n $(\"submit-order\").textContent=state.ordersOpen?\"Confirmar pedido →\":\"Pedidos fechados no momento\";\n products();\n}\nfunction openCart(){const panel=$(\"checkout-panel\");$(\"mobile-checkout-slot\").append(panel);$(\"mobile-checkout-overlay\").hidden=false;document.body.classList.add(\"checkout-open\");$(\"mobile-cart-trigger\").setAttribute(\"aria-expanded\",\"true\");$(\"mobile-checkout-close\").focus();}\nfunction closeCart(){const panel=$(\"checkout-panel\");$(\"mobile-checkout-overlay\").hidden=true;document.body.classList.remove(\"checkout-open\");$(\"mobile-cart-trigger\").setAttribute(\"aria-expanded\",\"false\");$(\"order-layout\").append(panel);}\ndocument.addEventListener(\"click\",e=>{\n const add=e.target.closest(\"[data-add]\");if(add){state.cart[add.dataset.add]=(state.cart[add.dataset.add]||0)+1;cart();}\n const minus=e.target.closest(\"[data-minus]\");if(minus){state.cart[minus.dataset.minus]=Math.max(0,(state.cart[minus.dataset.minus]||0)-1);cart();}\n const cat=e.target.closest(\"[data-category]\");if(cat){state.category=cat.dataset.category;categories();products();}\n});\n$(\"menu-search\").addEventListener(\"input\",products);\n$(\"fulfillment-type\").addEventListener(\"change\",()=>{const delivery=$(\"fulfillment-type\").value===\"delivery\";$(\"delivery-fields\").hidden=!delivery;$(\"customer-address\").required=delivery;$(\"customer-neighborhood\").required=delivery;cart();});\n$(\"customer-neighborhood\").addEventListener(\"change\",()=>{updateFallbackDistance();cart();});\n$(\"delivery-distance\").addEventListener(\"input\",cart);\n$(\"mobile-cart-trigger\").addEventListener(\"click\",openCart);\n$(\"mobile-checkout-close\").addEventListener(\"click\",closeCart);\n$(\"mobile-checkout-backdrop\").addEventListener(\"click\",closeCart);\n$(\"public-order-form\").addEventListener(\"submit\",async e=>{\n e.preventDefault();\n if(!state.ordersOpen){alert(\"A loja não está recebendo pedidos neste momento. Confira os horários de atendimento.\");return;}\n if(!e.currentTarget.reportValidity())return;\n const neighborhood=$(\"customer-neighborhood\").value===\"__unregistered\"?$(\"customer-neighborhood-name\").value:$(\"customer-neighborhood\").value;\n const payload={requestId:crypto.randomUUID(),customerName:$(\"customer-name\").value,phone:$(\"customer-phone\").value,address:$(\"customer-address\").value,neighborhood,distanceKm:Number($(\"delivery-distance\").value||0),fulfillmentType:$(\"fulfillment-type\").value,paymentMethod:$(\"payment-method\").value,notes:$(\"order-notes\").value,items:Object.entries(state.cart).filter(x=>x[1]>0).map(([productId,quantity])=>({productId,quantity}))};\n const btn=$(\"submit-order\");btn.disabled=true;btn.textContent=\"Enviando…\";\n try{const r=await fetch(\"/api/public-order/orders\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw Error(data.error||\"Não foi possível enviar.\");$(\"public-order-form\").hidden=true;$(\"order-confirmation\").hidden=false;$(\"confirmation-message\").textContent=\"Pedido \"+data.orderId+\" registrado. Total: \"+brl(data.totalCents)+\".\";$(\"demo-order-note\").hidden=!data.demo;}\n catch(err){alert(err.message);}finally{btn.textContent=\"Confirmar pedido →\";cart();}\n});\n$(\"new-order\").addEventListener(\"click\",()=>{state.cart={};$(\"public-order-form\").reset();$(\"public-order-form\").hidden=false;$(\"order-confirmation\").hidden=true;closeCart();cart();});\n$(\"current-year\").textContent=new Date().getFullYear();\ninit();\n})();";
const ORDER_STATUS_TO_UI = {
  received: "novo",
  new: "novo",
  preparing: "preparando",
  ready: "pronto",
  out_for_delivery: "saiu_entrega",
  completed: "entregue",
  cancelled: "cancelado",
  novo: "novo",
  preparando: "preparando",
  pronto: "pronto",
  saiu_entrega: "saiu_entrega",
  entregue: "entregue",
  cancelado: "cancelado",
};
const ORDER_STATUS_TO_DB = {
  novo: "received",
  preparando: "preparing",
  pronto: "ready",
  saiu_entrega: "out_for_delivery",
  entregue: "completed",
  cancelado: "cancelled",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function withCookies(response, cookies = []) {
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}

function errorMessage(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function parseCookies(request) {
  const result = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function authCookies(accessToken, refreshToken, expiresIn = 3600) {
  const secure = "; Secure; HttpOnly; SameSite=Strict; Path=/";
  return [
    "nsg_admin_access=" + encodeURIComponent(accessToken) + secure + "; Max-Age=" + Math.max(60, Math.min(Number(expiresIn) || 3600, 3600)),
    "nsg_admin_refresh=" + encodeURIComponent(refreshToken) + secure + "; Max-Age=28800",
  ];
}

function clearAuthCookies() {
  const secure = "; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
  return ["nsg_admin_access=" + secure, "nsg_admin_refresh=" + secure];
}

async function readJsonBody(request, maxBytes = MAX_ORDER_BYTES) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { error: "Envie os dados em formato JSON.", status: 415 };
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) return { error: "Os dados excedem o tamanho permitido.", status: 413 };
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) return { error: "Os dados excedem o tamanho permitido.", status: 413 };
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "Os dados enviados são inválidos.", status: 400 };
    }
    return { value };
  } catch {
    return { error: "O conteúdo precisa estar em formato JSON válido.", status: 400 };
  }
}

function getSupabaseAuthApiKey(env) {
  // User authentication uses the low-privilege project key. The service-role
  // key remains server-only for the Worker's protected database operations.
  return env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "";
}

function getSupabaseConfig(env) {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return { error: "A integração com o banco ainda não foi configurada." };
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return { error: "A configuração do banco de dados é inválida." };
    }
    return { url: parsed.origin, key: serviceRoleKey };
  } catch {
    return { error: "A configuração do banco de dados é inválida." };
  }
}

async function supabaseFetch(env, path, options = {}) {
  const config = getSupabaseConfig(env);
  if (config.error) return { ok: false, status: 503, error: config.error };
  try {
    const response = await fetch(config.url + path, {
      ...options,
      headers: {
        apikey: config.key,
        authorization: "Bearer " + config.key,
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: response.status >= 500
          ? "Não foi possível acessar o banco de dados agora."
          : errorMessage(data?.message || data?.hint, "Não foi possível concluir a operação."),
        data,
      };
    }
    return { ok: true, status: response.status, data };
  } catch {
    return { ok: false, status: 502, error: "Não foi possível conectar ao banco de dados agora." };
  }
}

async function callSupabaseRpc(env, functionName, payload = {}) {
  return supabaseFetch(env, "/rest/v1/rpc/" + encodeURIComponent(functionName), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function getPublicMenu(env) {
  const result = await callSupabaseRpc(env, "public_order_menu");
  if (!result.ok) return json({ error: result.error }, result.status);
  const menu = result.data;
  if (!menu || typeof menu !== "object" || Array.isArray(menu)) {
    return json({ error: "O banco retornou um cardápio inválido." }, 502);
  }
  return json({ ...menu, demo: false });
}

async function createPublicOrder(request, env) {
  if (!isSameOrigin(request)) return json({ error: "Origem da solicitação não permitida." }, 403);
  const parsed = await readJsonBody(request, MAX_ORDER_BYTES);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  if (!env.PUBLIC_ORDER_LIMITER) return json({ error: "A proteção contra excesso de pedidos não está configurada." }, 503);
  try {
    const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
    const limit = await env.PUBLIC_ORDER_LIMITER.limit({ key: clientIp });
    if (!limit.success) return json({ error: "Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente." }, 429, { "retry-after": "60" });
  } catch {
    return json({ error: "Não foi possível validar a solicitação agora." }, 503);
  }
  const result = await callSupabaseRpc(env, "create_public_order", { p_order: parsed.value });
  if (!result.ok) {
    const status = result.status === 400 || result.status === 422 ? 400 : result.status === 401 || result.status === 403 || result.status === 429 ? 503 : result.status;
    return json({ error: status === 400 ? errorMessage(result.data?.message, result.error) : result.error }, status);
  }
  const order = result.data;
  if (!order || typeof order !== "object" || !order.orderId) return json({ error: "O banco retornou uma confirmação de pedido inválida." }, 502);
  return json({ ok: true, demo: false, orderId: order.orderId, totalCents: order.totalCents, duplicate: Boolean(order.duplicate) }, order.duplicate ? 200 : 201);
}

async function verifySupabaseUser(env, accessToken) {
  const config = getSupabaseConfig(env);
  if (config.error || !getSupabaseAuthApiKey(env)) return null;
  try {
    const response = await fetch(config.url + "/auth/v1/user", {
      headers: { apikey: getSupabaseAuthApiKey(env), authorization: "Bearer " + accessToken },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function refreshSupabaseSession(env, refreshToken) {
  const config = getSupabaseConfig(env);
  if (config.error || !refreshToken || !getSupabaseAuthApiKey(env)) return null;
  try {
    const response = await fetch(config.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: getSupabaseAuthApiKey(env), "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) return null;
    const session = await response.json();
    if (!session.access_token || !session.refresh_token || !session.user) return null;
    return session;
  } catch {
    return null;
  }
}

async function getAdminContext(request, env) {
  const cookies = parseCookies(request);
  let accessToken = cookies.nsg_admin_access;
  const refreshToken = cookies.nsg_admin_refresh;
  let refreshedCookies = [];
  let user = accessToken ? await verifySupabaseUser(env, accessToken) : null;
  if (!user && refreshToken) {
    const session = await refreshSupabaseSession(env, refreshToken);
    if (session) {
      accessToken = session.access_token;
      user = session.user;
      refreshedCookies = authCookies(session.access_token, session.refresh_token, session.expires_in);
    }
  }
  const allowedEmail = String(env.ADMIN_EMAIL || ADMIN_EMAIL).trim().toLowerCase();
  if (!user || String(user.email || "").toLowerCase() !== allowedEmail) {
    return { user: null, cookies: refreshedCookies };
  }
  return { user, cookies: refreshedCookies };
}

async function adminLogin(request, env) {
  if (!isSameOrigin(request)) return json({ error: "Origem da solicitação não permitida." }, 403);
  const parsed = await readJsonBody(request, 16 * 1024);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const username = String(parsed.value.username || parsed.value.email || "").trim().toLowerCase();
  const password = String(parsed.value.password || "");
  const allowedEmail = String(env.ADMIN_EMAIL || ADMIN_EMAIL).trim().toLowerCase();
  if (!username || !password) return json({ error: "Informe e-mail e senha." }, 400);
  if (username !== allowedEmail) return json({ error: "Usuário ou senha incorretos." }, 401);
  const config = getSupabaseConfig(env);
  if (config.error) return json({ error: config.error }, 503);
  if (!getSupabaseAuthApiKey(env)) return json({ error: "A chave pública de autenticação do Supabase não foi configurada no Worker." }, 503);
  try {
    const response = await fetch(config.url + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: getSupabaseAuthApiKey(env), "content-type": "application/json" },
      body: JSON.stringify({ email: username, password }),
    });
    const session = await response.json().catch(() => ({}));
    if (!response.ok || !session.access_token || !session.refresh_token || !session.user) {
      if (response.status === 400 || response.status === 401) {
        return json({ error: "E-mail ou senha incorretos." }, 401);
      }
      return json({ error: "O serviço de autenticação do Supabase está indisponível. Tente novamente em instantes." }, 503);
    }
    if (String(session.user.email || "").toLowerCase() !== allowedEmail) {
      return json({ error: "Esta conta não tem permissão administrativa." }, 403);
    }
    return withCookies(json({ ok: true }), authCookies(session.access_token, session.refresh_token, session.expires_in));
  } catch {
    return json({ error: "Não foi possível autenticar agora." }, 502);
  }
}

function dbPath(table, params = {}) {
  const query = new URLSearchParams(params);
  const suffix = query.toString();
  return "/rest/v1/" + table + (suffix ? "?" + suffix : "");
}

function normalizeOrder(row) {
  const items = Array.isArray(row.public_order_items) ? row.public_order_items : [];
  return {
    orderId: row.id,
    customerName: row.customer_name,
    phone: row.phone || "",
    address: row.address || "",
    neighborhood: row.neighborhood || "",
    fulfillmentType: row.fulfillment_type,
    paymentMethod: row.payment_method,
    notes: row.notes || "",
    status: ORDER_STATUS_TO_UI[row.status] || "novo",
    courier: row.courier || "",
    deliveryConfirmedAt: row.delivery_confirmed_at || null,
    items: items.map(item => ({
      productId: item.product_id,
      name: item.product_name,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
    })),
    subtotalCents: Number(row.subtotal_cents || 0),
    deliveryFeeCents: Number(row.delivery_fee_cents || 0),
    totalCents: Number(row.total_cents || 0),
    createdAt: row.created_at,
  };
}

function normalizeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    category: row.category,
    unitPriceCents: Number(row.unit_price_cents || 0),
    available: Boolean(row.available),
    imageDataUrl: row.image_url || null,
  };
}

function dateKey(value) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function startOfWeekKey(date) {
  const parts = dateKey(date).split("-").map(Number);
  const utc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const weekday = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() - ((weekday + 6) % 7));
  return utc.toISOString().slice(0, 10);
}

async function adminOverview(env) {
  const [ordersResult, productsResult] = await Promise.all([
    supabaseFetch(env, dbPath("public_orders", { select: "*,public_order_items(*)", order: "created_at.desc", limit: "500" })),
    supabaseFetch(env, dbPath("public_order_products", { select: "*", order: "sort_order.asc,name.asc" })),
  ]);
  if (!ordersResult.ok) return json({ error: ordersResult.error }, ordersResult.status);
  if (!productsResult.ok) return json({ error: productsResult.error }, productsResult.status);
  const orders = (ordersResult.data || []).map(normalizeOrder);
  const products = (productsResult.data || []).map(normalizeProduct);
  const activeOrders = orders.filter(order => order.status !== "cancelado");
  const deliveredOrders = orders.filter(order => order.status === "entregue");
  const grossCents = activeOrders.reduce((sum, order) => sum + order.totalCents, 0);
  const deliveredCents = deliveredOrders.reduce((sum, order) => sum + order.totalCents, 0);
  const paymentTotals = {};
  const productTotals = {};
  activeOrders.forEach(order => {
    paymentTotals[order.paymentMethod || "outros"] = (paymentTotals[order.paymentMethod || "outros"] || 0) + order.totalCents;
    order.items.forEach(item => { productTotals[item.name] = (productTotals[item.name] || 0) + item.quantity; });
  });
  const today = dateKey(new Date());
  const month = today.slice(0, 7);
  const weekStart = startOfWeekKey(new Date());
  const sumPeriod = predicate => activeOrders.filter(order => predicate(dateKey(order.createdAt))).reduce((sum, order) => sum + order.totalCents, 0);
  const topProducts = Object.entries(productTotals).map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 8);
  return json({
    totals: {
      grossCents,
      deliveredCents,
      orders: activeOrders.length,
      delivered: deliveredOrders.length,
      pending: activeOrders.filter(order => !["entregue", "cancelado"].includes(order.status)).length,
      products: products.length,
      availableProducts: products.filter(product => product.available).length,
    },
    financePeriods: {
      dailyCents: sumPeriod(key => key === today),
      weeklyCents: sumPeriod(key => key >= weekStart),
      monthlyCents: sumPeriod(key => key.slice(0, 7) === month),
    },
    topProducts,
    paymentTotals,
    orders,
    products,
    updatedAt: new Date().toISOString(),
  });
}

async function adminOrders(request, env) {
  if (request.method === "GET") {
    const result = await supabaseFetch(env, dbPath("public_orders", { select: "*,public_order_items(*)", order: "created_at.desc", limit: "500" }));
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ orders: (result.data || []).map(normalizeOrder), updatedAt: new Date().toISOString() });
  }
  const match = new URL(request.url).pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (!match || request.method !== "PATCH") return json({ error: "Rota não encontrada." }, 404);
  const parsed = await readJsonBody(request, 32 * 1024);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const patch = {};
  if (typeof parsed.value.status === "string") {
    if (!Object.hasOwn(ORDER_STATUS_TO_DB, parsed.value.status)) return json({ error: "Status inválido." }, 400);
    patch.status = ORDER_STATUS_TO_DB[parsed.value.status];
    patch.delivery_confirmed_at = parsed.value.status === "entregue" ? new Date().toISOString() : null;
  }
  if (typeof parsed.value.courier === "string") patch.courier = parsed.value.courier.trim().slice(0, 120);
  if (!Object.keys(patch).length) return json({ error: "Nenhuma alteração válida foi enviada." }, 400);
  const id = decodeURIComponent(match[1]);
  const result = await supabaseFetch(env, dbPath("public_orders", { id: "eq." + id, select: "*,public_order_items(*)" }), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!result.ok) return json({ error: result.error }, result.status);
  if (!result.data?.length) return json({ error: "Pedido não encontrado." }, 404);
  return json({ ok: true, order: normalizeOrder(result.data[0]), updatedAt: new Date().toISOString() });
}

function dataUrlToBytes(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value || "");
  if (!match) throw new Error("Selecione uma imagem PNG, JPG ou WebP válida.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("A imagem deve ter até 2 MB.");
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1].slice(6);
  return { bytes, contentType: match[1], extension };
}

async function uploadImage(env, dataUrl, prefix) {
  const config = getSupabaseConfig(env);
  if (config.error) throw new Error(config.error);
  const image = dataUrlToBytes(dataUrl);
  const objectPath = prefix + "/" + crypto.randomUUID() + "." + image.extension;
  const response = await fetch(config.url + "/storage/v1/object/product-images/" + objectPath, {
    method: "POST",
    headers: {
      apikey: config.key,
      authorization: "Bearer " + config.key,
      "content-type": image.contentType,
      "x-upsert": "true",
    },
    body: image.bytes,
  });
  if (!response.ok) throw new Error("Não foi possível salvar a imagem no armazenamento.");
  return config.url + "/storage/v1/object/public/product-images/" + objectPath;
}

async function adminProducts(request, env) {
  const match = new URL(request.url).pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (request.method === "GET") {
    const result = await supabaseFetch(env, dbPath("public_order_products", { select: "*", order: "sort_order.asc,name.asc" }));
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ products: result.data.map(normalizeProduct), updatedAt: new Date().toISOString() });
  }
  const parsed = await readJsonBody(request, MAX_ADMIN_BYTES);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  if (request.method === "POST" && !match) {
    const input = parsed.value;
    const name = String(input.name || "").trim();
    const category = String(input.category || "").trim();
    const price = Math.round(Number(input.priceReais) * 100);
    if (!name || !category || !Number.isFinite(price) || price < 0) return json({ error: "Informe nome, categoria e preço válido." }, 400);
    let imageUrl = null;
    try { if (typeof input.imageDataUrl === "string" && input.imageDataUrl) imageUrl = await uploadImage(env, input.imageDataUrl, "products"); }
    catch (error) { return json({ error: error.message }, 400); }
    const id = String(input.id || (name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + crypto.randomUUID().slice(0, 8))).slice(0, 120);
    const existing = await supabaseFetch(env, dbPath("public_order_products", { select: "id", id: "eq." + id }));
    if (!existing.ok) return json({ error: existing.error }, existing.status);
    if (existing.data.length) return json({ error: "Já existe um produto com este código." }, 409);
    const max = await supabaseFetch(env, dbPath("public_order_products", { select: "sort_order", order: "sort_order.desc", limit: "1" }));
    const sortOrder = Number(max.data?.[0]?.sort_order || 0) + 1;
    const result = await supabaseFetch(env, "/rest/v1/public_order_products", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ id, name, category, description: String(input.description || "").trim(), unit_price_cents: price, available: input.available !== false, image_url: imageUrl, sort_order: sortOrder }),
    });
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true, product: normalizeProduct(result.data[0]) }, 201);
  }
  if (!match) return json({ error: "Rota não encontrada." }, 404);
  const id = decodeURIComponent(match[1]);
  if (request.method === "PATCH") {
    const patch = {};
    if (typeof parsed.value.name === "string") patch.name = parsed.value.name.trim();
    if (typeof parsed.value.description === "string") patch.description = parsed.value.description.trim();
    if (typeof parsed.value.category === "string") patch.category = parsed.value.category.trim();
    if (typeof parsed.value.available === "boolean") patch.available = parsed.value.available;
    if (typeof parsed.value.priceReais !== "undefined") {
      const price = Math.round(Number(parsed.value.priceReais) * 100);
      if (!Number.isFinite(price) || price < 0) return json({ error: "Preço inválido." }, 400);
      patch.unit_price_cents = price;
    }
    if (typeof parsed.value.unitPriceCents !== "undefined") patch.unit_price_cents = Math.max(0, Math.round(Number(parsed.value.unitPriceCents)));
    if (typeof parsed.value.imageDataUrl === "string") {
      try { patch.image_url = parsed.value.imageDataUrl ? await uploadImage(env, parsed.value.imageDataUrl, "products") : null; }
      catch (error) { return json({ error: error.message }, 400); }
    }
    if (!Object.keys(patch).length) return json({ error: "Nenhuma alteração válida foi enviada." }, 400);
    const result = await supabaseFetch(env, dbPath("public_order_products", { id: "eq." + id, select: "*" }), {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!result.ok) return json({ error: result.error }, result.status);
    if (!result.data?.length) return json({ error: "Produto não encontrado." }, 404);
    return json({ ok: true, product: normalizeProduct(result.data[0]) });
  }
  if (request.method === "DELETE") {
    const result = await supabaseFetch(env, dbPath("public_order_products", { id: "eq." + id, select: "*" }), { method: "DELETE", headers: { Prefer: "return=representation" } });
    if (!result.ok) return json({ error: result.error }, result.status);
    if (!result.data?.length) return json({ error: "Produto não encontrado." }, 404);
    return json({ ok: true, product: normalizeProduct(result.data[0]) });
  }
  return json({ error: "Método não permitido." }, 405);
}

async function adminDeliveryRates(request, env) {
  const match = new URL(request.url).pathname.match(/^\/api\/admin\/delivery-rates\/(.+)$/);
  if (request.method === "GET") {
    const result = await supabaseFetch(env, dbPath("public_order_delivery_rates", { select: "*", active: "eq.true", order: "neighborhood.asc" }));
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ rates: result.data.map(rate => ({ neighborhood: rate.neighborhood, feeCents: Number(rate.fee_cents) })), updatedAt: new Date().toISOString() });
  }
  const parsed = await readJsonBody(request, 16 * 1024);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  if (request.method === "POST" && !match) {
    const neighborhood = String(parsed.value.neighborhood || "").trim();
    const feeCents = Math.round(Number(parsed.value.feeReais) * 100);
    if (!neighborhood || !Number.isFinite(feeCents) || feeCents < 0) return json({ error: "Informe bairro e valor de frete válido." }, 400);
    const result = await supabaseFetch(env, "/rest/v1/public_order_delivery_rates", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ neighborhood, fee_cents: feeCents, active: true }),
    });
    if (!result.ok) return json({ error: result.status === 409 ? "Este bairro já está cadastrado." : result.error }, result.status === 409 ? 409 : result.status);
    return json({ ok: true, rate: { neighborhood: result.data[0].neighborhood, feeCents: Number(result.data[0].fee_cents) } }, 201);
  }
  if (!match) return json({ error: "Rota não encontrada." }, 404);
  const oldName = decodeURIComponent(match[1]);
  if (request.method === "PATCH") {
    const nextName = typeof parsed.value.neighborhood === "string" ? parsed.value.neighborhood.trim() : oldName;
    const patch = {};
    if (nextName) patch.neighborhood = nextName;
    if (typeof parsed.value.feeReais !== "undefined") {
      const fee = Math.round(Number(parsed.value.feeReais) * 100);
      if (!Number.isFinite(fee) || fee < 0) return json({ error: "Valor de frete inválido." }, 400);
      patch.fee_cents = fee;
    }
    const result = await supabaseFetch(env, dbPath("public_order_delivery_rates", { neighborhood: "eq." + oldName, select: "*" }), {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!result.ok) return json({ error: result.error }, result.status);
    if (!result.data?.length) return json({ error: "Bairro não encontrado." }, 404);
    return json({ ok: true, rate: { neighborhood: result.data[0].neighborhood, feeCents: Number(result.data[0].fee_cents) } });
  }
  if (request.method === "DELETE") {
    const result = await supabaseFetch(env, dbPath("public_order_delivery_rates", { neighborhood: "eq." + oldName, select: "*" }), { method: "DELETE", headers: { Prefer: "return=representation" } });
    if (!result.ok) return json({ error: result.error }, result.status);
    if (!result.data?.length) return json({ error: "Bairro não encontrado." }, 404);
    return json({ ok: true, rate: result.data[0] });
  }
  return json({ error: "Método não permitido." }, 405);
}

async function adminStoreConfig(request, env) {
  const select = await supabaseFetch(env, dbPath("public_store_settings", { select: "*", id: "eq.true", limit: "1" }));
  if (!select.ok) return json({ error: select.error }, select.status);
  const current = select.data?.[0];
  if (!current) return json({ error: "Configuração da loja não encontrada." }, 404);
  if (request.method === "GET") {
    return json({
      heroImageDataUrl: current.hero_image_url || "",
      businessHours: current.business_hours || {},
      businessHoursEnabled: current.business_hours_enabled === true,
      acceptingOrders: current.accepting_orders === true,
      manualOpenOverride: current.manual_open_override ?? null,
      timeZone: current.time_zone || "America/Maceio",
      originAddress: current.origin_address || "",
      deliveryFallbackCents: Number(current.delivery_fallback_cents ?? 200),
      deliveryFallbackKm: Number(current.delivery_fallback_km ?? 3),
    });
  }
  const parsed = await readJsonBody(request, MAX_ADMIN_BYTES);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const input = parsed.value;
  const patch = {};
  if (typeof input.heroImageDataUrl === "string") {
    if (!input.heroImageDataUrl) patch.hero_image_url = null;
    else if (input.heroImageDataUrl.startsWith("data:image/")) {
      try { patch.hero_image_url = await uploadImage(env, input.heroImageDataUrl, "store"); }
      catch (error) { return json({ error: error.message }, 400); }
    } else if (/^https:\/\/[^ ]+$/i.test(input.heroImageDataUrl)) {
      patch.hero_image_url = input.heroImageDataUrl;
    } else return json({ error: "Imagem do banner inválida." }, 400);
  }
  if (Object.hasOwn(input, "businessHours")) {
    if (!input.businessHours || typeof input.businessHours !== "object" || Array.isArray(input.businessHours)) {
      return json({ error: "A configuração dos horários é inválida." }, 400);
    }
    const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const normalizedHours = {};
    for (const dayKey of dayKeys) {
      const day = input.businessHours[dayKey];
      if (!day || typeof day !== "object" || typeof day.closed !== "boolean") {
        return json({ error: "Informe os horários de todos os dias da semana." }, 400);
      }
      const open = String(day.open || "");
      const close = String(day.close || "");
      if (!day.closed && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(close) || open >= close)) {
        return json({ error: "Confira os horários: a abertura deve ser anterior ao fechamento." }, 400);
      }
      normalizedHours[dayKey] = { closed: day.closed, open: day.closed ? (open || "09:00") : open, close: day.closed ? (close || "18:00") : close };
    }
    patch.business_hours = normalizedHours;
    patch.business_hours_enabled = true;
  }
  if (typeof input.acceptingOrders !== "undefined") {
    if (typeof input.acceptingOrders !== "boolean") return json({ error: "O estado de recebimento de pedidos é inválido." }, 400);
    patch.accepting_orders = input.acceptingOrders;
  }
  if (Object.hasOwn(input, "manualOpenOverride")) {
    if (input.manualOpenOverride !== null && typeof input.manualOpenOverride !== "boolean") return json({ error: "O modo de abertura manual é inválido." }, 400);
    patch.manual_open_override = input.manualOpenOverride;
  }
  if (typeof input.originAddress === "string") patch.origin_address = input.originAddress.trim().slice(0, 300);
  if (typeof input.deliveryFallbackCents !== "undefined") {
    const value = Math.round(Number(input.deliveryFallbackCents));
    if (!Number.isFinite(value) || value < 0) return json({ error: "Valor de frete padrão inválido." }, 400);
    patch.delivery_fallback_cents = value;
  }
  if (typeof input.deliveryFallbackKm !== "undefined") {
    const value = Number(input.deliveryFallbackKm);
    if (!Number.isFinite(value) || value <= 0) return json({ error: "Distância padrão inválida." }, 400);
    patch.delivery_fallback_km = value;
  }
  if (!Object.keys(patch).length) return json({ ok: true });
  const updated = await supabaseFetch(env, dbPath("public_store_settings", { id: "eq.true", select: "*" }), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!updated.ok) return json({ error: updated.error }, updated.status);
  const saved = updated.data?.[0];
  if (!saved) return json({ error: "O banco não confirmou a atualização das configurações da loja." }, 500);
  return json({
    ok: true,
    config: {
      businessHours: saved.business_hours || {},
      businessHoursEnabled: saved.business_hours_enabled === true,
      acceptingOrders: saved.accepting_orders === true,
      manualOpenOverride: saved.manual_open_override ?? null,
      timeZone: saved.time_zone || "America/Maceio",
      originAddress: saved.origin_address || "",
      deliveryFallbackCents: Number(saved.delivery_fallback_cents ?? 200),
      deliveryFallbackKm: Number(saved.delivery_fallback_km ?? 3),
    },
  });
}

async function routeAdminApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/admin/login" && request.method === "POST") return adminLogin(request, env);
  if (url.pathname === "/api/admin/logout" && request.method === "POST") return withCookies(json({ ok: true }), clearAuthCookies());
  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    const context = await getAdminContext(request, env);
    return withCookies(json({ authenticated: Boolean(context.user) }), context.cookies);
  }
  const context = await getAdminContext(request, env);
  if (!context.user) return withCookies(json({ error: "Autenticação necessária." }, 401), clearAuthCookies());
  let response;
  if (url.pathname === "/api/admin/overview" && request.method === "GET") response = await adminOverview(env);
  else if (url.pathname === "/api/admin/orders" || /^\/api\/admin\/orders\/[^/]+$/.test(url.pathname)) response = await adminOrders(request, env);
  else if (url.pathname === "/api/admin/products" || /^\/api\/admin\/products\/[^/]+$/.test(url.pathname)) response = await adminProducts(request, env);
  else if (url.pathname === "/api/admin/delivery-rates" || /^\/api\/admin\/delivery-rates\/.+$/.test(url.pathname)) response = await adminDeliveryRates(request, env);
  else if (url.pathname === "/api/admin/store-config") response = await adminStoreConfig(request, env);
  else response = json({ error: "Rota não encontrada." }, 404);
  return withCookies(response, context.cookies);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/public-order/menu") {
      if (request.method !== "GET") return json({ error: "Método não permitido." }, 405, { allow: "GET" });
      return getPublicMenu(env);
    }
    if (url.pathname === "/api/public-order/orders") {
      if (request.method !== "POST") return json({ error: "Método não permitido." }, 405, { allow: "POST" });
      return createPublicOrder(request, env);
    }
    if (url.pathname.startsWith("/api/admin/")) return routeAdminApi(request, env);
    if (url.pathname === "/admin.js") {
      return new Response(ADMIN_APP_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    if (url.pathname === "/pedido.js") {
      return new Response(PUBLIC_ORDER_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    if (url.pathname === "/admin-login.js") {
      return new Response(ADMIN_LOGIN_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    if (url.pathname === "/admin-login" || url.pathname === "/admin-login.html") {
      return new Response(ADMIN_LOGIN_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    if (url.pathname === "/admin" || url.pathname === "/admin/" || url.pathname === "/admin.html") {
      const context = await getAdminContext(request, env);
      if (!context.user) {
        return withCookies(new Response(ADMIN_LOGIN_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }), context.cookies);
      }
      const assetRequest = new Request(new URL("/admin.html", request.url), request);
      return withCookies(await env.ASSETS.fetch(assetRequest), context.cookies);
    }
    if (url.pathname === "/pedido" || url.pathname === "/pedido/") {
      return env.ASSETS.fetch(new Request(new URL("/pedido.html", request.url), request));
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Rota não encontrada." }, 404);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not Found", { status: 404 });
  },
};
