const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const MAX_ORDER_BYTES = 32 * 1024;
const MAX_ADMIN_BYTES = 3 * 1024 * 1024;
const ADMIN_EMAIL = "ns_gourmet@profissional.com";
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
  if (input.businessHours && typeof input.businessHours === "object" && !Array.isArray(input.businessHours)) {
    patch.business_hours = input.businessHours;
    patch.business_hours_enabled = true;
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
  return json({ ok: true });
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
    if (url.pathname === "/admin" || url.pathname === "/admin/" || url.pathname === "/admin.html") {
      const context = await getAdminContext(request, env);
      const target = context.user ? "/admin.html" : "/admin-login.html";
      const assetRequest = new Request(new URL(target, request.url), request);
      return withCookies(await env.ASSETS.fetch(assetRequest), context.cookies);
    }
    if (url.pathname === "/admin-login") return env.ASSETS.fetch(new Request(new URL("/admin-login.html", request.url), request));
    if (url.pathname === "/pedido" || url.pathname === "/pedido/") {
      return env.ASSETS.fetch(new Request(new URL("/pedido.html", request.url), request));
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Rota não encontrada." }, 404);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not Found", { status: 404 });
  },
};
