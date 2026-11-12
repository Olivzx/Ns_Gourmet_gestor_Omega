"use strict";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function callSupabaseRpc(functionName, payload) {
  if (!supabaseUrl || !serviceRoleKey) {
    const error = new Error("A integração com o banco ainda não foi configurada.");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload || {}),
    },
  );

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      response.status < 500 && result?.message
        ? result.message
        : "Não foi possível acessar o banco de dados.",
    );
    error.statusCode = response.status < 500 ? response.status : 502;
    throw error;
  }

  return result;
}

module.exports = { callSupabaseRpc };
