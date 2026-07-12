// ==========================================================================
// Uploads de planilhas
// ==========================================================================

function mostrarStatusUpload(texto, erro = false) {
  const el = document.getElementById("upload-status");
  el.textContent = texto;
  el.style.color = erro ? "#C0392B" : "";
}

async function chamarRpcEmLotes(nomeRpc, sessao, campoLista, linhas, tamanhoLote = 500) {
  let total = 0;
  for (let i = 0; i < linhas.length; i += tamanhoLote) {
    const lote = linhas.slice(i, i + tamanhoLote);
    const params = { p_nome: sessao.nome, p_senha: sessao.senha };
    params[campoLista] = lote;
    const { data, error } = await supabaseClient.rpc(nomeRpc, params);
    if (error) throw new Error(error.message);
    total += data || 0;
  }
  return total;
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
  const producao = processarPlanilhaProducao(linhas);
  const dados = montarLinhasPotencial(producao);

  mostrarStatusUpload(`Enviando potencial de ${dados.length} lojas...`);
  const total = await chamarRpcEmLotes("fn_upload_potencial", sessao, "p_rows", dados);

  mostrarStatusUpload(`✓ Potencial atualizado em ${total} lojas.`);
  await carregarLojas();
}

async function tratarUploadM1(file) {
  const sessao = getSessao();
  mostrarStatusUpload("Lendo planilha de M1...");
  const linhas = await lerPlanilha(file);
  const producao = processarPlanilhaProducao(linhas);
  const dados = montarLinhasContratos(producao);

  mostrarStatusUpload(`Atualizando M1 de ${dados.length} lojas...`);
  const total = await chamarRpcEmLotes("fn_update_m1", sessao, "p_rows", dados);

  mostrarStatusUpload(`✓ M1 atualizado em ${total} lojas.`);
  await carregarLojas();
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
  const producao = processarPlanilhaProducao(linhas);
  const dados = montarLinhasContratos(producao);

  mostrarStatusUpload("Rotacionando M3/M2/M1 e gravando novos contratos...");
  const total = await chamarRpcEmLotes("fn_novo_mes", sessao, "p_rows", dados);

  mostrarStatusUpload(`✓ Novo mês fechado. ${total} lojas com M1 atualizado.`);
  await carregarLojas();
}

function configurarUploads() {
  const mapa = [
    ["upload-lojas", tratarUploadLojas],
    ["upload-potencial", tratarUploadPotencial],
    ["upload-m1", tratarUploadM1],
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
