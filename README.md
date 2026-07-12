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
    `D. 11-20 GRAVAMES`, `E. 21-30 GRAVAMES`, `F. > 30 GRAVAMES`.
  - **Atualizar M1** → corrige o M1 do mês corrente (mesma leitura de coluna
    `DEALER` e `Contratos`), sem mexer em M2/M3. Use quantas vezes quiser
    durante o mês.
  - **Novo Mês** → fecha o mês: empurra M2→M3, M1→M2, e grava a planilha
    enviada como novo M1. Pede confirmação antes de rodar, porque é uma ação
    que reorganiza o histórico de todas as lojas.
- **Meta**: campo editável direto na tabela, para qualquer perfil (dentro do
  que ele pode ver). Salva sozinho ao sair do campo.
- **Busca**: filtra por DN, nome da loja, GCM, coordenador ou regional.

## 5. Como funciona a segurança

Não usamos Supabase Auth (login "de verdade" com sessão) — foi uma escolha
para manter simples. Na prática:

- As tabelas `usuarios` e `lojas` **não podem ser lidas nem escritas
  diretamente** pela API pública (RLS ligado, sem nenhuma política).
- Todo acesso passa por funções (`fn_login`, `fn_get_lojas`, `fn_update_meta`,
  `fn_upload_*`) que conferem usuário/senha a cada chamada e filtram os dados
  conforme o perfil.
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
├── css/style.css
├── js/
│   ├── config.js        ← troque pelas suas chaves do Supabase
│   ├── supabaseClient.js
│   ├── parse.js          (leitura e transformação das planilhas)
│   ├── auth.js           (login/logout/sessão)
│   ├── dashboard.js      (tabela, busca, edição de Meta)
│   ├── uploads.js        (os 4 botões de upload)
│   └── app.js            (inicialização)
└── supabase/schema.sql   ← rode isso no SQL Editor do Supabase
```
