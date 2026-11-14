// ==========================================================================
// Aba VISITAS — controle de visitas por loja (formato "Metro")
// Gr = Gravames Mercado (upload Potencial) · Pg = Mês Atual (upload Mês Atual)
// ==========================================================================

// Faixas de gravames e meta de visitas no período
const FAIXAS_VISITA = [
  { id: "F", min: 31, label: "F. > 30 Gravames",  meta: 8, cor: "pot-f" },
  { id: "E", min: 21, label: "E. 21-30 Gravames", meta: 8, cor: "pot-e" },
  { id: "D", min: 11, label: "D. 11-20 Gravames", meta: 6, cor: "pot-d" },
  { id: "C", min: 6,  label: "C. 6-10 Gravames",  meta: 4, cor: "pot-c" },
  { id: "B", min: 2,  label: "B. 2-5 Gravames",   meta: 2, cor: "pot-b" },
  { id: "A", min: 1,  label: "A. 1 Gravame",      meta: 1, cor: "pot-a" },
  { id: "0", min: 0,  label: "0 Gravames",        meta: 0, cor: "pot-0" },
];
// Ícones das visitas dentro dos quadradinhos
const ICONE_AUTOMATICA = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`;
const ICONE_MANUAL = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

function iconeVisita(origem) {
  return origem === "manual" ? ICONE_MANUAL : ICONE_AUTOMATICA;
}

function descricaoOrigem(origem) {
  return {
    gps: "automática (GPS do site)",
    atalho: "automática (atalho do iPhone)",
    manual: "marcada na mão",
    migrada: "do site antigo",
  }[origem] || origem;
}
const GPS_PRECISAO_MAX = 30;       // metros (o banco confere de novo)
const GPS_INTERVALO_MS = 60000;    // no máximo 1 consulta por minuto parado
const GPS_DESLOCAMENTO_M = 15;     // ou quando andar mais que isso

const visitasEstado = {
  lojas: [],
  carregando: false,
  gpsWatchId: null,
  gpsPosicao: null,
  gpsUltimaConsulta: null,   // { lat, lon, quando }
  gpsConsultando: false,
  lojaAberta: null,
};

// ---------- utilidades ----------

function lsGet(chave, padrao = null) {
  try { const v = localStorage.getItem(chave); return v === null ? padrao : v; } catch { return padrao; }
}
function lsSet(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: segue sem lembrar */ }
}

function dataISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function periodoPadrao() {
  const h = new Date();
  return {
    de: dataISO(new Date(h.getFullYear(), h.getMonth(), 1)),
    ate: dataISO(new Date(h.getFullYear(), h.getMonth() + 1, 0)),
  };
}

function lerData(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
}

function diasUteisEntre(deISO, ateISO) {
  let n = 0;
  const d = lerData(deISO);
  const fim = lerData(ateISO);
  while (d <= fim) {
    const dia = d.getDay();
    if (dia !== 0 && dia !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

function diasUteisPassados(deISO, ateISO) {
  const hoje = dataISO(new Date());
  if (hoje < deISO) return 0;
  return diasUteisEntre(deISO, hoje < ateISO ? hoje : ateISO);
}

function faixaDaLoja(gravames) {
  const g = Number(gravames) || 0;
  return FAIXAS_VISITA.find((f) => g >= f.min) || FAIXAS_VISITA[FAIXAS_VISITA.length - 1];
}

function nomeCurto(nome) {
  return String(nome || "—").trim().split(/\s+/).slice(0, 2).join(" ");
}

function distanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatarDataHora(iso) {
  if (!iso) return "nunca";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function avisoVisitas(texto, tipo = "") {
  const el = document.getElementById("visitas-aviso");
  el.textContent = texto;
  el.className = "visitas-aviso mostrar " + tipo;
  clearTimeout(avisoVisitas._t);
  avisoVisitas._t = setTimeout(() => { el.className = "visitas-aviso"; }, 3500);
}

async function rpcVisitas(nome, params = {}) {
  const sessao = getSessao();
  const { data, error } = await supabaseClient.rpc(nome, { p_nome: sessao.nome, p_senha: sessao.senha, ...params });
  if (error) {
    if (/function .* does not exist|Could not find the function/i.test(error.message)) {
      throw new Error("As funções de visitas ainda não foram instaladas no Supabase (arquivo supabase/visitas.sql).");
    }
    throw new Error(error.message);
  }
  return data;
}

// ---------- carregar e desenhar ----------

function periodoAtual() {
  return {
    de: document.getElementById("visitas-de").value,
    ate: document.getElementById("visitas-ate").value,
  };
}

async function carregarVisitas() {
  const { de, ate } = periodoAtual();
  const corpo = document.getElementById("visitas-corpo");
  if (!de || !ate || de > ate) { avisoVisitas("Escolha um período válido.", "erro"); return; }
  lsSet("visitas-de", de);
  lsSet("visitas-ate", ate);

  if (!visitasEstado.lojas.length) corpo.innerHTML = `<div class="visitas-msg">Carregando...</div>`;
  visitasEstado.carregando = true;
  try {
    visitasEstado.lojas = (await rpcVisitas("fn_visitas_painel", { p_de: de, p_ate: ate })) || [];
    renderVisitas();
  } catch (err) {
    corpo.innerHTML = `<div class="visitas-msg erro">${escapeHtml(err.message)}</div>`;
  } finally {
    visitasEstado.carregando = false;
  }
}

function renderVisitas() {
  const corpo = document.getElementById("visitas-corpo");
  const { de, ate } = periodoAtual();
  const busca = (document.getElementById("filtro-busca").value || "").toLowerCase().trim();
  const ordem = document.getElementById("visitas-ordem").value;

  const duTotal = diasUteisEntre(de, ate);
  const proporcao = duTotal ? diasUteisPassados(de, ate) / duTotal : 0;

  const lojas = visitasEstado.lojas.filter((l) =>
    !busca ||
    String(l.dn).includes(busca) ||
    String(l.nome_loja || "").toLowerCase().includes(busca) ||
    String(l.bairro || "").toLowerCase().includes(busca)
  );

  // Resumo do topo
  const hoje = visitasEstado.lojas.filter((l) => l.visitou_hoje).length;
  let feitas = 0, metaTotal = 0, atrasadas = 0, semPosicao = 0;
  visitasEstado.lojas.forEach((l) => {
    const f = faixaDaLoja(l.gravames_mercado);
    feitas += f.meta ? Math.min(l.visitas, f.meta) : 0;
    metaTotal += f.meta;
    if (f.meta > 0 && l.visitas < Math.floor(f.meta * proporcao)) atrasadas++;
    if (l.latitude == null) semPosicao++;
  });
  document.getElementById("visitas-resumo").innerHTML = `
    <div class="resumo-item"><span class="resumo-num">${hoje}</span><span class="resumo-rot">lojas hoje</span></div>
    <div class="resumo-item"><span class="resumo-num">${feitas}/${metaTotal}</span><span class="resumo-rot">visitas da meta</span></div>
    <div class="resumo-item ${atrasadas ? "alerta" : ""}"><span class="resumo-num">${atrasadas}</span><span class="resumo-rot">atrasadas</span></div>
    ${semPosicao ? `<div class="resumo-item"><span class="resumo-num">${semPosicao}</span><span class="resumo-rot">sem posição</span></div>` : ""}`;

  if (!lojas.length) {
    corpo.innerHTML = `<div class="visitas-msg">${visitasEstado.lojas.length ? "Nenhuma loja encontrada na busca." : "Nenhuma loja na sua carteira."}</div>`;
    return;
  }

  let html = "";
  FAIXAS_VISITA.forEach((faixa) => {
    const lista = lojas.filter((l) => faixaDaLoja(l.gravames_mercado).id === faixa.id);
    if (!lista.length) return;

    if (ordem === "oportunidade") {
      // Mais gravame e menos pagamento primeiro
      lista.sort((a, b) => (b.gravames_mercado - b.mes_atual) - (a.gravames_mercado - a.mes_atual) ||
        String(a.nome_loja).localeCompare(String(b.nome_loja)));
    } else {
      lista.sort((a, b) => String(a.nome_loja).localeCompare(String(b.nome_loja)));
    }

    const totGr = lista.reduce((s, l) => s + (l.gravames_mercado || 0), 0);
    const totPg = lista.reduce((s, l) => s + (l.mes_atual || 0), 0);

    html += `<section class="metro-grupo">
      <div class="metro-cab ${faixa.cor}">
        <div class="metro-cab-titulo">${faixa.label} · ${faixa.meta ? `Meta: ${faixa.meta} vis.` : "Sem meta"}</div>
        <div class="metro-num"><small>Gr</small>${totGr.toLocaleString("pt-BR")}</div>
        <div class="metro-num"><small>Pg</small>${totPg.toLocaleString("pt-BR")}</div>
      </div>`;

    // Quadradinhos = meta da faixa (faixa sem meta: 1, a visita do mês)
    const slots = Math.max(faixa.meta, 1);

    lista.forEach((l) => {
      const atrasada = faixa.meta > 0 && l.visitas < Math.floor(faixa.meta * proporcao);
      const feitas = l.visitas_lista || [];
      let barra = "";
      for (let i = 0; i < slots; i++) {
        const v = feitas[i];
        barra += v
          ? `<button type="button" class="metro-campo feito ${faixa.cor}" data-dn="${l.dn}"
              title="${formatarDataHora(v.em)} · ${descricaoOrigem(v.origem)}" aria-label="Ver visita">${iconeVisita(v.origem)}</button>`
          : `<span class="metro-campo vazio"></span>`;
      }
      if (feitas.length > slots) {
        barra += `<button type="button" class="metro-extra ${faixa.cor}" data-dn="${l.dn}"
          title="Visitas além da meta">+${feitas.length - slots}</button>`;
      }
      const extra = `<button type="button" class="metro-mais" data-dn="${l.dn}" title="Marcar visita na mão" aria-label="Marcar visita na mão">+</button>`;
      html += `<div class="metro-linha">
        <button type="button" class="metro-nome ${atrasada ? "atrasada" : ""}" data-dn="${l.dn}" title="${escapeHtml(l.nome_loja)}">
          ${l.visitou_hoje ? `<span class="ponto-hoje" title="Visitada hoje"></span>` : ""}${escapeHtml(nomeCurto(l.nome_loja))}${l.latitude == null ? ` <span class="sem-pos" title="Sem posição: abra a loja e salve a posição">sem posição</span>` : ""}
        </button>
        <div class="metro-barra">${barra}${extra}</div>
        <div class="metro-num gr">${(l.gravames_mercado || 0).toLocaleString("pt-BR")}</div>
        <div class="metro-num pg ${l.mes_atual ? "" : "zero"}">${(l.mes_atual || 0).toLocaleString("pt-BR")}</div>
      </div>`;
    });
    html += `</section>`;
  });

  corpo.innerHTML = html;
}

// ---------- marcar / remover ----------

// Botão "+" da linha: marca uma visita na mão
async function onCliqueMais(btn) {
  if (btn.dataset.ocupado === "1") return;
  btn.dataset.ocupado = "1";
  if (navigator.vibrate) navigator.vibrate(30);
  try {
    const pos = visitasEstado.gpsPosicao;
    await rpcVisitas("fn_visita_marcar", {
      p_dn: Number(btn.dataset.dn), p_lat: pos ? pos.lat : null, p_lon: pos ? pos.lon : null,
    });
    avisoVisitas("✓ Visita marcada", "ok");
    await carregarVisitas();
  } catch (err) {
    avisoVisitas("Erro: " + err.message, "erro");
  } finally {
    btn.dataset.ocupado = "0";
  }
}

async function removerVisita(id) {
  const dn = visitasEstado.lojaAberta;
  const l = visitasEstado.lojas.find((x) => x.dn === dn);
  const v = l && (l.visitas_lista || []).find((x) => x.id === id);
  if (!v) return;
  if (!confirm(`Remover a visita de ${formatarDataHora(v.em)} (${descricaoOrigem(v.origem)})?`)) return;
  try {
    const ok = await rpcVisitas("fn_visita_remover", { p_id: id });
    avisoVisitas(ok ? "↩ Visita removida" : "Essa visita já não existia.", ok ? "ok" : "erro");
    await carregarVisitas();
    abrirDetalheLoja(dn);
  } catch (err) {
    alert("Erro: " + err.message);
  }
}

// ---------- detalhe da loja ----------

function abrirDetalheLoja(dn) {
  const l = visitasEstado.lojas.find((x) => x.dn === dn);
  if (!l) return;
  visitasEstado.lojaAberta = dn;
  const f = faixaDaLoja(l.gravames_mercado);
  const endereco = [l.logradouro, l.numero, l.bairro, l.cep].filter(Boolean).join(", ");
  const pos = visitasEstado.gpsPosicao;
  const dist = pos && l.latitude != null ? Math.round(distanciaMetros(pos.lat, pos.lon, l.latitude, l.longitude)) : null;
  const mapa = l.latitude != null
    ? `https://maps.apple.com/?q=${encodeURIComponent(l.nome_loja)}&ll=${l.latitude},${l.longitude}`
    : (endereco ? `https://maps.apple.com/?q=${encodeURIComponent(endereco)}` : null);

  document.getElementById("loja-det-nome").textContent = l.nome_loja;
  document.getElementById("loja-det-info").innerHTML = `
    <div><b>DN</b> ${l.dn} · <span class="badge-faixa ${f.cor}">${f.label}</span></div>
    <div><b>Endereço</b> ${endereco ? escapeHtml(endereco) : "não cadastrado"}</div>
    <div><b>Gravames</b> ${l.gravames_mercado || 0} · <b>Pagos no mês</b> ${l.mes_atual || 0}</div>
    <div><b>Visitas no período</b> ${l.visitas} de ${f.meta || "—"} · <b>Última</b> ${formatarDataHora(l.ultima_visita)}</div>
    <div><b>Posição</b> ${l.latitude == null ? "sem posição" : (l.posicao_confirmada ? "salva na loja ✓" : "aproximada (pelo endereço)")}${dist !== null ? ` · você está a ${dist.toLocaleString("pt-BR")} m` : ""}</div>`;
  const feitas = (l.visitas_lista || []).slice().reverse();
  document.getElementById("loja-det-visitas").innerHTML = feitas.length
    ? `<p class="loja-det-sub">Visitas no período</p>` + feitas.map((v) => `
        <div class="loja-det-visita">
          <span class="loja-det-icone ${f.cor}">${iconeVisita(v.origem)}</span>
          <span class="loja-det-quando">${formatarDataHora(v.em)} · ${descricaoOrigem(v.origem)}</span>
          <button type="button" class="loja-det-remover" data-id="${v.id}">Remover</button>
        </div>`).join("")
    : `<p class="loja-det-sub">Nenhuma visita no período.</p>`;

  const link = document.getElementById("loja-det-mapa");
  link.classList.toggle("oculto", !mapa);
  if (mapa) link.href = mapa;
  document.getElementById("modal-loja").classList.remove("oculto");
}

