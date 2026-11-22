import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-secret",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable",
  PUBLIC_ORDER_LIMITER: { async limit() { return { success: true }; } },
};

function request(path, options = {}) {
  return new Request("https://nsgourmet.test" + path, options);
}

test("menu endpoint accepts GET and calls the existing Supabase RPC", async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options };
    return Response.json({
      storeName: "NS Gourmet",
      products: [],
      deliveryRates: [],
      businessHours: { enabled: true, isOpen: true },
    });
  };

  try {
    const response = await worker.fetch(request("/api/public-order/menu"), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.storeName, "NS Gourmet");
    assert.equal(body.demo, false);
    assert.equal(call.url, "https://example.supabase.co/rest/v1/rpc/public_order_menu");
    assert.equal(call.options.headers.apikey, "test-secret");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("menu endpoint rejects methods other than GET", async () => {
  const response = await worker.fetch(request("/api/public-order/menu", { method: "POST" }), env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
});

test("order endpoint rejects cross-origin requests before contacting Supabase", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Supabase should not be called"); };

  try {
    const response = await worker.fetch(request("/api/public-order/orders", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({}),
    }), env);
    assert.equal(response.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("order endpoint rejects malformed JSON", async () => {
  const response = await worker.fetch(request("/api/public-order/orders", {
    method: "POST",
    headers: { origin: "https://nsgourmet.test", "content-type": "application/json" },
    body: "{",
  }), env);
  assert.equal(response.status, 400);
});

test("order endpoint rejects unsupported content types", async () => {
  const response = await worker.fetch(request("/api/public-order/orders", {
    method: "POST",
    headers: { origin: "https://nsgourmet.test", "content-type": "text/plain" },
    body: "{}",
  }), env);
  assert.equal(response.status, 415);
});

test("order endpoint forwards the order to the existing create_public_order RPC", async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options };
    return Response.json({ orderId: "order-123", totalCents: 5900, duplicate: false });
  };

  const payload = {
    requestId: "c1a0c0b2-64f7-4f47-8fd8-83f4e7e3c900",
    customerName: "Cliente de teste",
    fulfillmentType: "pickup",
    paymentMethod: "pix",
    items: [{ productId: "item-1", quantity: 1 }],
  };

  try {
    const response = await worker.fetch(request("/api/public-order/orders", {
      method: "POST",
      headers: { origin: "https://nsgourmet.test", "content-type": "application/json" },
      body: JSON.stringify(payload),
    }), env);
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.orderId, "order-123");
    assert.equal(body.totalCents, 5900);
    assert.equal(body.demo, false);
    assert.equal(call.url, "https://example.supabase.co/rest/v1/rpc/create_public_order");
    assert.deepEqual(JSON.parse(call.options.body), { p_order: payload });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("order endpoint returns a controlled error when Supabase secrets are missing", async () => {
  const response = await worker.fetch(request("/api/public-order/orders", {
    method: "POST",
    headers: { origin: "https://nsgourmet.test", "content-type": "application/json" },
    body: JSON.stringify({ requestId: "test" }),
  }), {
    PUBLIC_ORDER_LIMITER: { async limit() { return { success: true }; } },
  });
  assert.equal(response.status, 503);
  assert.match((await response.clone().json()).error, /banco ainda não foi configurada/i);
});

test("unknown API routes return JSON 404", async () => {
  const response = await worker.fetch(request("/api/not-real"), env);
  assert.equal(response.status, 404);
});

test("order endpoint blocks requests when the per-IP rate limit is exceeded", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Supabase should not be called"); };
  const limitedEnv = {
    ...env,
    PUBLIC_ORDER_LIMITER: { async limit() { return { success: false }; } },
  };

  try {
    const response = await worker.fetch(request("/api/public-order/orders", {
      method: "POST",
      headers: {
        origin: "https://nsgourmet.test",
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.10",
      },
      body: JSON.stringify({ requestId: "test" }),
    }), limitedEnv);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("admin API is protected when no authenticated Supabase session exists", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No session token should be checked"); };
  try {
    const response = await worker.fetch(request("/api/admin/overview"), env);
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /autenticação necessária/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin login delegates password verification to Supabase Auth", async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url: String(url), options };
    return Response.json({
      access_token: "access-test",
      refresh_token: "refresh-test",
      expires_in: 3600,
      user: { email: "ns_gourmet@profissional.com" },
    });
  };
  try {
    const response = await worker.fetch(request("/api/admin/login", {
      method: "POST",
      headers: { origin: "https://nsgourmet.test", "content-type": "application/json" },
      body: JSON.stringify({ username: "ns_gourmet@profissional.com", password: "not-a-real-password" }),
    }), env);
    assert.equal(response.status, 200);
    assert.equal(call.url, "https://example.supabase.co/auth/v1/token?grant_type=password");
    assert.equal(call.options.headers.apikey, "test-publishable");
    assert.equal(JSON.parse(call.options.body).email, "ns_gourmet@profissional.com");
    assert.match(response.headers.get("set-cookie"), /nsg_admin_access=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin login cookie authenticates the following session request", async () => {
  const originalFetch = globalThis.fetch;
  let authCall = 0;
  globalThis.fetch = async (url, options) => {
    authCall += 1;
    if (String(url).endsWith("/auth/v1/token?grant_type=password")) {
      return Response.json({
        access_token: "access-test",
        refresh_token: "refresh-test",
        expires_in: 3600,
        user: { email: "ns_gourmet@profissional.com" },
      });
    }
    if (String(url).endsWith("/auth/v1/user")) {
      assert.match(options.headers.authorization, /Bearer access-test/);
      assert.equal(options.headers.apikey, "test-publishable");
      return Response.json({ email: "ns_gourmet@profissional.com" });
    }
    throw new Error("Unexpected URL: " + url);
  };

  try {
    const login = await worker.fetch(request("/api/admin/login", {
      method: "POST",
      headers: { origin: "https://nsgourmet.test", "content-type": "application/json" },
      body: JSON.stringify({ username: "ns_gourmet@profissional.com", password: "not-a-real-password" }),
    }), env);
    assert.equal(login.status, 200);
    const cookies = login.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    const cookieHeader = cookies.map(value => value.split(";")[0]).join("; ");

    const session = await worker.fetch(request("/api/admin/session", {
      headers: { cookie: cookieHeader },
    }), env);
    assert.deepEqual(await session.json(), { authenticated: true });
    assert.equal(authCall, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin login refuses accounts outside the configured allowlist", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Supabase must not be called for a non-admin email"); };
  try {
    const response = await worker.fetch(request("/api/admin/login", {
      method: "POST",
      headers: { origin: "https://nsgourmet.test", "content-type": "application/json" },
      body: JSON.stringify({ username: "someone@example.com", password: "test" }),
    }), env);
    assert.equal(response.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin login HTML is served directly with its dedicated script", async () => {
  const response = await worker.fetch(request("/admin"), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /src="\/admin-login\.js" defer/);
});

test("admin login JavaScript is served directly by the Worker", async () => {
  const response = await worker.fetch(request("/admin-login.js"), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  const script = await response.text();
  assert.match(script, /\/api\/admin\/login/);
  assert.match(script, /\/api\/admin\/session/);
});

test("admin route serves login page until the Supabase session is verified", async () => {
  const response = await worker.fetch(request("/admin"), {
    ...env,
    ASSETS: {
      async fetch(assetRequest) {
        return new Response(new URL(assetRequest.url).pathname, { headers: { "content-type": "text/plain" } });
      },
    },
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /src="\/admin-login\.js" defer/);
});

test("direct admin html URL is also protected", async () => {
  const response = await worker.fetch(request("/admin.html"), {
    ...env,
    ASSETS: {
      async fetch(assetRequest) {
        return new Response(new URL(assetRequest.url).pathname);
      },
    },
  });
  assert.match(await response.text(), /src="\/admin-login\.js" defer/);
});


test("admin store config persists business hours and returns the saved row", async () => {
  const originalFetch = globalThis.fetch;
  let patchBody;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/auth/v1/user")) return Response.json({ email: "ns_gourmet@profissional.com" });
    if (String(url).includes("/rest/v1/public_store_settings") && options.method === "PATCH") {
      patchBody = JSON.parse(options.body);
      return Response.json([{
        business_hours: patchBody.business_hours,
        business_hours_enabled: patchBody.business_hours_enabled,
        accepting_orders: true,
        time_zone: "America/Maceio",
        origin_address: "",
        delivery_fallback_cents: 200,
        delivery_fallback_km: 3,
      }]);
    }
    if (String(url).includes("/rest/v1/public_store_settings")) {
      return Response.json([{
        business_hours: {},
        business_hours_enabled: false,
        accepting_orders: false,
        time_zone: "America/Maceio",
      }]);
    }
    throw new Error("Unexpected Supabase request: " + url);
  };
  const businessHours = Object.fromEntries(["mon","tue","wed","thu","fri","sat","sun"].map(day => [day, {
    closed: day === "sun", open: "12:30", close: "19:00",
  }]));
  try {
    const response = await worker.fetch(request("/api/admin/store-config", {
      method: "POST",
      headers: {
        origin: "https://nsgourmet.test",
        cookie: "nsg_admin_access=test-access",
        "content-type": "application/json",
      },
      body: JSON.stringify({ businessHours, acceptingOrders: true }),
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(patchBody.business_hours, businessHours);
    assert.equal(patchBody.business_hours_enabled, true);
    assert.equal(patchBody.accepting_orders, true);
    assert.deepEqual(body.config.businessHours, businessHours);
    assert.equal(body.config.acceptingOrders, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin store config rejects invalid or incomplete business hours", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/auth/v1/user")) return Response.json({ email: "ns_gourmet@profissional.com" });
    if (String(url).includes("/rest/v1/public_store_settings")) return Response.json([{
      business_hours: {}, business_hours_enabled: false, accepting_orders: false,
    }]);
    throw new Error("The invalid schedule must not be written");
  };
  try {
    const response = await worker.fetch(request("/api/admin/store-config", {
      method: "POST",
      headers: {
        origin: "https://nsgourmet.test",
        cookie: "nsg_admin_access=test-access",
        "content-type": "application/json",
      },
      body: JSON.stringify({ businessHours: { mon: { closed: false, open: "19:00", close: "12:30" } } }),
    }), env);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /horários/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("admin and public order JavaScript are served directly by the Worker", async () => {
  const adminResponse = await worker.fetch(request("/admin.js"), env);
  const publicResponse = await worker.fetch(request("/pedido.js"), env);
  const adminScript = await adminResponse.text();
  const publicScript = await publicResponse.text();
  assert.equal(adminResponse.status, 200);
  assert.equal(publicResponse.status, 200);
  assert.match(adminResponse.headers.get("content-type"), /javascript/i);
  assert.match(publicResponse.headers.get("content-type"), /javascript/i);
  assert.match(adminScript, /accepting-orders-toggle/);
  assert.match(publicScript, /Horario automático desativado|Horário automático desativado/);
});


test("admin store config persists manual open override and automatic reset", async () => {
  const originalFetch = globalThis.fetch;
  let patchBody;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/auth/v1/user")) return Response.json({ email: "ns_gourmet@profissional.com" });
    if (String(url).includes("/rest/v1/public_store_settings") && options.method === "PATCH") {
      patchBody = JSON.parse(options.body);
      return Response.json([{ business_hours: {}, business_hours_enabled: true, accepting_orders: true,
        manual_open_override: patchBody.manual_open_override, time_zone: "America/Maceio", origin_address: "",
        delivery_fallback_cents: 200, delivery_fallback_km: 3 }]);
    }
    if (String(url).includes("/rest/v1/public_store_settings")) return Response.json([{ business_hours: {},
      business_hours_enabled: true, accepting_orders: true, manual_open_override: null, time_zone: "America/Maceio" }]);
    throw new Error("Unexpected Supabase request: " + url);
  };
  try {
    for (const value of [true, false, null]) {
      const response = await worker.fetch(request("/api/admin/store-config", {
        method: "POST", headers: { origin: "https://nsgourmet.test", cookie: "nsg_admin_access=test-access", "content-type": "application/json" },
        body: JSON.stringify({ manualOpenOverride: value }),
      }), env);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(patchBody.manual_open_override, value);
      assert.equal(body.config.manualOpenOverride, value);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("admin store config rejects invalid manual open override", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/auth/v1/user")) return Response.json({ email: "ns_gourmet@profissional.com" });
    if (String(url).includes("/rest/v1/public_store_settings")) return Response.json([{ manual_open_override: null }]);
    throw new Error("Invalid manual mode must not be written");
  };
  try {
    const response = await worker.fetch(request("/api/admin/store-config", {
      method: "POST", headers: { origin: "https://nsgourmet.test", cookie: "nsg_admin_access=test-access", "content-type": "application/json" },
      body: JSON.stringify({ manualOpenOverride: "open" }),
    }), env);
    assert.equal(response.status, 400);
  } finally { globalThis.fetch = originalFetch; }
});
