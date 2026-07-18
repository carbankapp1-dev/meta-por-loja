// ==========================================================================
// Gestão de lojas: editar GCM (individual), excluir loja, troca em massa
// ==========================================================================

// -------------------- Edição individual do GCM --------------------

let EDITAR_GCM_DN_ATUAL = null;

function abrirEditorGcm(dn, botaoEl) {
  EDITAR_GCM_DN_ATUAL = dn;
  const loja = LOJAS_CACHE.find((l) => l.dn === dn);
  if (!loja) return;

  const valoresGcm = valoresUnicosColuna("gcm")
    .map((v) => v.bruto)
    .filter((v) => v !== "(vazio)");

  const select = document.getElementById("editar-gcm-select");
  select.innerHTML =
    `<option value="" disabled>-- selecione --</option>` +
    valoresGcm.map((v) => `<option value="${escapeHtml(v)}" ${v === loja.gcm ? "selected" : ""}>${escapeHtml(v)}</option>`).join("") +
    `<option value="__outro__">+ Outro (digitar nome novo)</option>`;

  document.getElementById("editar-gcm-novo-nome").value = "";
  document.getElementById("editar-gcm-novo-nome").classList.add("oculto");

  const painel = document.getElementById("painel-editar-gcm");
  painel.classList.remove("oculto");

  const retangulo = botaoEl.getBoundingClientRect();
  const topo = window.scrollY + retangulo.bottom + 4;
  let esquerda = window.scrollX + retangulo.left;
  const largura = 230;
  if (esquerda + largura > window.scrollX + window.innerWidth - 12) {
    esquerda = window.scrollX + window.innerWidth - largura - 12;
  }
  painel.style.top = topo + "px";
  painel.style.left = esquerda + "px";
}

function fecharEditorGcm() {
  document.getElementById("painel-editar-gcm").classList.add("oculto");
  EDITAR_GCM_DN_ATUAL = null;
}

async function salvarEdicaoGcm() {
  if (EDITAR_GCM_DN_ATUAL === null) return;
  const select = document.getElementById("editar-gcm-select");
  const inputNovo = document.getElementById("editar-gcm-novo-nome");
  const novoGcm = select.value === "__outro__" ? inputNovo.value.trim() : select.value;

  if (!novoGcm) {
    alert("Escolha um GCM ou digite um nome.");
    return;
  }

  const sessao = getSessao();
  const dn = EDITAR_GCM_DN_ATUAL;

  const { error } = await supabaseClient.rpc("fn_editar_gcm_loja", {
    p_nome: sessao.nome,
    p_senha: sessao.senha,
    p_dn: dn,
    p_novo_gcm: novoGcm,
  });

  if (error) {
    alert("Não foi possível trocar o GCM: " + error.message);
    return;
  }

  const loja = LOJAS_CACHE.find((l) => l.dn === dn);
  if (loja) loja.gcm = novoGcm;
  fecharEditorGcm();
  ordenarLojas(LOJAS_CACHE);
  atualizarTabela();
}

function configurarEditorGcm() {
  document.getElementById("editar-gcm-select").addEventListener("change", (e) => {
    const inputNovo = document.getElementById("editar-gcm-novo-nome");
    if (e.target.value === "__outro__") {
      inputNovo.classList.remove("oculto");
      inputNovo.focus();
    } else {
      inputNovo.classList.add("oculto");
    }
  });
  document.getElementById("editar-gcm-cancelar").addEventListener("click", fecharEditorGcm);
  document.getElementById("editar-gcm-salvar").addEventListener("click", salvarEdicaoGcm);
  document.getElementById("painel-editar-gcm").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => fecharEditorGcm());
}

// -------------------- Excluir loja --------------------

async function confirmarExclusaoLoja(dn) {
  const loja = LOJAS_CACHE.find((l) => l.dn === dn);
  if (!loja) return;

  const confirmar = confirm(
    `Excluir permanentemente a loja "${loja.nome_loja}" (DN ${dn})?\n\n` +
    "Essa ação não pode ser desfeita."
  );
  if (!confirmar) return;

  const sessao = getSessao();
  const { error } = await supabaseClient.rpc("fn_excluir_loja", {
    p_nome: sessao.nome,
    p_senha: sessao.senha,
    p_dn: dn,
  });

  if (error) {
    alert("Não foi possível excluir a loja: " + error.message);
    return;
  }

  LOJAS_CACHE = LOJAS_CACHE.filter((l) => l.dn !== dn);
  atualizarTabela();
}

