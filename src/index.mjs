const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const MAX_ORDER_BYTES = 32 * 1024;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
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

async function readOrder(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { error: "Envie o pedido em formato JSON.", status: 415 };
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_ORDER_BYTES) {
    return { error: "O pedido excede o tamanho permitido.", status: 413 };
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_ORDER_BYTES) {
    return { error: "O pedido excede o tamanho permitido.", status: 413 };
  }

  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "Dados do pedido inválidos.", status: 400 };
    }
    return { value };
  } catch {
    return { error: "O pedido precisa estar em formato JSON válido.", status: 400 };
  }
}

function getSupabaseConfig(env) {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { error: "A integração com o banco ainda não foi configurada." };
  }

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

async function callSupabaseRpc(env, functionName, payload = {}) {
  const config = getSupabaseConfig(env);
  if (config.error) {
    return { ok: false, status: 503, error: config.error };
  }

  try {
    const response = await fetch(
      config.url + "/rest/v1/rpc/" + encodeURIComponent(functionName),
      {
        method: "POST",
        headers: {
          apikey: config.key,
          authorization: "Bearer " + config.key,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const validationError = response.status === 400 || response.status === 422;
      return {
        ok: false,
        status: validationError ? 400 : response.status === 401 || response.status === 403 || response.status === 429 ? 503 : 502,
        error: validationError
          ? errorMessage(result?.message, "Não foi possível validar a solicitação.")
          : "Não foi possível acessar o banco de dados agora.",
      };
    }

    return { ok: true, data: result };
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Não foi possível conectar ao banco de dados agora.",
    };
  }
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
  if (!isSameOrigin(request)) {
    return json({ error: "Origem da solicitação não permitida." }, 403);
  }

  const parsed = await readOrder(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);

  if (!env.PUBLIC_ORDER_LIMITER) {
    return json({ error: "A proteção contra excesso de pedidos não está configurada." }, 503);
  }

  try {
    const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
    const limit = await env.PUBLIC_ORDER_LIMITER.limit({ key: clientIp });
    if (!limit.success) {
      return json(
        { error: "Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente." },
        429,
        { "retry-after": "60" },
      );
    }
  } catch {
    return json({ error: "Não foi possível validar a solicitação agora." }, 503);
  }

  const result = await callSupabaseRpc(env, "create_public_order", {
    p_order: parsed.value,
  });
  if (!result.ok) return json({ error: result.error }, result.status);

  const order = result.data;
  if (!order || typeof order !== "object" || !order.orderId) {
    return json({ error: "O banco retornou uma confirmação de pedido inválida." }, 502);
  }

  return json({
    ok: true,
    demo: false,
    orderId: order.orderId,
    totalCents: order.totalCents,
    duplicate: Boolean(order.duplicate),
  }, order.duplicate ? 200 : 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/public-order/menu") {
      if (request.method !== "GET") {
        return json(
          { error: "Método não permitido." },
          405,
          { allow: "GET" },
        );
      }
      return getPublicMenu(env);
    }

    if (url.pathname === "/api/public-order/orders") {
      if (request.method !== "POST") {
        return json(
          { error: "Método não permitido." },
          405,
          { allow: "POST" },
        );
      }
      return createPublicOrder(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Rota não encontrada." }, 404);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not Found", { status: 404 });
  },
};
