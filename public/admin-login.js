(() => {
  const form = document.getElementById("login-form");
  if (!form) return;

  const email = document.getElementById("username");
  const password = document.getElementById("password");
  const status = document.getElementById("login-status");
  const button = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async event => {
    event.preventDefault();
    status.textContent = "";
    button.disabled = true;
    button.textContent = "Entrando...";

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ username: email.value.trim(), password: password.value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível autenticar.");

      const sessionResponse = await fetch("/api/admin/session", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Accept": "application/json" }
      });
      const session = await sessionResponse.json().catch(() => ({}));
      if (!sessionResponse.ok || session.authenticated !== true) {
        throw new Error("A senha foi aceita, mas o navegador não confirmou a sessão administrativa. Verifique se os cookies deste site estão permitidos e tente novamente.");
      }

      status.textContent = "Acesso confirmado. Abrindo painel...";
      location.replace("/admin");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Falha inesperada ao entrar.";
      password.value = "";
      password.focus();
      button.disabled = false;
      button.textContent = "Entrar no painel";
    }
  });
})();
