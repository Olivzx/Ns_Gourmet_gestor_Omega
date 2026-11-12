"use strict";

const { callSupabaseRpc } = require("../../lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  let order = req.body;
  if (typeof order === "string") {
    try {
      order = JSON.parse(order);
    } catch {
      return res.status(400).json({ error: "O pedido precisa estar em formato JSON válido." });
    }
  }
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    return res.status(400).json({ error: "Dados do pedido inválidos." });
  }

  try {
    const result = await callSupabaseRpc("create_public_order", { p_order: order });
    return res.status(result?.duplicate ? 200 : 201).json({
      ok: true,
      demo: false,
      orderId: result.orderId,
      totalCents: result.totalCents,
      duplicate: Boolean(result.duplicate),
    });
  } catch (error) {
    const status = error.statusCode || 502;
    return res.status(status).json({
      error: status < 500
        ? error.message
        : status === 503
          ? error.message
          : "Não foi possível registrar o pedido agora.",
    });
  }
};