function fecharDetalheLoja() {
  document.getElementById("modal-loja").classList.add("oculto");
  visitasEstado.lojaAberta = null;
}

async function salvarPosicaoLoja() {
  const dn = visitasEstado.lojaAberta;
  const l = visitasEstado.lojas.find((x) => x.dn === dn);
  if (!l) return;
  const btn = document.getElementById("loja-det-salvar-pos");
  btn.disabled = true;
  btn.textContent = "Pegando sua localização...";
  try {
    const pos = await pegarPosicaoPrecisa();
    if (pos.precisao > 50) {
      throw new Error(`O GPS está impreciso agora (${Math.round(pos.precisao)} m). Vá para perto da porta e tente de novo.`);
    }
    if (!confirm(`Salvar a sua posição atual como a posição de "${l.nome_loja}"?\n(precisão do GPS: ${Math.round(pos.precisao)} m)`)) return;
    await rpcVisitas("fn_loja_salvar_posicao", { p_dn: dn, p_lat: pos.lat, p_lon: pos.lon });
    avisoVisitas("📍 Posição da loja salva", "ok");
    fecharDetalheLoja();
    await carregarVisitas();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "📍 Estou na loja — salvar posição";
  }
}

async function marcarVisitaPeloDetalhe() {
  const dn = visitasEstado.lojaAberta;
  try {
    const pos = visitasEstado.gpsPosicao;
    await rpcVisitas("fn_visita_marcar", { p_dn: dn, p_lat: pos ? pos.lat : null, p_lon: pos ? pos.lon : null });
    avisoVisitas("✓ Visita marcada", "ok");
    fecharDetalheLoja();
    await carregarVisitas();
  } catch (err) {
    alert("Erro: " + err.message);
  }
}

