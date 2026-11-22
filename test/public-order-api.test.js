"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";

const menuHandler = require("../api/public-order/menu");
const ordersHandler = require("../api/public-order/orders");

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("menu endpoint fails closed without Supabase configuration", async () => {
  const response = createResponse();
  await menuHandler({ method: "GET" }, response);
  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /banco ainda não foi configurada/i);
});

test("orders endpoint rejects unsupported methods", async () => {
  const response = createResponse();
  await ordersHandler({ method: "GET" }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "POST");
});

test("orders endpoint rejects malformed JSON", async () => {
  const response = createResponse();
  await ordersHandler({ method: "POST", body: "{" }, response);
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /JSON válido/i);
});

test("orders endpoint fails closed without Supabase configuration", async () => {
  const response = createResponse();
  await ordersHandler({ method: "POST", body: { requestId: "test" } }, response);
  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /banco ainda não foi configurada/i);
});
