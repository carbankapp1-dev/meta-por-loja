// ==========================================================================
// Tabela do painel: carregar, filtrar e editar Meta
// ==========================================================================

let LOJAS_CACHE = [];

async function carregarLojas() {
  const sessao = getSessao();
  const corpo = document.getElementById("tabela-corpo");
  corpo.innerHTML = `<tr><td colspan="9" class="carregando">Carregando...</td></tr>`;

  const { data, error } = await supabaseClient.rpc("fn_get_lojas", {
    p_nome: sessao.nome,
    p_senha: sessao.senha,
  });

  if (error) {
    corpo.innerHTML = `<tr><td colspan="9" class="sem-dados">Erro ao carregar dados: ${error.message}</td></tr>`;
    return;
  }

  LOJAS_CACHE = data || [];
  renderizarTabela(LOJAS_CACHE);
}

function formatarNumero(valor) {
  if (valor === null || valor === undefined) return "0";
  return Number(valor).toLocaleString("pt-BR");
}

function classePotencial(potencial) {
  const mapa = {
    "0 GRAVAMES": "pot-0",
    "A. 1 GRAVAME": "pot-a",
    "B. 2-5 GRAVAMES": "pot-b",
    "C. 6-10 GRAVAMES": "pot-c",
    "D. 11-20 GRAVAMES": "pot-d",
    "E. 21-30 GRAVAMES": "pot-e",
    "F. > 30 GRAVAMES": "pot-f",
  };
  return mapa[potencial] || "";
}

function classeLinha(loja) {
  const m3 = Number(loja.m3) || 0;
  const m2 = Number(loja.m2) || 0;
  const m1 = Number(loja.m1) || 0;
  if (m3 === 0 && m2 === 0 && m1 === 0) return "linha-zerada";
  return "linha-atencao";
}

function renderizarTabela(lojas) {
  const corpo = document.getElementById("tabela-corpo");
  const contador = document.getElementById("contador-lojas");
  contador.textContent = `${lojas.length} loja${lojas.length === 1 ? "" : "s"}`;

  if (lojas.length === 0) {
    corpo.innerHTML = `<tr><td colspan="9" class="sem-dados">Nenhuma loja encontrada.</td></tr>`;
    return;
  }

  corpo.innerHTML = lojas.map((l) => `
    <tr data-dn="${l.dn}" class="${classeLinha(l)}">
      <td class="col-fixa col-dn">${l.dn}</td>
      <td class="col-fixa col-nome" title="${escapeHtml(l.nome_loja)}">${escapeHtml(l.nome_loja)}</td>
      <td>${escapeHtml(l.gcm || "")}</td>
      <td>${formatarNumero(l.gravames_mercado)}</td>
      <td>${l.potencial ? `<span class="badge-potencial ${classePotencial(l.potencial)}">${escapeHtml(l.potencial)}</span>` : ""}</td>
      <td>${formatarNumero(l.m3)}</td>
      <td>${formatarNumero(l.m2)}</td>
      <td>${formatarNumero(l.m1)}</td>
      <td><input type="number" min="0" class="input-meta" data-dn="${l.dn}" value="${l.meta ?? 0}"></td>
    </tr>
  `).join("");

  corpo.querySelectorAll(".input-meta").forEach((input) => {
    input.addEventListener("change", onEditarMeta);
  });
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = String(texto ?? "");
  return div.innerHTML;
}

let debounceMeta = {};

async function onEditarMeta(evento) {
  const input = evento.target;
  const dn = parseInt(input.dataset.dn, 10);
  const novaMeta = parseInt(input.value, 10) || 0;
  const sessao = getSessao();

  input.classList.remove("erro");
  input.classList.add("salvando");

  const { error } = await supabaseClient.rpc("fn_update_meta", {
    p_nome: sessao.nome,
    p_senha: sessao.senha,
    p_dn: dn,
    p_meta: novaMeta,
  });

  input.classList.remove("salvando");

  if (error) {
    input.classList.add("erro");
    alert("Não foi possível salvar a meta: " + error.message);
    return;
  }

  const loja = LOJAS_CACHE.find((l) => l.dn === dn);
  if (loja) loja.meta = novaMeta;
}

function aplicarFiltroBusca() {
  const termo = document.getElementById("filtro-busca").value
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  if (!termo) {
    renderizarTabela(LOJAS_CACHE);
    return;
  }

  const filtradas = LOJAS_CACHE.filter((l) => {
    const alvo = [l.dn, l.nome_loja, l.gcm, l.coordenador, l.regional]
      .join(" ")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return alvo.includes(termo);
  });

  renderizarTabela(filtradas);
}
