// ==========================================================================
// Autenticação simples (usuário/senha validados via RPC no Supabase)
// A sessão fica em sessionStorage: some ao fechar a aba, por segurança.
// ==========================================================================

const SESSAO_CHAVE = "painel_gcm_sessao";

function getSessao() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSAO_CHAVE) || "null");
  } catch {
    return null;
  }
}

function salvarSessao(sessao) {
  sessionStorage.setItem(SESSAO_CHAVE, JSON.stringify(sessao));
}

function limparSessao() {
  sessionStorage.removeItem(SESSAO_CHAVE);
}

async function fazerLogin(nome, senha) {
  const { data, error } = await supabaseClient.rpc("fn_login", {
    p_nome: nome,
    p_senha: senha,
  });

  if (error) throw new Error("Não foi possível validar o login. Tente novamente.");
  if (!data || data.length === 0) throw new Error("Usuário ou senha inválidos.");

  const usuario = data[0];
  const sessao = {
    nome,
    senha, // guardado só em sessionStorage, necessário para chamadas seguintes às RPCs
    perfil: usuario.perfil,
    nome_referencia: usuario.nome_referencia,
  };
  salvarSessao(sessao);
  return sessao;
}

function fazerLogout() {
  limparSessao();
  window.location.reload();
}

function rotuloPerfil(perfil) {
  switch (perfil) {
    case "admin": return "Administrador";
    case "gcm": return "GCM";
    case "coordenador": return "Coordenador";
    case "regional": return "Regional";
    default: return perfil;
  }
}
