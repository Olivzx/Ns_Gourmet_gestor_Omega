"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = __dirname;
const html = fs.readFileSync(path.join(root, "pedido.html"), "utf8");
const js = fs.readFileSync(path.join(root, "pedido.js"), "utf8");
const css = fs.readFileSync(path.join(root, "pedido.css"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "public/admin.js"), "utf8");

test("o script do cardápio público tem sintaxe JavaScript válida", () => {
  assert.doesNotThrow(() => new vm.Script(js));
});

test("os seletores estáticos do cardápio apontam para IDs existentes no HTML", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const selectors = [...js.matchAll(/\$\("#([a-zA-Z0-9_-]+)"\)/g)].map((match) => match[1]);
  const missing = [...new Set(selectors.filter((id) => !ids.has(id)))];
  assert.deepEqual(missing, []);
});

test("o checkout exige forma de pagamento e os dados essenciais de entrega", () => {
  assert.match(html, /id="payment-method"[^>]*required/);
  assert.match(html, /id="customer-name"[^>]*required/);
  assert.match(html, /id="customer-address"[^>]*required/);
  assert.match(html, /id="customer-neighborhood"[^>]*required/);
});

test("o envio mantém idempotência e não envia preço calculado pelo navegador", () => {
  const submitIndex = js.indexOf('form.addEventListener("submit"');
  const payloadIndex = js.indexOf("body: JSON.stringify({", submitIndex);
  const payloadEnd = js.indexOf("\n        })", payloadIndex);
  assert.ok(submitIndex >= 0 && payloadIndex > submitIndex && payloadEnd > payloadIndex);
  const payload = js.slice(payloadIndex, payloadEnd);
  assert.match(payload, /requestId: activeRequestId/);
  assert.match(payload, /items: orderItems/);
  assert.doesNotMatch(payload, /unitPriceCents|totalCents|freightCents/);
});

test("o checkout bloqueia envios concorrentes e preserva o estado durante atualização do horário", () => {
  assert.match(js, /let isSubmitting = false/);
  assert.match(js, /if \(isSubmitting\) return/);
  assert.match(js, /isSubmitting \|\| cart\.size === 0/);
  assert.match(js, /isSubmitting = false/);
});

test("o carrinho móvel tem controles acessíveis e foco contido no diálogo", () => {
  assert.match(html, /id="mobile-cart-items"[^>]*aria-live="polite"/);
  assert.match(html, /id="mobile-cart-continue"[^>]*disabled/);
  assert.match(js, /event\.key !== "Tab"/);
  assert.match(js, /event\.shiftKey && document\.activeElement === first/);
  assert.match(js, /event\.key === "Escape"/);
});

test("a interface respeita a preferência de movimento reduzido", () => {
  assert.ok(css.includes("prefers-reduced-motion:reduce") || css.includes("prefers-reduced-motion: reduce"));
  assert.ok(js.includes('matchMedia("(prefers-reduced-motion: reduce)")'));
});


test("o JavaScript administrativo tem sintaxe válida", () => {
  assert.doesNotThrow(() => new vm.Script(adminJs));
});

test("o catálogo administrativo oferece busca e filtro rápidos", () => {
  assert.ok(adminHtml.includes('id="product-search"'));
  assert.ok(adminHtml.includes('id="product-category-filter"'));
  assert.ok(adminHtml.includes('id="product-list-count"'));
  assert.ok(adminJs.includes('const normalizeSearch='));
  assert.ok(adminJs.includes('$("#product-search").addEventListener("input",renderProducts)'));
  assert.ok(adminJs.includes('$("#product-category-filter").addEventListener("change",renderProducts)'));
});

test("a reordenação manual fica desabilitada quando a lista está filtrada", () => {
  assert.ok(adminJs.includes('Limpe a busca e o filtro para reorganizar'));
  assert.ok(adminJs.includes('const filtered=Boolean(term||category)'));
});

test("o painel atualiza dados em intervalo moderado e ao voltar para a aba", () => {
  assert.ok(adminJs.includes('setInterval(refreshOrdersSilently,10000)'));
  assert.ok(adminJs.includes('document.addEventListener("visibilitychange"'));
});
