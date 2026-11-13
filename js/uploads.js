// ==========================================================================
// Uploads de planilhas
// ==========================================================================

function mostrarStatusUpload(texto, erro = false) {
  const el = document.getElementById("upload-status");
  el.textContent = texto;
  el.style.color = erro ? "#C0392B" : "";
}

// flagPrimeiroLote: nome de um parâmetro booleano (ex: "p_zerar") que vai
// true só no 1º pacote e false nos seguintes — assim o banco zera/rotaciona
// uma única vez e os pacotes seguintes não apagam o que o anterior gravou.
async function chamarRpcEmLotes(nomeRpc, sessao, campoLista, linhas, paramsExtras = {}, tamanhoLote = 500, flagPrimeiroLote = null) {
  let total = 0;
  const lista = linhas.length ? linhas : [[]]; // garante ao menos 1 chamada (ex: p_mes sem linhas)
  for (let i = 0; i < lista.length; i += tamanhoLote) {
    const lote = lista.slice(i, i + tamanhoLote);
    const params = { p_nome: sessao.nome, p_senha: sessao.senha, ...paramsExtras };
    params[campoLista] = lote;
    if (flagPrimeiroLote) params[flagPrimeiroLote] = (i === 0);
    const { data, error } = await supabaseClient.rpc(nomeRpc, params);
    if (error) throw new Error(error.message);
    total += data || 0;
  }
  return total;
}

/** Recarrega a tabela e avisa quantas lojas da carteira não vieram na planilha. */
async function finalizarUpload(mensagem, campoFora) {
  await carregarLojas();
  const fora = LOJAS_CACHE.filter((l) => l[campoFora]).length;
  if (fora) {
    mostrarStatusUpload(`${mensagem} ⚠ ${fora} loja${fora === 1 ? "" : "s"} da carteira não ${fora === 1 ? "veio" : "vieram"} na planilha (em vermelho na tabela).`, true);
  } else {
    mostrarStatusUpload(mensagem);
  }
}

async function tratarUploadLojas(file) {
  const sessao = getSessao();
  mostrarStatusUpload("Lendo planilha de lojas...");
  const linhas = await lerPlanilha(file);
  const dados = processarPlanilhaLojas(linhas);

  mostrarStatusUpload(`Enviando ${dados.length} lojas...`);
  const total = await chamarRpcEmLotes("fn_upload_lojas", sessao, "p_rows", dados);

  mostrarStatusUpload(`✓ ${total} lojas atualizadas.`);
  await carregarLojas();
}

async function tratarUploadPotencial(file) {
  const sessao = getSessao();
  mostrarStatusUpload("Lendo planilha de potencial...");
  const linhas = await lerPlanilha(file);
  const { linhas: producao } = processarPlanilhaProducao(linhas);
  const dados = montarLinhasPotencial(producao);

  mostrarStatusUpload(`Enviando potencial de ${dados.length} lojas...`);
  const total = await chamarRpcEmLotes("fn_upload_potencial", sessao, "p_rows", dados, {}, 500, "p_zerar");

  await finalizarUpload(`✓ Potencial atualizado em ${total} lojas.`, "fora_potencial");
}

async function tratarUploadMes(file, nomeRpc, rotulo, campoFora) {
  const sessao = getSessao();
  mostrarStatusUpload(`Lendo planilha de ${rotulo}...`);
  const linhas = await lerPlanilha(file);
  const { linhas: producao, mes } = processarPlanilhaProducao(linhas);
  const dados = montarLinhasContratos(producao);

  mostrarStatusUpload(`Atualizando ${rotulo} de ${dados.length} lojas${mes ? ` (${mes})` : ""}...`);
  const total = await chamarRpcEmLotes(nomeRpc, sessao, "p_rows", dados, { p_mes: mes || null }, 500, "p_zerar");

  await finalizarUpload(`✓ ${rotulo} atualizado em ${total} lojas${mes ? ` — ${mes}` : ""}.`, campoFora);
}

async function tratarUploadM1(file) {
  await tratarUploadMes(file, "fn_update_m1", "M1", "fora_m1");
}

async function tratarUploadM2(file) {
  await tratarUploadMes(file, "fn_update_m2", "M2", "fora_m2");
}

async function tratarUploadM3(file) {
  await tratarUploadMes(file, "fn_update_m3", "M3", "fora_m3");
}

async function tratarUploadMesAtual(file) {
  const sessao = getSessao();
  mostrarStatusUpload("Lendo planilha do mês atual...");
  const linhas = await lerPlanilha(file);
  const dados = processarPlanilhaMesAtual(linhas);
  if (!dados.length) throw new Error("Nenhum contrato encontrado na coluna DEALER.");
  const totalContratos = dados.reduce((s, l) => s + l.contratos, 0);

  mostrarStatusUpload(`Atualizando Mês Atual: ${totalContratos} contratos em ${dados.length} lojas...`);
  const total = await chamarRpcEmLotes("fn_update_mes_atual", sessao, "p_rows", dados, {}, 500, "p_zerar");

  await finalizarUpload(`✓ Mês Atual atualizado: ${totalContratos} contratos em ${total} lojas.`);
}

async function tratarUploadNovoMes(file) {
  const sessao = getSessao();

  const confirmar = confirm(
    "Isso vai rotacionar o histórico:\n" +
    "M3 atual será substituído pelo M2\n" +
    "M2 atual será substituído pelo M1\n" +
    "M1 atual será substituído pelos dados desta planilha\n\n" +
    "Confirma que é o fechamento de um novo mês?"
  );
  if (!confirmar) return;

  mostrarStatusUpload("Lendo planilha do novo mês...");
  const linhas = await lerPlanilha(file);
  const { linhas: producao, mes } = processarPlanilhaProducao(linhas);
  const dados = montarLinhasContratos(producao);

  mostrarStatusUpload("Rotacionando M3/M2/M1 e gravando novos contratos...");
  const total = await chamarRpcEmLotes("fn_novo_mes", sessao, "p_rows", dados, { p_mes: mes || null }, 500, "p_rotacionar");

  await finalizarUpload(`✓ Novo mês fechado${mes ? ` (${mes})` : ""}. ${total} lojas com M1 atualizado.`, "fora_m1");
}

function configurarUploads() {
  const mapa = [
    ["upload-lojas", tratarUploadLojas],
    ["upload-potencial", tratarUploadPotencial],
    ["upload-m1", tratarUploadM1],
    ["upload-m2", tratarUploadM2],
    ["upload-m3", tratarUploadM3],
    ["upload-mes-atual", tratarUploadMesAtual],
    ["upload-novo-mes", tratarUploadNovoMes],
  ];

  mapa.forEach(([id, handler]) => {
    document.getElementById(id).addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await handler(file);
      } catch (err) {
        mostrarStatusUpload("Erro: " + err.message, true);
      } finally {
        e.target.value = "";
      }
    });
  });
}