// ---------- GPS (site aberto) ----------

function pegarPosicaoPrecisa() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Este aparelho não tem GPS disponível.")); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, precisao: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? "Permita o acesso à localização para o site." : "Não consegui pegar a localização.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

function atualizarStatusGps(texto, estado) {
  const el = document.getElementById("gps-status");
  el.textContent = texto;
  el.className = "gps-status " + (estado || "");
  const btn = document.getElementById("btn-gps");
  btn.textContent = visitasEstado.gpsWatchId !== null ? "Desligar GPS" : "Ligar GPS";
}

function ligarGps() {
  if (!navigator.geolocation) { atualizarStatusGps("GPS indisponível", "erro"); return; }
  if (visitasEstado.gpsWatchId !== null) return;
  visitasEstado.gpsWatchId = navigator.geolocation.watchPosition(
    onPosicaoGps,
    (e) => {
      atualizarStatusGps(e.code === 1 ? "Localização bloqueada — libere nos ajustes" : "Procurando sinal de GPS...", "erro");
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
  );
  atualizarStatusGps("Procurando sinal de GPS...", "");
}

function desligarGps() {
  if (visitasEstado.gpsWatchId !== null) navigator.geolocation.clearWatch(visitasEstado.gpsWatchId);
  visitasEstado.gpsWatchId = null;
  atualizarStatusGps("GPS desligado", "");
}

async function onPosicaoGps(p) {
  const pos = { lat: p.coords.latitude, lon: p.coords.longitude, precisao: p.coords.accuracy };
  visitasEstado.gpsPosicao = pos;

  if (pos.precisao > GPS_PRECISAO_MAX) {
    atualizarStatusGps(`GPS ligado · sinal fraco (${Math.round(pos.precisao)} m)`, "fraco");
    return;
  }
  atualizarStatusGps(`GPS ligado · precisão ${Math.round(pos.precisao)} m`, "ok");

  // Só consulta o banco se tem loja com posição a até ~150 m (economiza chamadas)
  const perto = visitasEstado.lojas.some((l) =>
    l.latitude != null && distanciaMetros(pos.lat, pos.lon, l.latitude, l.longitude) <= 150);
  if (!perto || visitasEstado.gpsConsultando) return;

  const u = visitasEstado.gpsUltimaConsulta;
  const andou = !u || distanciaMetros(u.lat, u.lon, pos.lat, pos.lon) > GPS_DESLOCAMENTO_M;
  if (!andou && Date.now() - u.quando < GPS_INTERVALO_MS) return;

  visitasEstado.gpsConsultando = true;
  visitasEstado.gpsUltimaConsulta = { lat: pos.lat, lon: pos.lon, quando: Date.now() };
  try {
    const r = await rpcVisitas("fn_visita_gps", { p_lat: pos.lat, p_lon: pos.lon, p_precisao: pos.precisao });
    if (r && r.status === "marcada") {
      if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
      avisoVisitas("📍 " + r.mensagem, "ok");
      await carregarVisitas();
    }
  } catch (err) {
    console.warn("GPS:", err.message);
  } finally {
    visitasEstado.gpsConsultando = false;
  }
}

// ---------- atalho do iPhone ----------

function abrirModalAtalho() {
  document.getElementById("atalho-url").textContent = `${SUPABASE_URL}/rest/v1/rpc/fn_atalho_visita`;
  document.getElementById("atalho-apikey").textContent = SUPABASE_ANON_KEY;
  document.getElementById("atalho-token-caixa").classList.add("oculto");
  document.getElementById("modal-atalho").classList.remove("oculto");
  rpcVisitas("fn_atalho_tem_token")
    .then((tem) => {
      document.getElementById("atalho-token-situacao").textContent = tem
        ? "Você já tem uma senha do atalho. Gerar outra desliga a anterior (aí precisa colar a nova no atalho)."
        : "Você ainda não tem senha do atalho. Gere a sua:";
    })
    .catch((err) => { document.getElementById("atalho-token-situacao").textContent = err.message; });
}

async function gerarTokenAtalho() {
  if (!confirm("Gerar uma nova senha do atalho? Se você já tinha uma, ela para de funcionar.")) return;
  try {
    const token = await rpcVisitas("fn_atalho_gerar_token");
    document.getElementById("atalho-token").textContent = token;
    document.getElementById("atalho-token-caixa").classList.remove("oculto");
    document.getElementById("atalho-token-situacao").textContent = "Senha gerada. Copie e cole no atalho (ela não aparece de novo).";
  } catch (err) {
    alert("Erro: " + err.message);
  }
}

async function copiarTexto(id, botao) {
  const texto = document.getElementById(id).textContent;
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const t = document.createElement("textarea");
    t.value = texto;
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  const original = botao.textContent;
  botao.textContent = "Copiado ✓";
  setTimeout(() => { botao.textContent = original; }, 1500);
}

// ---------- abas ----------

function mostrarAba(aba) {
  const visitas = aba === "visitas";
  document.getElementById("aba-painel").classList.toggle("oculto", visitas);
  document.getElementById("aba-visitas").classList.toggle("oculto", !visitas);
  document.querySelectorAll(".aba-btn").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === aba));
  document.getElementById("filtro-busca").placeholder = visitas ? "Buscar loja..." : "Buscar por...";
  lsSet("aba-atual", aba);

  if (visitas) {
    carregarVisitas();
    if (lsGet("gps-ligado", "1") === "1") ligarGps();
  } else {
    desligarGps();
  }
}

