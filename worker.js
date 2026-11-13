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

  const base = String(env.SUPABASE_URL).replace(/\\/$/, "");
  const response = await fetch(
    base + "/rest/v1/rpc/" + encodeURIComponent(functionName),
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : "";
    const error = new Error(message);
    error.status = response.status;
    error.databaseCode = body?.code;
    throw error;
  }
  return body;
}

function publicHours(menu) {
  const source = menu?.businessHours || {};
  const schedule = source.schedule && typeof source.schedule === "object"
    ? source.schedule
    : {};
  const days = {};

  for (const key of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
    const item = schedule[key] || {};
    days[key] = {
      enabled: item.closed !== true && Boolean(item.open && item.close),
      open: item.open || "",
      close: item.close || ""
    };
  }

  return {
    ...source,
    days
  };
}

async function handleMenu(env) {
  try {
    const menu = await supabaseRpc(env, "public_order_menu");
    if (!menu || typeof menu !== "object" || Array.isArray(menu)) {
      return json({ error: "O banco retornou um cardápio inválido." }, 502);
    }
    return json({
      ...menu,
      businessHours: publicHours(menu),
      demo: false
    });
  } catch (error) {
    if (error.status === 503) return json({ error: error.message }, 503);
    return json({ error: "Não foi possível carregar o cardápio agora." }, 502);
  }
}

async function handleOrder(request, env) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ error: "Envie o pedido em formato JSON." }, 415);
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > 65536) return json({ error: "O pedido excede o tamanho permitido." }, 413);

  let order;
  try {
    order = await request.json();
  } catch {
    return json({ error: "O pedido precisa estar em formato JSON válido." }, 400);
  }
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    return json({ error: "Dados do pedido inválidos." }, 400);
  }

  try {
    const result = await supabaseRpc(env, "create_public_order", { p_order: order });
    return json({
      ok: true,
      demo: false,
      orderId: result?.orderId,
      totalCents: result?.totalCents,
      duplicate: Boolean(result?.duplicate)
    }, result?.duplicate ? 200 : 201);
  } catch (error) {
    if (error.status === 503) return json({ error: error.message }, 503);

    const message = String(error.message || "");
    if (/fora do horário|não está aceitando pedidos|loja está fechada/i.test(message)) {
      return json({
        error: message,
        code: "STORE_CLOSED"
      }, 409);
    }

    if (error.databaseCode === "P0001" || (error.status >= 400 && error.status < 500)) {
      return json({ error: message || "Os dados do pedido são inválidos." }, 400);
    }
    return json({ error: "Não foi possível registrar o pedido agora." }, 502);
  }
}

async function handleHealth(env) {
  if (!isConfigured(env)) {
    return json({ ok: false, production: true, databaseConfigured: false, database: "not_configured" }, 503);
  }
  try {
    await supabaseRpc(env, "public_order_menu");
    return json({ ok: true, production: true, databaseConfigured: true, database: "reachable" });
  } catch {
    return json({ ok: false, production: true, databaseConfigured: true, database: "unavailable" }, 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") {
      if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
      return handleHealth(env);
    }

    if (path === "/api/public-order/menu") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Método não permitido." }), {
          status: 405,
          headers: { ...JSON_HEADERS, allow: "GET" }
        });
      }
      return handleMenu(env);
    }

    if (path === "/api/public-order/orders") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Método não permitido." }), {
          status: 405,
          headers: { ...JSON_HEADERS, allow: "POST" }
        });
      }
      return handleOrder(request, env);
    }

    if ((path === "/" || path === "/pedido") && request.method === "GET") {
      const target = new URL("/pedido.html", request.url);
      return env.ASSETS.fetch(new Request(target, {
        method: "GET",
        headers: request.headers
      }));
    }

    return env.ASSETS.fetch(request);
  }
};
