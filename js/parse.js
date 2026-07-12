// ==========================================================================
// Leitura e transformação das planilhas (.xlsx) no navegador
// ==========================================================================

/** Lê um arquivo e devolve a primeira planilha como array de arrays. */
function lerPlanilha(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
        const primeiraAba = wb.SheetNames[0];
        const linhas = XLSX.utils.sheet_to_json(wb.Sheets[primeiraAba], { header: 1, raw: true, defval: null });
        resolve(linhas);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

const MESES_ABREV_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** Formata o valor da coluna "MÊS" da planilha de produção, ex: "Abr/26". */
function formatarMes(valor) {
  if (valor instanceof Date && !isNaN(valor)) {
    const mes = MESES_ABREV_PT[valor.getUTCMonth()];
    const ano = String(valor.getUTCFullYear()).slice(-2);
    return `${mes}/${ano}`;
  }
  return String(valor ?? "").trim();
}

/** Acha o índice de uma coluna pelo nome do cabeçalho (case/acentos flexível). */
function acharColuna(cabecalho, ...nomesPossiveis) {
  const normaliza = (s) => String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
  const alvo = nomesPossiveis.map(normaliza);
  for (let i = 0; i < cabecalho.length; i++) {
    if (alvo.includes(normaliza(cabecalho[i]))) return i;
  }
  return -1;
}

/** Classifica a faixa de "Potencial de Mercado" a partir da qtde de gravames. */
function classificarPotencial(qtdGravames) {
  const d = Number(qtdGravames) || 0;
  if (d === 0) return "0 GRAVAMES";
  if (d === 1) return "A. 1 GRAVAME";
  if (d <= 5) return "B. 2-5 GRAVAMES";
  if (d <= 10) return "C. 6-10 GRAVAMES";
  if (d <= 20) return "D. 11-20 GRAVAMES";
  if (d <= 30) return "E. 21-30 GRAVAMES";
  return "F. > 30 GRAVAMES";
}

/** "60387 - LED AUTOMOVEIS LTDA"  ->  60387 (texto para coluna, separador " - ") */
function extrairDN(valorColunaB) {
  const texto = String(valorColunaB || "").trim();
  const partes = texto.split(" - ");
  const codigo = partes[0].trim();
  const numero = parseInt(codigo.replace(/\D/g, ""), 10);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Planilha "Lojas" (PARAM - REGIONAL - V2)
 * Colunas usadas: CD_DN, RAZAO_SOCIAL, GCM, NM_FILIAL (Coordenador), NM_GERENCIA (Regional)
 */
function processarPlanilhaLojas(linhas) {
  const cabecalho = linhas[0];
  const iDn = acharColuna(cabecalho, "CD_DN");
  const iNome = acharColuna(cabecalho, "RAZAO_SOCIAL");
  const iGcm = acharColuna(cabecalho, "GCM");
  const iCoordenador = acharColuna(cabecalho, "NM_FILIAL");
  const iRegional = acharColuna(cabecalho, "NM_GERENCIA");

  if ([iDn, iNome, iGcm, iCoordenador, iRegional].includes(-1)) {
    throw new Error("Não encontrei todas as colunas esperadas (CD_DN, RAZAO_SOCIAL, GCM, NM_FILIAL, NM_GERENCIA) nesta planilha.");
  }

  const resultado = [];
  let vaziasSeguidas = 0;
  const LIMITE_VAZIAS_SEGUIDAS = 500;

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha || linha[iDn] === null || linha[iDn] === undefined || linha[iDn] === "") {
      vaziasSeguidas++;
      if (vaziasSeguidas >= LIMITE_VAZIAS_SEGUIDAS) break;
      continue;
    }
    vaziasSeguidas = 0;
    resultado.push({
      dn: parseInt(linha[iDn], 10),
      nome_loja: String(linha[iNome] || "").trim(),
      gcm: String(linha[iGcm] || "").trim(),
      coordenador: String(linha[iCoordenador] || "").trim(),
      regional: String(linha[iRegional] || "").trim(),
    });
  }
  return resultado;
}

/**
 * Planilhas de produção (Potencial / M1 / Novo Mês)
 * Coluna A = Mês de referência | Coluna B = "DN - NOME" (texto para coluna) | Gravames Mercado | Contratos
 * Devolve { linhas, mes } — mes é o rótulo (ex: "Jun/26") lido da coluna A.
 */
function processarPlanilhaProducao(linhas) {
  const cabecalho = linhas[0];
  const iMes = acharColuna(cabecalho, "MÊS", "MES");
  const iDealer = acharColuna(cabecalho, "DEALER");
  const iGravames = acharColuna(cabecalho, "Gravames Mercado");
  const iContratos = acharColuna(cabecalho, "Contratos");

  if (iDealer === -1) {
    throw new Error("Não encontrei a coluna DEALER (coluna B) nesta planilha.");
  }

  const resultado = [];
  let mes = "";
  let vaziasSeguidas = 0;
  // Planilhas de produção costumam ter formatação aplicada até milhões de
  // linhas em branco; paramos depois de um bloco longo sem dados reais.
  const LIMITE_VAZIAS_SEGUIDAS = 500;

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha || linha[iDealer] === null || linha[iDealer] === undefined || linha[iDealer] === "") {
      vaziasSeguidas++;
      if (vaziasSeguidas >= LIMITE_VAZIAS_SEGUIDAS) break;
      continue;
    }
    vaziasSeguidas = 0;
    const dn = extrairDN(linha[iDealer]);
    if (dn === null) continue;
    if (!mes && iMes !== -1 && linha[iMes]) {
      mes = formatarMes(linha[iMes]);
    }
    resultado.push({
      dn,
      gravames_mercado: iGravames !== -1 ? (Number(linha[iGravames]) || 0) : null,
      contratos: iContratos !== -1 ? (Number(linha[iContratos]) || 0) : null,
    });
  }
  return { linhas: resultado, mes };
}

/** Monta as linhas prontas para o upload "Potencial" (gravames + classificação). */
function montarLinhasPotencial(linhasProducao) {
  return linhasProducao.map((l) => ({
    dn: l.dn,
    gravames_mercado: l.gravames_mercado || 0,
    potencial: classificarPotencial(l.gravames_mercado || 0),
  }));
}

/** Monta as linhas prontas para upload M1 / Novo Mês (dn + contratos). */
function montarLinhasContratos(linhasProducao) {
  return linhasProducao.map((l) => ({
    dn: l.dn,
    contratos: l.contratos || 0,
  }));
}
