# Painel GCM

Painel gerencial comercial (DN, Loja, GCM, Coordenador, Regional, Gravames Mercado,
Potencial de Mercado, M3, M2, M1, Meta), com login por perfil e uploads de planilha.
Front-end estático (HTML/CSS/JS puro) + Supabase como banco de dados.

## 1. Criar o projeto no Supabase

1. Crie um projeto em https://supabase.com (grátis para começar).
2. Vá em **SQL Editor** e rode o arquivo `supabase/schema.sql` inteiro (cria as
   tabelas `usuarios` e `lojas`, e todas as funções que o site usa).
3. Ainda no SQL Editor, crie os usuários que vão logar no painel. No fim do
   `schema.sql` tem exemplos, algo como:

   ```sql
   select admin_upsert_usuario('admin', 'uma_senha_forte', 'admin', null);
   select admin_upsert_usuario('marcos.custodio', 'senha123', 'gcm', 'MARCOS ALEXANDRE CUSTODIO');
   select admin_upsert_usuario('hermes.junior', 'senha123', 'coordenador', 'HERMES FIDELES JUNIOR');
   select admin_upsert_usuario('henrique.silverio', 'senha123', 'regional', 'HENRIQUE CAMPAGNUOLO SILVERIO');
   ```

   **Importante:** o `nome_referencia` (último parâmetro) precisa ser IDÊNTICO
   (mesmo texto, mesma acentuação/maiúsculas) ao valor que aparece nas colunas
   `GCM`, `NM_FILIAL` ou `NM_GERENCIA` da planilha de lojas — é isso que faz o
   filtro por perfil funcionar. Rode uma query `select distinct gcm from lojas`
   (depois do primeiro upload de lojas) para copiar os nomes exatos.

4. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**.

## 2. Configurar o front-end

Abra `js/config.js` e troque:

```js
const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
const SUPABASE_ANON_KEY = "SUA_CHAVE_ANON_AQUI";
```

pelos valores copiados no passo anterior.

## 3. Publicar no GitHub Pages

1. Crie um repositório novo no GitHub e suba todos os arquivos desta pasta.
2. No repositório: **Settings → Pages → Source: Deploy from a branch**, escolha
   a branch `main` e a pasta `/ (root)`.
3. Em alguns minutos o site estará em `https://SEU-USUARIO.github.io/SEU-REPO/`.

## 4. Usando o painel

- **Login**: tela inicial pede usuário e senha (os que você cadastrou no passo 1).
- **Uploads** (só aparecem para o perfil `admin`):
  - **Lojas** → suba a planilha `PARAM - REGIONAL - V2` (colunas `CD_DN`,
    `RAZAO_SOCIAL`, `GCM`, `NM_FILIAL`, `NM_GERENCIA`). Cadastra/atualiza as
    lojas e seus responsáveis. Não mexe em M1/M2/M3/Meta.
  - **Potencial** → suba a planilha de produção (mesmo formato do
    `PRODUCAO_M1/M2/M3`). Lê a coluna `DEALER` (separando o código DN do nome),
    pega `Gravames Mercado` e classifica automaticamente a faixa de potencial:
    `0 GRAVAMES`, `A. 1 GRAVAME`, `B. 2-5 GRAVAMES`, `C. 6-10 GRAVAMES`,
    `D. 11-20 GRAVAMES`, `E. 21-30 GRAVAMES`, `F. > 30 GRAVAMES`. Também lê a
    coluna `%Market_Share` e grava na coluna "Market Share" do painel.
  - **Atualizar M1 / M2 / M3** → corrige o mês correspondente (mesma leitura de
    coluna `DEALER` e `Contratos`), sem mexer nos outros meses. Use quantas
    vezes quiser durante o mês.
  - **Mês Atual** → mesmo formato das planilhas de M1/M2/M3. Atualiza a
    coluna "Mês Atual" (acompanhamento do mês corrente, sem rotação — suba
    quantas vezes quiser durante o mês, cada upload substitui o valor).
  - **Novo Mês** → fecha o mês: empurra M2→M3, M1→M2, e grava a planilha
    enviada como novo M1. Pede confirmação antes de rodar, porque é uma ação
    que reorganiza o histórico de todas as lojas.
- **Meta**: campo editável direto na tabela, para qualquer perfil (dentro do
  que ele pode ver). Salva sozinho ao sair do campo. A soma da Meta (das linhas
  visíveis, considerando filtros) aparece embaixo do título da coluna.
- **Busca**: filtra por DN, nome da loja, GCM, coordenador ou regional.
- **Filtros por coluna (estilo Excel)**: clique na setinha ▾ ao lado de
  qualquer título de coluna para abrir uma lista com todos os valores únicos
  daquela coluna — dá pra pesquisar, "Selecionar tudo", "Limpar" e aplicar.
  O ícone fica verde quando a coluna tem filtro ativo. Os filtros de todas as
  colunas se combinam entre si e com a busca de texto.
- **Ordenação**: a lista vem sempre ordenada por GCM (A→Z) e, dentro de cada
  GCM, por Nome da Loja (A→Z).
