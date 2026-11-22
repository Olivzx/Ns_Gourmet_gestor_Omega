import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-secret",
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
  }), {});
  assert.equal(response.status, 503);
});

test("unknown API routes return JSON 404", async () => {
  const response = await worker.fetch(request("/api/not-real"), env);
  assert.equal(response.status, 404);
});
