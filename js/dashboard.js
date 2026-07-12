// ==========================================================================
// Tabela do painel: carregar, ordenar, filtrar, somar e editar Meta
// ==========================================================================

let LOJAS_CACHE = [];

async function carregarLojas() {
  const sessao = getSessao();
  const corpo = document.getElementById("tabela-corpo");
  corpo.innerHTML = `<tr><td colspan="9" class="carregando">Carregando...</td></tr>`;

  const TAMANHO_PAGINA = 1000; // limite padrão do Supabase por requisição
  let todas = [];
  let pagina = 0;

  try {
    while (true) {
      const de = pagina * TAMANHO_PAGINA;
      const ate = de + TAMANHO_PAGINA - 1;
      const { data, error } = await supabaseClient
        .rpc("fn_get_lojas", { p_nome: sessao.nome, p_senha: sessao.senha })
        .range(de, ate);

      if (error) throw error;

      todas = todas.concat(data || []);
      if (!data || data.length < TAMANHO_PAGINA) break;
      pagina++;
    }
  } catch (error) {
    corpo.innerHTML = `<tr><td colspan="9" class="sem-dados">Erro ao carregar dados: ${error.message}</td></tr>`;
    return;
  }

  ordenarLojas(todas);
  LOJAS_CACHE = todas;
  atualizarMesesCabecalho();
  atualizarTabela();
}

/** Ordena por GCM (crescente) e, dentro do mesmo GCM, por Nome da Loja (crescente). */
function ordenarLojas(lojas) {
  lojas.sort((a, b) => {
    const porGcm = String(a.gcm || "").localeCompare(String(b.gcm || ""), "pt-BR", { sensitivity: "base" });
    if (porGcm !== 0) return porGcm;
    return String(a.nome_loja || "").localeCompare(String(b.nome_loja || ""), "pt-BR", { sensitivity: "base" });
  });
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

/** Vermelho: M3, M2 e M1 zerados. Amarelo: só 1 dos 3 meses com produção. 2 ou 3 meses: normal. */
function classeLinha(loja) {
  const m3 = Number(loja.m3) || 0;
  const m2 = Number(loja.m2) || 0;
  const m1 = Number(loja.m1) || 0;
  const mesesComProducao = [m3, m2, m1].filter((v) => v > 0).length;
  if (mesesComProducao === 0) return "linha-zerada";
  if (mesesComProducao === 1) return "linha-atencao";
  return "";
}

/** Atualiza o rótulo de mês (ex: "Abr/26") no cabeçalho de M3/M2/M1, a partir dos dados carregados. */
function atualizarMesesCabecalho() {
  const acharMes = (campo) => {
    const loja = LOJAS_CACHE.find((l) => l[campo]);
    return loja ? loja[campo] : "";
  };
  document.getElementById("mes-m3").textContent = acharMes("mes_m3");
  document.getElementById("mes-m2").textContent = acharMes("mes_m2");
  document.getElementById("mes-m1").textContent = acharMes("mes_m1");
}

/** Soma M3/M2/M1/Meta da lista exibida (após filtros) e escreve nos cabeçalhos. */
function atualizarSomasCabecalho(lojas) {
  const soma = (campo) => lojas.reduce((total, l) => total + (Number(l[campo]) || 0), 0);
  document.getElementById("soma-m3").textContent = formatarNumero(soma("m3"));
  document.getElementById("soma-m2").textContent = formatarNumero(soma("m2"));
  document.getElementById("soma-m1").textContent = formatarNumero(soma("m1"));
  document.getElementById("soma-meta").textContent = formatarNumero(soma("meta"));
}

/** Combina filtros de coluna + busca de texto e devolve a lista a ser exibida. */
function obterLinhasExibidas() {
  let linhas = aplicarFiltrosColuna(LOJAS_CACHE);

  const termo = document.getElementById("filtro-busca").value
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  if (termo) {
    linhas = linhas.filter((l) => {
      const alvo = [l.dn, l.nome_loja, l.gcm, l.coordenador, l.regional]
        .join(" ")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return alvo.includes(termo);
    });
  }

  return linhas;
}

/** Ponto único de atualização: recalcula lista exibida, tabela e somas. */
function atualizarTabela() {
  const linhas = obterLinhasExibidas();
  renderizarTabela(linhas);
  atualizarSomasCabecalho(linhas);
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
  atualizarSomasCabecalho(obterLinhasExibidas());
}

function aplicarFiltroBusca() {
  atualizarTabela();
}
