"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
const ordersFile = path.join(root, "data/demo-orders.json");
const storeConfigFile = path.join(root, "data/store-config.json");
const menuFile = path.join(root, "data/menu.json");
const port = Number(process.env.PORT || 3000);

if (!fs.existsSync(ordersFile)) fs.writeFileSync(ordersFile, "[]");
if (!fs.existsSync(storeConfigFile)) fs.writeFileSync(storeConfigFile, JSON.stringify({
  heroImageDataUrl: "",
  originAddress: "",
  deliveryFallbackCents: 200,
  deliveryFallbackKm: 3,
  businessHours: {
    mon: { closed: false, open: "09:00", close: "18:00" },
    tue: { closed: false, open: "09:00", close: "18:00" },
    wed: { closed: false, open: "09:00", close: "18:00" },
    thu: { closed: false, open: "09:00", close: "18:00" },
    fri: { closed: false, open: "09:00", close: "18:00" },
    sat: { closed: false, open: "09:00", close: "14:00" },
    sun: { closed: true, open: "09:00", close: "18:00" },
  },
}, null, 2));
if (!fs.existsSync(menuFile)) fs.writeFileSync(menuFile, JSON.stringify({ storeName: "NS Gourmet", whatsapp: "", products: [], deliveryRates: [], businessHours: {} }, null, 2));

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const send = (res, status, data, type = "application/json; charset=utf-8") => {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
};
const readBody = async req => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};
const brl = cents => cents / 100;

function parseCookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) result[key] = decodeURIComponent(rest.join("="));
  }
  return result;
}

