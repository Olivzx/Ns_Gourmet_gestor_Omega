const ADMIN_EMAIL = "ns_gourmet@profissional.com";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function isConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
async function supabaseRpc(env, functionName, payload = {}) {
  if (!isConfigured(env)) {
    const error = new Error("A integração com o banco ainda não foi configurada.");
    error.status = 503;
    throw error;
  }
  const base = String(env.SUPABASE_URL).replace(/\/$/, "");
  const response = await fetch(base + "/rest/v1/rpc/" + encodeURIComponent(functionName), {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(typeof body?.message === "string" ? body.message : "");
    error.status = response.status; error.databaseCode = body?.code; throw error;
  }
  return body;
}
async function supabaseRest(env, path, method = "GET", body, bearer) {
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: "Bearer " + (bearer || env.SUPABASE_SERVICE_ROLE_KEY), accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers.prefer = "return=representation,resolution=merge-duplicates";
  const response = await fetch(String(env.SUPABASE_URL).replace(/\/$/, "") + "/rest/v1/" + path, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text();
  const parsed = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
  if (!response.ok) {
    const error = new Error(parsed?.message || parsed?.hint || "Falha ao acessar os dados da loja.");
    error.status = response.status; throw error;
  }
  return parsed;
}
async function authUser(env, accessToken) {
  const response = await fetch(String(env.SUPABASE_URL).replace(/\/$/, "") + "/auth/v1/user", {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + accessToken }
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}
async function requireAdmin(request, env) {
  if (!isConfigured(env) || !ADMIN_EMAIL) return { error: json({ error: "O acesso administrativo ainda não foi configurado no Worker." }, 503) };
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { error: json({ error: "Faça login para continuar." }, 401) };
  const user = await authUser(env, token);
  if (!user?.id || String(user.email || "").toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return { error: json({ error: "Sessão inválida ou conta sem permissão administrativa." }, 401) };
  }
  return { user };
}
async function handleAdmin(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (!isConfigured(env)) return json({ error: "Integração com Supabase indisponível." }, 503);
  if (path === "/api/admin/login" && request.method === "POST") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Informe e-mail e senha." }, 400); }
    const email = String(input?.email || "").trim().toLowerCase();
    const password = typeof input?.password === "string" ? input.password : "";
    if (email !== ADMIN_EMAIL.toLowerCase() || !password) return json({ error: "E-mail ou senha incorretos." }, 401);
    const response = await fetch(String(env.SUPABASE_URL).replace(/\/$/, "") + "/auth/v1/token?grant_type=password", {
      method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
        "content-type": "application/json" }, body: JSON.stringify({ email, password })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token || String(result.user?.email || "").toLowerCase() !== email) {
      return json({ error: "Não foi possível autenticar. Confira a conta administrativa criada no Supabase." }, 401);
    }
    return json({ access_token: result.access_token, expires_in: result.expires_in, user: { id: result.user.id, email: result.user.email } });
  }
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  try {
    if (path === "/api/admin/me" && request.method === "GET") return json({ user: { id: auth.user.id, email: auth.user.email } });
    if (path === "/api/admin/data" && request.method === "GET") {
      const [orders, products, settings, rates, finance, categories, inventory, movements] = await Promise.all([
        supabaseRest(env, "public_orders?select=*,public_order_items(*)&order=created_at.desc&limit=300"),
        supabaseRest(env, "public_order_products?select=*&order=category.asc,name.asc"),
        supabaseRest(env, "public_store_settings?select=*&id=eq.true&limit=1"),
        supabaseRest(env, "public_order_delivery_rates?select=*&order=neighborhood.asc"),
        supabaseRest(env, "admin_finance_entries?select=*,admin_finance_categories(id,name,kind)&order=due_date.desc,created_at.desc&limit=500"),
        supabaseRest(env, "admin_finance_categories?select=*&active=eq.true&order=kind.asc,name.asc"),
        supabaseRest(env, "admin_inventory_items?select=*&order=active.desc,name.asc"),
        supabaseRest(env, "admin_stock_movements?select=*,admin_inventory_items(name,unit)&order=created_at.desc&limit=80")
      ]);
      return json({
        orders: orders || [], products: products || [], settings: settings?.[0] || null,
        rates: rates || [], finance: finance || [], categories: categories || [],
        inventory: inventory || [], movements: movements || []
      });
    }
    let match = path.match(/^\/api\/admin\/orders\/([0-9a-f-]+)\/payment$/i);
    if (match && request.method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      if (!["pending","paid","refunded"].includes(body.payment_status)) return json({ error: "Situação de pagamento inválida." }, 400);
      const result = await supabaseRpc(env, "admin_set_order_payment_status", {
        p_order_id: match[1], p_status: body.payment_status
      });
      return json({ ok: true, payment: result });
    }
    match = path.match(/^\/api\/admin\/orders\/([0-9a-f-]+)$/i);
    if (match && request.method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      const allowed = ["received","preparing","ready","out_for_delivery","completed","cancelled"];
      if (!allowed.includes(body.status)) return json({ error: "Status de pedido inválido." }, 400);
      const result = await supabaseRest(env, "public_orders?id=eq." + encodeURIComponent(match[1]), "PATCH", { status: body.status });
      if (!result?.length) return json({ error: "Pedido não encontrado." }, 404);
      return json({ ok: true, order: result[0] });
    }
    if (path === "/api/admin/products" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (!body.id || !body.name || !body.category || !Number.isSafeInteger(body.unit_price_cents) || body.unit_price_cents < 0 || !Number.isSafeInteger(Number(body.cost_price_cents || 0)) || Number(body.cost_price_cents || 0) < 0) return json({ error: "Preencha nome, categoria e preços válidos." }, 400);
      const prep = body.prep_minutes === null || body.prep_minutes === "" || body.prep_minutes === undefined ? null : Number(body.prep_minutes);
      if (prep !== null && (!Number.isInteger(prep) || prep < 0)) return json({ error: "Tempo de preparo inválido." }, 400);
      const result = await supabaseRest(env, "public_order_products", "POST", {
        id: String(body.id).slice(0,120), name: String(body.name).trim().slice(0,120),
        category: String(body.category).trim().slice(0,60), description: String(body.description || "").slice(0,600),
        sku: body.sku ? String(body.sku).trim().slice(0,60) : null,
        unit_price_cents: body.unit_price_cents, cost_price_cents: Number(body.cost_price_cents || 0),
        prep_minutes: prep, image_url: body.image_url || null, available: body.available !== false
      });
      return json({ ok: true, product: result?.[0] }, 201);
    }
    match = path.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (match && request.method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      const prep = body.prep_minutes === null || body.prep_minutes === "" || body.prep_minutes === undefined ? null : Number(body.prep_minutes);
      const update = {
        name: String(body.name || "").trim().slice(0,120), category: String(body.category || "").trim().slice(0,60),
        description: String(body.description || "").slice(0,600), sku: body.sku ? String(body.sku).trim().slice(0,60) : null,
        unit_price_cents: Number(body.unit_price_cents), cost_price_cents: Number(body.cost_price_cents || 0),
        prep_minutes: prep, image_url: body.image_url || null, available: body.available !== false
      };
      if (!update.name || !update.category || !Number.isSafeInteger(update.unit_price_cents) || update.unit_price_cents < 0 ||
          !Number.isSafeInteger(update.cost_price_cents) || update.cost_price_cents < 0 ||
          (prep !== null && (!Number.isInteger(prep) || prep < 0))) return json({ error: "Dados do produto inválidos." }, 400);
      const result = await supabaseRest(env, "public_order_products?id=eq." + encodeURIComponent(match[1]), "PATCH", update);
      if (!result?.length) return json({ error: "Produto não encontrado." }, 404);
      return json({ ok: true, product: result[0] });
    }
    if (match && request.method === "DELETE") {
      await supabaseRest(env, "public_order_products?id=eq." + encodeURIComponent(match[1]), "DELETE");
      return json({ ok: true });
    }
    if (path === "/api/admin/settings" && request.method === "PUT") {
      const body = await request.json().catch(() => ({}));
      if (!String(body.store_name || "").trim()) return json({ error: "Informe o nome da loja." }, 400);
      const result = await supabaseRest(env, "public_store_settings?on_conflict=id", "POST", {
        id: true, store_name: String(body.store_name).trim().slice(0,100), whatsapp: String(body.whatsapp || "").replace(/\D/g,"").slice(0,20),
        accepting_orders: body.accepting_orders === true, business_hours_enabled: body.business_hours_enabled === true,
        business_hours: body.business_hours && typeof body.business_hours === "object" ? body.business_hours : {},
        time_zone: String(body.time_zone || "America/Maceio").slice(0,80), updated_at: new Date().toISOString()
      });
      return json({ ok: true, settings: result?.[0] });
    }
    if (path === "/api/admin/rates" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (!String(body.neighborhood || "").trim() || !Number.isSafeInteger(body.fee_cents) || body.fee_cents < 0) return json({ error: "Informe bairro e taxa válida." }, 400);
      const result = await supabaseRest(env, "public_order_delivery_rates?on_conflict=neighborhood", "POST", { neighborhood: String(body.neighborhood).trim().slice(0,100), fee_cents: body.fee_cents, active: body.active !== false });
      return json({ ok: true, rate: result?.[0] }, 201);
    }
    match = path.match(/^\/api\/admin\/rates\/([^/]+)$/);
    if (match && request.method === "DELETE") {
      await supabaseRest(env, "public_order_delivery_rates?neighborhood=eq." + encodeURIComponent(decodeURIComponent(match[1])), "DELETE");
      return json({ ok: true });
    }
    if (path === "/api/admin/finance/entries" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const validKind = ["income","expense"].includes(body.kind);
      const amount = Number(body.amount_cents);
      const validStatus = ["pending","paid"].includes(body.status || "paid");
      if (!validKind || !body.category_id || !String(body.description || "").trim() ||
          !Number.isSafeInteger(amount) || amount <= 0 || !validStatus) {
        return json({ error: "Informe tipo, categoria, descrição, valor e situação válidos." }, 400);
      }
      const paid = (body.status || "paid") === "paid";
      const result = await supabaseRest(env, "admin_finance_entries", "POST", {
        kind: body.kind, category_id: body.category_id, description: String(body.description).trim().slice(0,180),
        amount_cents: amount, status: paid ? "paid" : "pending",
        due_date: body.due_date || new Date().toISOString().slice(0,10),
        paid_at: paid ? new Date().toISOString() : null,
        payment_method: body.payment_method || null, notes: body.notes ? String(body.notes).slice(0,1000) : null
      });
      return json({ ok: true, entry: result?.[0] }, 201);
    }
    match = path.match(/^\/api\/admin\/finance\/entries\/([0-9a-f-]+)$/i);
    if (match && request.method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      if (!["pending","paid","void"].includes(body.status)) return json({ error: "Situação financeira inválida." }, 400);
      const update = { status: body.status, paid_at: body.status === "paid" ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
      const result = await supabaseRest(env, "admin_finance_entries?id=eq." + encodeURIComponent(match[1]) + "&source_order_id=is.null", "PATCH", update);
      if (!result?.length) return json({ error: "Lançamento manual não encontrado." }, 404);
      return json({ ok: true, entry: result[0] });
    }
    if (path === "/api/admin/inventory/items" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const min = Number(body.minimum_quantity || 0), cost = Number(body.unit_cost_cents || 0);
      if (!String(body.name || "").trim() || !String(body.unit || "").trim() || !Number.isFinite(min) || min < 0 ||
          !Number.isSafeInteger(cost) || cost < 0) return json({ error: "Informe nome, unidade e valores válidos." }, 400);
      const result = await supabaseRest(env, "admin_inventory_items", "POST", {
        name: String(body.name).trim().slice(0,120), unit: String(body.unit).slice(0,12),
        minimum_quantity: min, unit_cost_cents: cost, quantity_on_hand: 0,
        notes: body.notes ? String(body.notes).slice(0,1000) : null, active: true
      });
      return json({ ok: true, item: result?.[0] }, 201);
    }
    match = path.match(/^\/api\/admin\/inventory\/items\/([0-9a-f-]+)$/i);
    if (match && request.method === "PATCH") {
      const body = await request.json().catch(() => ({})), update = {};
      if (body.name !== undefined) update.name = String(body.name).trim().slice(0,120);
      if (body.unit !== undefined) update.unit = String(body.unit).slice(0,12);
      if (body.minimum_quantity !== undefined) update.minimum_quantity = Number(body.minimum_quantity);
      if (body.unit_cost_cents !== undefined) update.unit_cost_cents = Number(body.unit_cost_cents);
      if (body.notes !== undefined) update.notes = body.notes ? String(body.notes).slice(0,1000) : null;
      if (body.active !== undefined) update.active = body.active === true;
      update.updated_at = new Date().toISOString();
      if (update.minimum_quantity !== undefined && (!Number.isFinite(update.minimum_quantity) || update.minimum_quantity < 0)) return json({ error: "Estoque mínimo inválido." }, 400);
      if (update.unit_cost_cents !== undefined && (!Number.isSafeInteger(update.unit_cost_cents) || update.unit_cost_cents < 0)) return json({ error: "Custo unitário inválido." }, 400);
      const result = await supabaseRest(env, "admin_inventory_items?id=eq." + encodeURIComponent(match[1]), "PATCH", update);
      if (!result?.length) return json({ error: "Item de estoque não encontrado." }, 404);
      return json({ ok: true, item: result[0] });
    }
    if (path === "/api/admin/inventory/movements" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const quantity = Number(body.quantity), allowed = ["in","out","adjustment"];
      if (!body.item_id || !allowed.includes(body.movement_type) || !Number.isFinite(quantity) || quantity <= 0 ||
          !String(body.reason || "").trim()) return json({ error: "Informe item, tipo, quantidade e motivo válidos." }, 400);
      const result = await supabaseRest(env, "admin_stock_movements", "POST", {
        item_id: body.item_id, movement_type: body.movement_type, quantity,
        reason: String(body.reason).trim().slice(0,160),
        notes: body.notes ? String(body.notes).slice(0,1000) : null
      });
      return json({ ok: true, movement: result?.[0] }, 201);
    }
    return json({ error: "Rota administrativa não encontrada." }, 404);
  } catch (error) {
    return json({ error: error.message || "Falha ao processar solicitação administrativa." }, error.status && error.status < 500 ? error.status : 502);
  }
}
function publicHours(menu) {
  const source = menu?.businessHours || {}, schedule = source.schedule && typeof source.schedule === "object" ? source.schedule : source;
  const days = {};
  for (const key of ["mon","tue","wed","thu","fri","sat","sun"]) {
    const item = schedule[key] || {};
    days[key] = { enabled: item.closed !== true && Boolean(item.open && item.close), open: item.open || "", close: item.close || "" };
  }
  return { ...source, days };
}
async function handleMenu(env) {
  try {
    const menu = await supabaseRpc(env, "public_order_menu");
    if (!menu || typeof menu !== "object" || Array.isArray(menu)) return json({ error: "O banco retornou um cardápio inválido." }, 502);
    return json({ ...menu, businessHours: publicHours(menu), demo: false });
  } catch (error) {
    if (error.status === 503) return json({ error: error.message }, 503);
    return json({ error: "Não foi possível carregar o cardápio agora." }, 502);
  }
}
async function handleOrder(request, env) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ error: "Envie o pedido em formato JSON." }, 415);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 65536) return json({ error: "O pedido excede o tamanho permitido." }, 413);
  let order;
  try { order = await request.json(); } catch { return json({ error: "O pedido precisa estar em formato JSON válido." }, 400); }
  if (!order || typeof order !== "object" || Array.isArray(order)) return json({ error: "Dados do pedido inválidos." }, 400);
  try {
    const result = await supabaseRpc(env, "create_public_order", { p_order: order });
    return json({ ok: true, demo: false, orderId: result?.orderId, totalCents: result?.totalCents, duplicate: Boolean(result?.duplicate) }, result?.duplicate ? 200 : 201);
  } catch (error) {
    if (error.status === 503) return json({ error: error.message }, 503);
    const message = String(error.message || "");
    if (/fora do horário|não está aceitando pedidos|loja está fechada/i.test(message)) return json({ error: message, code: "STORE_CLOSED" }, 409);
    if (error.databaseCode === "P0001" || (error.status >= 400 && error.status < 500)) return json({ error: message || "Os dados do pedido são inválidos." }, 400);
    return json({ error: "Não foi possível registrar o pedido agora." }, 502);
  }
}
async function handleHealth(env) {
  if (!isConfigured(env)) return json({ ok: false, production: true, databaseConfigured: false, database: "not_configured" }, 503);
  try { await supabaseRpc(env, "public_order_menu"); return json({ ok: true, production: true, databaseConfigured: true, database: "reachable" }); }
  catch { return json({ ok: false, production: true, databaseConfigured: true, database: "unavailable" }, 503); }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/api/health") return request.method === "GET" ? handleHealth(env) : json({ error: "Método não permitido." }, 405);
    if (path.startsWith("/api/admin/")) return handleAdmin(request, env);
    if (path === "/api/public-order/menu") return request.method === "GET" ? handleMenu(env) : json({ error: "Método não permitido." }, 405);
    if (path === "/api/public-order/orders") return request.method === "POST" ? handleOrder(request, env) : json({ error: "Método não permitido." }, 405);
    if ((path === "/" || path === "/pedido") && request.method === "GET") {
      const target = new URL("/pedido.html", request.url);
      return env.ASSETS.fetch(new Request(target, { method: "GET", headers: request.headers }));
    }
    if (path === "/admin" && request.method === "GET") {
      const target = new URL("/admin.html", request.url);
      return env.ASSETS.fetch(new Request(target, { method: "GET", headers: request.headers }));
    }
    return env.ASSETS.fetch(request);
  }
};