function configurarVisitas() {
  const p = periodoPadrao();
  // Período lembrado só se ainda for do mês atual (no mês novo volta pro padrão)
  const deSalvo = lsGet("visitas-de");
  const ateSalvo = lsGet("visitas-ate");
  const mesmoMes = deSalvo && deSalvo.slice(0, 7) === p.de.slice(0, 7);
  document.getElementById("visitas-de").value = mesmoMes ? deSalvo : p.de;
  document.getElementById("visitas-ate").value = mesmoMes && ateSalvo ? ateSalvo : p.ate;
  document.getElementById("visitas-ordem").value = lsGet("visitas-ordem", "nome");

  document.querySelectorAll(".aba-btn").forEach((b) => b.addEventListener("click", () => mostrarAba(b.dataset.aba)));
  document.getElementById("btn-visitas-ver").addEventListener("click", carregarVisitas);
  document.getElementById("visitas-ordem").addEventListener("change", (e) => { lsSet("visitas-ordem", e.target.value); renderVisitas(); });
  document.getElementById("filtro-busca").addEventListener("input", () => {
    if (!document.getElementById("aba-visitas").classList.contains("oculto")) renderVisitas();
  });

  document.getElementById("btn-gps").addEventListener("click", () => {
    if (visitasEstado.gpsWatchId !== null) { desligarGps(); lsSet("gps-ligado", "0"); }
    else { ligarGps(); lsSet("gps-ligado", "1"); }
  });

  document.getElementById("visitas-corpo").addEventListener("click", (e) => {
    const mais = e.target.closest(".metro-mais");
    if (mais) { onCliqueMais(mais); return; }
    const alvo = e.target.closest(".metro-nome, .metro-campo.feito, .metro-extra");
    if (alvo) abrirDetalheLoja(Number(alvo.dataset.dn));
  });

  document.getElementById("loja-det-fechar").addEventListener("click", fecharDetalheLoja);
  document.getElementById("loja-det-visitas").addEventListener("click", (e) => {
    const b = e.target.closest(".loja-det-remover");
    if (b) removerVisita(Number(b.dataset.id));
  });
  document.getElementById("loja-det-salvar-pos").addEventListener("click", salvarPosicaoLoja);
  document.getElementById("loja-det-marcar").addEventListener("click", marcarVisitaPeloDetalhe);
  document.getElementById("modal-loja").addEventListener("click", (e) => { if (e.target.id === "modal-loja") fecharDetalheLoja(); });

  document.getElementById("btn-atalho").addEventListener("click", abrirModalAtalho);
  document.getElementById("atalho-fechar").addEventListener("click", () => document.getElementById("modal-atalho").classList.add("oculto"));
  document.getElementById("modal-atalho").addEventListener("click", (e) => { if (e.target.id === "modal-atalho") e.target.classList.add("oculto"); });
  document.getElementById("btn-gerar-token").addEventListener("click", gerarTokenAtalho);
  document.querySelectorAll("[data-copiar]").forEach((b) => b.addEventListener("click", () => copiarTexto(b.dataset.copiar, b)));

  // Ao voltar para o site (ex: depois de usar outro app), atualiza as visitas
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !document.getElementById("aba-visitas").classList.contains("oculto") && getSessao()) {
      carregarVisitas();
    }
  });
}
