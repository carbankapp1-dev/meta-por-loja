// ==========================================================================
// Filtros por coluna, estilo Excel (Selecionar tudo / Limpar / Pesquisar)
// ==========================================================================

let FILTROS_COLUNA = {};      // { coluna: Set(valoresSelecionadosComoTexto) } — ausente = sem filtro
let FILTRO_COLUNA_ATUAL = null;
let FILTRO_SELECAO_TEMP = null;

function rotuloValor(coluna, valor) {
  if (valor === null || valor === undefined || valor === "") return "(vazio)";
  if (coluna === "gravames_mercado" || coluna === "m3" || coluna === "m2" || coluna === "m1" || coluna === "meta") {
    return formatarNumero(valor);
  }
  return String(valor);
}

function valorBruto(coluna, valor) {
  if (valor === null || valor === undefined || valor === "") return "(vazio)";
  return String(valor);
}

function valoresUnicosColuna(coluna) {
  const vistos = new Map(); // chave bruta -> rótulo de exibição
  LOJAS_CACHE.forEach((l) => {
    const bruto = valorBruto(coluna, l[coluna]);
    if (!vistos.has(bruto)) vistos.set(bruto, rotuloValor(coluna, l[coluna]));
  });
  return Array.from(vistos.entries())
    .map(([bruto, rotulo]) => ({ bruto, rotulo }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR", { numeric: true, sensitivity: "base" }));
}

function abrirPainelFiltro(coluna, botaoEl) {
  FILTRO_COLUNA_ATUAL = coluna;
  const valores = valoresUnicosColuna(coluna);
  const selecaoAtual = FILTROS_COLUNA[coluna]
    ? new Set(FILTROS_COLUNA[coluna])
    : new Set(valores.map((v) => v.bruto));
  FILTRO_SELECAO_TEMP = selecaoAtual;

  const lista = document.getElementById("filtro-lista-valores");
  lista.innerHTML = valores.map((v) => `
    <label class="filtro-item">
      <input type="checkbox" value="${escapeHtml(v.bruto)}" ${selecaoAtual.has(v.bruto) ? "checked" : ""}>
      <span>${escapeHtml(v.rotulo)}</span>
    </label>
  `).join("");

  lista.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) FILTRO_SELECAO_TEMP.add(cb.value);
      else FILTRO_SELECAO_TEMP.delete(cb.value);
    });
  });

  document.getElementById("filtro-pesquisa-coluna").value = "";

  const painel = document.getElementById("painel-filtro");
  painel.classList.remove("oculto");

  const retangulo = botaoEl.getBoundingClientRect();
  const topo = window.scrollY + retangulo.bottom + 4;
  let esquerda = window.scrollX + retangulo.left;
  const larguraPainel = 240;
  if (esquerda + larguraPainel > window.scrollX + window.innerWidth - 12) {
    esquerda = window.scrollX + window.innerWidth - larguraPainel - 12;
  }
  painel.style.top = topo + "px";
  painel.style.left = esquerda + "px";

  document.querySelectorAll(".th-filtro").forEach((b) => b.classList.remove("th-filtro-abrindo"));
  botaoEl.classList.add("th-filtro-abrindo");
}

function fecharPainelFiltro() {
  document.getElementById("painel-filtro").classList.add("oculto");
  document.querySelectorAll(".th-filtro").forEach((b) => b.classList.remove("th-filtro-abrindo"));
  FILTRO_COLUNA_ATUAL = null;
  FILTRO_SELECAO_TEMP = null;
}

function aplicarFiltroPesquisaColuna() {
  const termo = document.getElementById("filtro-pesquisa-coluna").value
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  document.querySelectorAll("#filtro-lista-valores .filtro-item").forEach((item) => {
    const texto = item.querySelector("span").textContent
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    item.style.display = !termo || texto.includes(termo) ? "" : "none";
  });
}

function configurarFiltrosColuna() {
  document.querySelectorAll(".th-filtro").forEach((botao) => {
    botao.addEventListener("click", (e) => {
      e.stopPropagation();
      const coluna = botao.dataset.col;
      if (FILTRO_COLUNA_ATUAL === coluna) {
        fecharPainelFiltro();
      } else {
        abrirPainelFiltro(coluna, botao);
      }
    });
  });

  document.getElementById("filtro-pesquisa-coluna").addEventListener("input", aplicarFiltroPesquisaColuna);

  document.getElementById("filtro-selecionar-tudo").addEventListener("click", () => {
    document.querySelectorAll("#filtro-lista-valores input[type=checkbox]").forEach((cb) => {
      cb.checked = true;
      FILTRO_SELECAO_TEMP.add(cb.value);
    });
  });

  document.getElementById("filtro-limpar-tudo").addEventListener("click", () => {
    document.querySelectorAll("#filtro-lista-valores input[type=checkbox]").forEach((cb) => {
      cb.checked = false;
    });
    FILTRO_SELECAO_TEMP.clear();
  });

  document.getElementById("filtro-cancelar").addEventListener("click", fecharPainelFiltro);

  document.getElementById("filtro-aplicar").addEventListener("click", () => {
    const coluna = FILTRO_COLUNA_ATUAL;
    const total = valoresUnicosColuna(coluna).length;
    if (FILTRO_SELECAO_TEMP.size === 0 || FILTRO_SELECAO_TEMP.size === total) {
      delete FILTROS_COLUNA[coluna];
    } else {
      FILTROS_COLUNA[coluna] = new Set(FILTRO_SELECAO_TEMP);
    }
    atualizarIconesFiltroAtivo();
    fecharPainelFiltro();
    atualizarTabela();
  });

  document.getElementById("painel-filtro").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => fecharPainelFiltro());
}

function atualizarIconesFiltroAtivo() {
  document.querySelectorAll(".th-filtro").forEach((botao) => {
    const coluna = botao.dataset.col;
    botao.classList.toggle("th-filtro-ativo", !!FILTROS_COLUNA[coluna]);
  });
}

/** Aplica todos os filtros de coluna ativos sobre a lista completa de lojas. */
function aplicarFiltrosColuna(lojas) {
  let resultado = lojas;
  Object.entries(FILTROS_COLUNA).forEach(([coluna, selecionados]) => {
    resultado = resultado.filter((l) => selecionados.has(valorBruto(coluna, l[coluna])));
  });
  return resultado;
}
