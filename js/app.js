// ==========================================================================
// Inicialização
// ==========================================================================

function mostrarApp(sessao) {
  document.getElementById("tela-login").classList.add("oculto");
  document.getElementById("app").classList.remove("oculto");

  document.getElementById("usuario-info").textContent =
    `${sessao.nome} · ${rotuloPerfil(sessao.perfil)}`;

  if (sessao.perfil === "admin") {
    document.getElementById("barra-uploads").classList.remove("oculto");
  }

  carregarLojas();
}

function mostrarLogin() {
  document.getElementById("tela-login").classList.remove("oculto");
  document.getElementById("app").classList.add("oculto");
}

async function iniciar() {
  configurarUploads();

  document.getElementById("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = document.getElementById("login-usuario").value.trim();
    const senha = document.getElementById("login-senha").value;
    const erroEl = document.getElementById("login-erro");
    const btn = document.getElementById("btn-login");

    erroEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Entrando...";

    try {
      const sessao = await fazerLogin(nome, senha);
      mostrarApp(sessao);
    } catch (err) {
      erroEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  });

  document.getElementById("btn-logout").addEventListener("click", fazerLogout);
  document.getElementById("filtro-busca").addEventListener("input", aplicarFiltroBusca);

  const sessaoExistente = getSessao();
  if (sessaoExistente) {
    mostrarApp(sessaoExistente);
  } else {
    mostrarLogin();
  }
}

iniciar();