// -------------------- Troca de atendimento em massa (admin) --------------------

function rotuloNivel(nivel) {
  return { gcm: "GCM", coordenador: "Coordenador", regional: "Regional" }[nivel] || nivel;
}

function popularSelectsReatribuir() {
  const nivel = document.getElementById("reatribuir-nivel").value;
  const valores = valoresUnicosColuna(nivel).map((v) => v.bruto).filter((v) => v !== "(vazio)");

  const selectDe = document.getElementById("reatribuir-de");
  selectDe.innerHTML = valores.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

  const selectPara = document.getElementById("reatribuir-para");
  selectPara.innerHTML =
    valores.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("") +
    `<option value="__outro__">+ Outro (digitar nome novo)</option>`;

  document.getElementById("reatribuir-para-novo").classList.add("oculto");
  atualizarContagemReatribuir();
}

function atualizarContagemReatribuir() {
  const nivel = document.getElementById("reatribuir-nivel").value;
  const valorDe = document.getElementById("reatribuir-de").value;
  const total = LOJAS_CACHE.filter((l) => String(l[nivel] || "") === valorDe).length;
  document.getElementById("reatribuir-contagem").textContent =
    `${total} loja${total === 1 ? "" : "s"} será${total === 1 ? "" : "ão"} afetada${total === 1 ? "" : "s"}.`;
}

function abrirModalReatribuir() {
  document.getElementById("reatribuir-nivel").value = "gcm";
  popularSelectsReatribuir();
  document.getElementById("modal-reatribuir").classList.remove("oculto");
}

function fecharModalReatribuir() {
  document.getElementById("modal-reatribuir").classList.add("oculto");
}

async function confirmarReatribuirMassa() {
  const nivel = document.getElementById("reatribuir-nivel").value;
  const valorDe = document.getElementById("reatribuir-de").value;
  const selectPara = document.getElementById("reatribuir-para");
  const valorPara = selectPara.value === "__outro__"
    ? document.getElementById("reatribuir-para-novo").value.trim()
    : selectPara.value;

  if (!valorDe || !valorPara) {
    alert("Preencha os campos De e Para.");
    return;
  }
  if (valorDe === valorPara) {
    alert("O valor de origem e destino são iguais.");
    return;
  }

  const total = LOJAS_CACHE.filter((l) => String(l[nivel] || "") === valorDe).length;
  const confirmar = confirm(
    `Isso vai mover ${total} loja${total === 1 ? "" : "s"} de\n"${valorDe}"\npara\n"${valorPara}"\n` +
    `no nível ${rotuloNivel(nivel)}.\n\nConfirma?`
  );
  if (!confirmar) return;

  const sessao = getSessao();
  const { data, error } = await supabaseClient.rpc("fn_reatribuir_massa", {
    p_nome: sessao.nome,
    p_senha: sessao.senha,
    p_nivel: nivel,
    p_valor_antigo: valorDe,
    p_valor_novo: valorPara,
  });

  if (error) {
    alert("Não foi possível fazer a troca: " + error.message);
    return;
  }

  fecharModalReatribuir();
  alert(`Pronto — ${data} loja(s) atualizada(s).`);
  await carregarLojas();
}

function configurarReatribuirMassa() {
  const botaoAbrir = document.getElementById("btn-abrir-reatribuir");
  if (botaoAbrir) botaoAbrir.addEventListener("click", abrirModalReatribuir);

  document.getElementById("reatribuir-fechar").addEventListener("click", fecharModalReatribuir);
  document.getElementById("reatribuir-cancelar").addEventListener("click", fecharModalReatribuir);
  document.getElementById("reatribuir-nivel").addEventListener("change", popularSelectsReatribuir);
  document.getElementById("reatribuir-de").addEventListener("change", atualizarContagemReatribuir);
  document.getElementById("reatribuir-para").addEventListener("change", (e) => {
    document.getElementById("reatribuir-para-novo").classList.toggle("oculto", e.target.value !== "__outro__");
  });
  document.getElementById("reatribuir-confirmar").addEventListener("click", confirmarReatribuirMassa);

  document.getElementById("modal-reatribuir").addEventListener("click", (e) => {
    if (e.target.id === "modal-reatribuir") fecharModalReatribuir();
  });
}

function configurarGestaoLojas() {
  configurarEditorGcm();
  configurarReatribuirMassa();
}