function signSession(username) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify({ username, expiresAt: Date.now() + 8 * 60 * 60 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function hasAdminSession(req) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return false;
  const cookie = parseCookies(req).nsg_admin;
  if (!cookie || !cookie.includes(".")) return false;
  const [payload, signature] = cookie.split(".");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.username === process.env.ADMIN_USER && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, { ok: true, mode: "local-demo", production: false });
  }

  if (req.method === "GET" && url.pathname === "/api/public-order/menu") {
    const menu = readJson(menuFile);
    const config = readJson(storeConfigFile);
    return send(res, 200, {
      ...menu,
      ...config,
      products: menu.products.filter(product => product.available !== false),
      demo: true,
    });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/session") {
    return send(res, 200, { authenticated: hasAdminSession(req) });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    try {
      const input = await readBody(req);
      const adminUser = process.env.ADMIN_USER;
      const adminPassword = process.env.ADMIN_PASSWORD;
      const sessionSecret = process.env.ADMIN_SESSION_SECRET;
      if (!adminUser || !adminPassword || !sessionSecret) {
        return send(res, 503, { error: "Acesso externo não configurado. Defina ADMIN_USER, ADMIN_PASSWORD e ADMIN_SESSION_SECRET no ambiente." });
      }
      if (input.username !== adminUser || input.password !== adminPassword) {
        return send(res, 401, { error: "Usuário ou senha incorretos." });
      }
      const session = signSession(adminUser);
      res.setHeader("Set-Cookie", `nsg_admin=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 60 * 60}`);
      return send(res, 200, { ok: true });
    } catch (error) {
      return send(res, 400, { error: "Não foi possível autenticar." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    res.setHeader("Set-Cookie", "nsg_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/store-config") {
    if (!hasAdminSession(req)) return send(res, 401, { error: "Autenticação necessária." });
    return send(res, 200, readJson(storeConfigFile));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/store-config") {
    if (!hasAdminSession(req)) return send(res, 401, { error: "Autenticação necessária." });
    try {
      const input = await readBody(req);
      const current = readJson(storeConfigFile);
      const heroImageDataUrl = typeof input.heroImageDataUrl === "string" ? input.heroImageDataUrl : current.heroImageDataUrl || "";
      if (heroImageDataUrl && !heroImageDataUrl.startsWith("data:image/")) {
        throw new Error("Selecione uma imagem válida.");
      }
      const next = { ...current };
      next.heroImageDataUrl = heroImageDataUrl;
      if (input.businessHours && typeof input.businessHours === "object") next.businessHours = input.businessHours;
      if (typeof input.originAddress === "string") next.originAddress = input.originAddress.trim();
      if (typeof input.deliveryFallbackCents !== "undefined") next.deliveryFallbackCents = Math.max(0, Math.round(Number(input.deliveryFallbackCents)));
      if (typeof input.deliveryFallbackKm !== "undefined") next.deliveryFallbackKm = Math.max(0.1, Number(input.deliveryFallbackKm));
      writeJson(storeConfigFile, next);
      return send(res, 200, { ok: true, ...next });
    } catch (error) {
      return send(res, 400, { error: error.message || "Configuração inválida." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/public-order/orders") {
    try {
      const input = await readBody(req);
      const menu = readJson(menuFile);
      const orders = readJson(ordersFile);
      if (!input.requestId || !input.customerName || !input.paymentMethod || !Array.isArray(input.items) || !input.items.length) {
        return send(res, 400, { error: "Preencha os dados obrigatórios e adicione produtos." });
      }

      const duplicate = orders.find(order => order.requestId === input.requestId);
      if (duplicate) {
        return send(res, 200, { ok: true, duplicate: true, demo: true, orderId: duplicate.orderId, totalCents: duplicate.totalCents });
      }

      const items = input.items.map(item => {
        const product = menu.products.find(candidate => candidate.id === item.productId && candidate.available);
        if (!product) throw new Error("Produto indisponível.");
        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Quantidade inválida.");
        return { name: product.name, quantity, unitPriceCents: product.unitPriceCents };
      });

      const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
      const rate = menu.deliveryRates.find(candidate => candidate.neighborhood === input.neighborhood);
      let fee = 0;
      if (input.fulfillmentType === "delivery") {
        if (rate) {
          fee = rate.feeCents;
        } else {
          const config = readJson(storeConfigFile);
          const distanceKm = Math.max(0, Number(input.distanceKm || 0));
          const fallbackCents = Number(config.deliveryFallbackCents ?? 200);
          const fallbackKm = Math.max(0.1, Number(config.deliveryFallbackKm ?? 3));
          fee = Math.ceil(distanceKm / fallbackKm) * fallbackCents;
        }
      }
      const order = {
        requestId: input.requestId,
        orderId: "demo-" + Date.now(),
        customerName: input.customerName,
        phone: input.phone || "",
        address: input.address || "",
        neighborhood: input.neighborhood || "",
        distanceKm: input.distanceKm ? Number(input.distanceKm) : null,
        fulfillmentType: input.fulfillmentType || "delivery",
        paymentMethod: input.paymentMethod,
        notes: input.notes || "",
        status: "novo",
        courier: "",
        deliveryConfirmedAt: null,
        items,
        subtotalCents: subtotal,
        deliveryFeeCents: fee,
        totalCents: subtotal + fee,
        createdAt: new Date().toISOString(),
      };
      orders.unshift(order);
      writeJson(ordersFile, orders);
      return send(res, 201, { ok: true, demo: true, orderId: order.orderId, totalCents: order.totalCents });
    } catch (error) {
      return send(res, 400, { error: error.message || "Pedido inválido." });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/admin/overview") {
    if (!hasAdminSession(req)) return send(res, 401, { error: "Autenticação necessária." });
    const orders = readJson(ordersFile);
    const menu = readJson(menuFile);
    const activeOrders = orders.filter(order => order.status !== "cancelado");
    const grossCents = activeOrders.reduce((sum, order) => sum + Number(order.totalCents || 0), 0);
    const deliveredOrders = activeOrders.filter(order => order.status === "entregue");
    const deliveredCents = deliveredOrders.reduce((sum, order) => sum + Number(order.totalCents || 0), 0);
    const paymentTotals = {};
    activeOrders.forEach(order => {
      const key = order.paymentMethod || "outros";
      paymentTotals[key] = (paymentTotals[key] || 0) + Number(order.totalCents || 0);
    });
    const toBrazilDate = value => new Date(new Date(value).getTime() - 3 * 60 * 60 * 1000);
    const now = toBrazilDate(new Date());
    const todayKey = now.toISOString().slice(0, 10);
    const monthKey = todayKey.slice(0, 7);
    const weekStart = new Date(now);
    const weekday = weekStart.getUTCDay();
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekday + 6) % 7));
    weekStart.setUTCHours(0, 0, 0, 0);
    const periodOrders = status => activeOrders.filter(order => {
      const date = toBrazilDate(order.createdAt || new Date());
      if (status === "daily") return date.toISOString().slice(0, 10) === todayKey;
      if (status === "monthly") return date.toISOString().slice(0, 7) === monthKey;
      return date >= weekStart;
    });
    const sumPeriod = list => list.reduce((sum, order) => sum + Number(order.totalCents || 0), 0);
    const productTotals = {};
    activeOrders.forEach(order => {
      (order.items || []).forEach(item => {
        const key = item.name || "Produto";
        productTotals[key] = (productTotals[key] || 0) + Number(item.quantity || 0);
      });
    });
    const topProducts = Object.entries(productTotals)
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 8);
    return send(res, 200, {
      totals: {
        grossCents,
        deliveredCents,
        orders: activeOrders.length,
        delivered: deliveredOrders.length,
        pending: activeOrders.filter(order => order.status !== "entregue").length,
        products: menu.products.length,
        availableProducts: menu.products.filter(product => product.available).length,
      },
      financePeriods: {
        dailyCents: sumPeriod(periodOrders("daily")),
        weeklyCents: sumPeriod(periodOrders("weekly")),
        monthlyCents: sumPeriod(periodOrders("monthly")),
      },
      topProducts,
      paymentTotals,
      orders,
      products: menu.products,
      updatedAt: new Date().toISOString(),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/orders") {
    if (!hasAdminSession(req)) return send(res, 401, { error: "Autenticação necessária." });
    return send(res, 200, { orders: readJson(ordersFile), updatedAt: new Date().toISOString() });
  }

  const orderMatch = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (orderMatch) {
    if (!hasAdminSession(req)) return send(res, 401, { error: "Autenticação necessária." });
    const orderId = decodeURIComponent(orderMatch[1]);
    const orders = readJson(ordersFile);
    const orderIndex = orders.findIndex(order => order.orderId === orderId);
    if (orderIndex < 0) return send(res, 404, { error: "Pedido não encontrado." });
    if (req.method === "PATCH") {
      try {
        const input = await readBody(req);
        const allowed = ["novo", "preparando", "pronto", "saiu_entrega", "entregue", "cancelado"];
        if (input.status && !allowed.includes(input.status)) throw new Error("Status inválido.");
        if (input.status) orders[orderIndex].status = input.status;
        if (typeof input.courier === "string") orders[orderIndex].courier = input.courier;
        if (input.status === "entregue") {
          orders[orderIndex].deliveryConfirmedAt = new Date().toISOString();
        } else if (input.status && input.status !== "entregue") {
          orders[orderIndex].deliveryConfirmedAt = null;
        }
        writeJson(ordersFile, orders);
        return send(res, 200, { ok: true, order: orders[orderIndex], updatedAt: new Date().toISOString() });
      } catch (error) {
        return send(res, 400, { error: error.message || "Não foi possível atualizar o pedido." });
      }
    }
  }

  if (req.method === "GET" && url.pathname === "/api/admin/products") {
    if (!hasAdminSession(req)) return send(res, 401, { error: "Autenticação necessária." });
    const menu = readJson(menuFile);
    return send(res, 200, { products: menu.products, updatedAt: new Date().toISOString() });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/products") {
    if (!hasAdminSession(req)) return send(res, 401, { error: "Autenticação necessária." });
    try {
      const input = await readBody(req);
      if (!input.name?.trim()) throw new Error("Informe o nome do produto.");
      const menu = readJson(menuFile);
      const product = {
        id: input.id?.trim() || "produto-" + Date.now(),
        name: input.name.trim(),
        description: input.description?.trim() || "",
        category: input.category?.trim() || "Sem categoria",
        unitPriceCents: Math.round(Number(input.priceReais || 0) * 100),
        available: input.available !== false,
        imageDataUrl: input.imageDataUrl || null,
      };
      if (menu.products.some(candidate => candidate.id === product.id)) throw new Error("Já existe um produto com este código.");
      menu.products.unshift(product);
      writeJson(menuFile, menu);
      return send(res, 201, { ok: true, product });
    } catch (error) {
      return send(res, 400, { error: error.message || "Não foi possível criar o produto." });
    }
  }

  const productMatch = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (productMatch) {
    if (!hasAdminSession(req)) return send(res, 401, { error: "Autenticação necessária." });
    const productId = decodeURIComponent(productMatch[1]);
    const menu = readJson(menuFile);
    const productIndex = menu.products.findIndex(product => product.id === productId);
    if (productIndex < 0) return send(res, 404, { error: "Produto não encontrado." });

    if (req.method === "PATCH") {
      try {
        const input = await readBody(req);
        const product = menu.products[productIndex];
        if (typeof input.name === "string") product.name = input.name.trim();
        if (typeof input.description === "string") product.description = input.description.trim();
        if (typeof input.category === "string") product.category = input.category.trim();
        if (typeof input.available === "boolean") product.available = input.available;
        if (typeof input.priceReais !== "undefined") product.unitPriceCents = Math.round(Number(input.priceReais) * 100);
        if (typeof input.unitPriceCents !== "undefined") product.unitPriceCents = Math.round(Number(input.unitPriceCents));
        if (typeof input.imageDataUrl === "string") product.imageDataUrl = input.imageDataUrl || null;
        writeJson(menuFile, menu);
        return send(res, 200, { ok: true, product });
      } catch (error) {
        return send(res, 400, { error: error.message || "Não foi possível atualizar o produto." });
      }
    }

    if (req.method === "DELETE") {
      const removed = menu.products.splice(productIndex, 1)[0];
      writeJson(menuFile, menu);
      return send(res, 200, { ok: true, product: removed });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/admin/delivery-rates") {
    if (!hasAdminSession(req)) return send(res, 401, { error: "Autenticação necessária." });
    const menu = readJson(menuFile);
    return send(res, 200, { rates: menu.deliveryRates || [], updatedAt: new Date().toISOString() });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/delivery-rates") {
    if (!hasAdminSession(req)) return send(res, 401, { error: "Autenticação necessária." });
    try {
      const input = await readBody(req);
      const neighborhood = String(input.neighborhood || "").trim();
      const feeCents = Math.max(0, Math.round(Number(input.feeReais || 0) * 100));
      if (!neighborhood) throw new Error("Informe o nome do bairro.");
      const menu = readJson(menuFile);
      menu.deliveryRates = menu.deliveryRates || [];
      if (menu.deliveryRates.some(rate => rate.neighborhood.toLowerCase() === neighborhood.toLowerCase())) {
        throw new Error("Este bairro já está cadastrado.");
      }
      const rate = { neighborhood, feeCents };
      menu.deliveryRates.push(rate);
      menu.deliveryRates.sort((a, b) => a.neighborhood.localeCompare(b.neighborhood, "pt-BR"));
      writeJson(menuFile, menu);
      return send(res, 201, { ok: true, rate });
    } catch (error) {
      return send(res, 400, { error: error.message || "Não foi possível cadastrar o bairro." });
    }
  }

  const rateMatch = url.pathname.match(/^\/api\/admin\/delivery-rates\/([^/]+)$/);
  if (rateMatch) {
    if (!hasAdminSession(req)) return send(res, 401, { error: "Autenticação necessária." });
    const neighborhood = decodeURIComponent(rateMatch[1]);
    const menu = readJson(menuFile);
    menu.deliveryRates = menu.deliveryRates || [];
    const rateIndex = menu.deliveryRates.findIndex(rate => rate.neighborhood === neighborhood);
    if (rateIndex < 0) return send(res, 404, { error: "Bairro não encontrado." });

    if (req.method === "PATCH") {
      try {
        const input = await readBody(req);
        const nextName = typeof input.neighborhood === "string" ? input.neighborhood.trim() : menu.deliveryRates[rateIndex].neighborhood;
        if (!nextName) throw new Error("Informe o nome do bairro.");
        if (typeof input.feeReais !== "undefined") {
          menu.deliveryRates[rateIndex].feeCents = Math.max(0, Math.round(Number(input.feeReais) * 100));
        }
        menu.deliveryRates[rateIndex].neighborhood = nextName;
        writeJson(menuFile, menu);
        return send(res, 200, { ok: true, rate: menu.deliveryRates[rateIndex] });
      } catch (error) {
        return send(res, 400, { error: error.message || "Não foi possível atualizar o bairro." });
      }
    }

    if (req.method === "DELETE") {
      const removed = menu.deliveryRates.splice(rateIndex, 1)[0];
      writeJson(menuFile, menu);
      return send(res, 200, { ok: true, rate: removed });
    }
  }

  const files = {
    "/pedido": "pedido.html",
    "/": "pedido.html",
    "/pedido.css": "pedido.css",
    "/pedido.js": "pedido.js",
    "/favicon.svg": "favicon.svg",
    "/admin": "admin.html",
    "/admin.css": "admin.css",
    "/admin.js": "admin.js",
  };
  if (req.method === "GET" && files[url.pathname]) {
    if (url.pathname === "/admin" && !hasAdminSession(req)) {
      const loginFile = path.join(root, "admin-login.html");
      if (fs.existsSync(loginFile)) return send(res, 200, fs.readFileSync(loginFile), "text/html; charset=utf-8");
    }
    const file = path.join(root, files[url.pathname]);
    const ext = path.extname(file);
    const type = ext === ".css" ? "text/css; charset=utf-8"
      : ext === ".js" ? "text/javascript; charset=utf-8"
      : ext === ".svg" ? "image/svg+xml"
      : "text/html; charset=utf-8";
    return send(res, 200, fs.readFileSync(file), type);
  }

  return send(res, 404, { error: "Not found" });
});

server.listen(port, () => console.log("NS Gourmet local: http://localhost:" + port + "/pedido"));