- **Mês e soma em M3/M2/M1**: o cabeçalho de cada uma dessas colunas mostra o
  mês a que se refere (lido da coluna "MÊS" da planilha de produção, ex:
  "Abr/26") e a soma de todos os contratos visíveis na tela. A Meta também
  mostra a soma. As somas recalculam sozinhas conforme os filtros/busca mudam.
- **Colunas na tela**: mostra DN, Nome da Loja, GCM, Gravames Mercado,
  Market Share, Potencial, M3, M2, M1, Mês Atual e Meta. Coordenador e
  Regional continuam salvos no banco (usados para o filtro por perfil e na
  busca), só não aparecem como coluna na tabela. As colunas **DN** e **Nome
  da Loja** ficam fixas ao rolar a tabela para o lado, e o Nome da Loja é
  cortado com reticências (o nome completo aparece ao passar o mouse). O
  cabeçalho da tabela também fica fixo ao rolar a página. Os badges de
  Potencial de Mercado têm sempre a mesma largura, e cada faixa tem uma cor
  própria.
- **Formatação condicional das linhas** (por ordem de prioridade):
  1. **Verde** — Mês Atual já atingiu ou superou a Meta (objetivo alcançado).
  2. **Vermelho claro** — M3, M2 e M1 estão todos zerados (loja sem produção
     há 3 meses).
  3. **Amarelo** — só 1 dos 3 meses (M3/M2/M1) teve produção (atenção).
  4. **Normal (branca)** — 2 ou 3 meses tiveram produção.

  Passar o mouse por cima de uma linha deixa ela **cinza** (o verde ficou
  reservado só pra indicar meta atingida, pra não confundir os dois).

## 5. Gestão de lojas (trocar GCM, excluir loja, troca em massa)

- **Trocar o GCM de uma loja**: passe o mouse sobre a célula do GCM — aparece
  um ícone de lápis (✎). Clique para escolher outro GCM já existente ou
  digitar o nome de alguém novo. Permitido para **admin, coordenador e
  regional** (coordenador/regional só conseguem mexer em lojas dentro do
  próprio escopo).
- **Excluir uma loja** (ex: loja fechou): passe o mouse sobre o nome da loja —
  aparece um "×" vermelho. Clique, confirme, e a loja é apagada do banco
  permanentemente. Mesma permissão do item acima: admin, coordenador e
  regional (dentro do escopo).
- **Trocar Atendimento (em massa)**: botão na barra de uploads, **só para
  admin**. Abre uma janela onde você escolhe o nível (GCM, Coordenador ou
  Regional), quem está saindo ("De") e quem está assumindo ("Para" — pode ser
  alguém já existente ou um nome novo). Mostra quantas lojas serão afetadas
  antes de você confirmar. Útil para quando um GCM/Coordenador/Regional inteiro
  sai e todas as lojas dele precisam ir para outra pessoa de uma vez.

  ⚠️ Lembre-se: essas trocas só mudam o dado na tabela `lojas`. Se a pessoa que
  está assumindo ainda não tem login cadastrado, ela não vai conseguir ver as
  lojas até você cadastrar o acesso dela com `admin_upsert_usuario` (ver seção 1).

## 6. Como funciona a segurança

Não usamos Supabase Auth (login "de verdade" com sessão) — foi uma escolha
para manter simples. Na prática:

- As tabelas `usuarios` e `lojas` **não podem ser lidas nem escritas
  diretamente** pela API pública (RLS ligado, sem nenhuma política).
- Todo acesso passa por funções (`fn_login`, `fn_get_lojas`, `fn_update_meta`,
  `fn_editar_gcm_loja`, `fn_excluir_loja`, `fn_reatribuir_massa`,
  `fn_upload_*`) que conferem usuário/senha a cada chamada e filtram/limitam
  os dados conforme o perfil.
- O navegador guarda usuário/senha em `sessionStorage` (some ao fechar a aba)
  só para poder repetir essas chamadas.

Isso é adequado para um painel interno de uso controlado, mas não tem o nível
de segurança de um sistema com autenticação completa (ex: tokens expiráveis,
recuperação de senha, 2FA). Se no futuro isso crescer para fora do time
interno, vale migrar para Supabase Auth.

## Estrutura de arquivos

```
painel-gcm/
├── index.html
├── site.webmanifest      (nome/ícones do PWA)
├── icons/                (favicon + ícones do PWA)
├── css/style.css
├── js/
│   ├── config.js        ← troque pelas suas chaves do Supabase
│   ├── supabaseClient.js
│   ├── parse.js          (leitura e transformação das planilhas)
│   ├── auth.js           (login/logout/sessão)
│   ├── filtros.js        (filtros de coluna estilo Excel)
│   ├── dashboard.js      (tabela, busca, ordenação, Meta, somas)
│   ├── gestao.js         (trocar GCM, excluir loja, troca em massa)
│   ├── uploads.js        (os botões de upload)
│   └── app.js            (inicialização)
└── supabase/schema.sql   ← rode isso no SQL Editor do Supabase
```
