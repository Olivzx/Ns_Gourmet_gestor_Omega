"use strict";

const { callSupabaseRpc } = require("../../lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  try {
    const menu = await callSupabaseRpc("public_order_menu");
    if (!menu || typeof menu !== "object" || Array.isArray(menu)) {
      throw new Error("O banco retornou um cardápio inválido.");
    }
    return res.status(200).json({ ...menu, demo: false });
  } catch (error) {
    const status = error.statusCode || 502;
    return res.status(status).json({
      error: status === 503
        ? error.message
        : "Não foi possível carregar o cardápio agora.",
    });
  }
};
