-- ==========================================================================
-- PAINEL GCM — Schema Supabase
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase.
-- ==========================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- TABELAS
-- --------------------------------------------------------------------------

create table if not exists usuarios (
  id bigserial primary key,
  nome text not null unique,               -- login (ex: nome de usuário)
  senha_hash text not null,                 -- gerado com crypt()
  perfil text not null check (perfil in ('gcm','coordenador','regional','admin')),
  nome_referencia text,                     -- deve bater exatamente com lojas.gcm / .coordenador / .regional (null para admin)
  created_at timestamptz not null default now()
);

create table if not exists lojas (
  dn integer primary key,
  nome_loja text not null,
  gcm text,
  coordenador text,
  regional text,
  gravames_mercado integer default 0,
  potencial text,                            -- categoria: "0 GRAVAMES", "A. 1 GRAVAME", ...
  m3 integer default 0,
  m2 integer default 0,
  m1 integer default 0,
  meta integer default 0,
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_lojas_gcm on lojas (gcm);
create index if not exists idx_lojas_coordenador on lojas (coordenador);
create index if not exists idx_lojas_regional on lojas (regional);

-- --------------------------------------------------------------------------
-- BLOQUEIA ACESSO DIRETO ÀS TABELAS (só via funções abaixo)
-- --------------------------------------------------------------------------

alter table usuarios enable row level security;
alter table lojas enable row level security;
-- Nenhuma policy criada de propósito: sem policy + RLS ligado = ninguém
-- consegue ler/escrever direto via API REST. Todo acesso passa pelas
-- funções SECURITY DEFINER abaixo, que rodam com privilégio de dono.

revoke all on usuarios from anon, authenticated;
revoke all on lojas from anon, authenticated;

-- --------------------------------------------------------------------------
-- FUNÇÃO: criar/atualizar usuário (rode manualmente no SQL editor)
-- Exemplo de uso ao final do arquivo.
-- --------------------------------------------------------------------------

create or replace function admin_upsert_usuario(
  p_nome text,
  p_senha text,
  p_perfil text,
  p_nome_referencia text
) returns void
language plpgsql
security definer
as $$
begin
  insert into usuarios (nome, senha_hash, perfil, nome_referencia)
  values (p_nome, crypt(p_senha, gen_salt('bf')), p_perfil, p_nome_referencia)
  on conflict (nome) do update
    set senha_hash = crypt(p_senha, gen_salt('bf')),
        perfil = p_perfil,
        nome_referencia = p_nome_referencia;
end;
$$;

-- --------------------------------------------------------------------------
-- FUNÇÃO: login
-- --------------------------------------------------------------------------

create or replace function fn_login(p_nome text, p_senha text)
returns table (nome text, perfil text, nome_referencia text)
language plpgsql
security definer
as $$
begin
  return query
  select u.nome, u.perfil, u.nome_referencia
  from usuarios u
  where u.nome = p_nome
    and u.senha_hash = crypt(p_senha, u.senha_hash);
end;
$$;

grant execute on function fn_login(text, text) to anon;

-- --------------------------------------------------------------------------
-- Helper interno: valida credencial e devolve perfil/nome_referencia
-- (usado dentro das funções de escrita/leitura para não confiar no cliente)
-- --------------------------------------------------------------------------

create or replace function _valida_usuario(p_nome text, p_senha text, out perfil text, out nome_referencia text)
language plpgsql
security definer
as $$
begin
  select u.perfil, u.nome_referencia into perfil, nome_referencia
  from usuarios u
  where u.nome = p_nome
    and u.senha_hash = crypt(p_senha, u.senha_hash);

  if perfil is null then
    raise exception 'credenciais inválidas';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- FUNÇÃO: buscar lojas visíveis para o usuário logado
-- --------------------------------------------------------------------------

create or replace function fn_get_lojas(p_nome text, p_senha text)
returns setof lojas
language plpgsql
security definer
as $$
declare
  v_perfil text;
  v_ref text;
begin
  select perfil, nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha);

  if v_perfil = 'admin' then
    return query select * from lojas order by nome_loja;
  elsif v_perfil = 'gcm' then
    return query select * from lojas where gcm = v_ref order by nome_loja;
  elsif v_perfil = 'coordenador' then
    return query select * from lojas where coordenador = v_ref order by nome_loja;
  elsif v_perfil = 'regional' then
    return query select * from lojas where regional = v_ref order by nome_loja;
  else
    return;
  end if;
end;
$$;

grant execute on function fn_get_lojas(text, text) to anon;

-- --------------------------------------------------------------------------
-- FUNÇÃO: atualizar Meta de uma loja (respeitando escopo do usuário)
-- --------------------------------------------------------------------------

create or replace function fn_update_meta(p_nome text, p_senha text, p_dn integer, p_meta integer)
returns boolean
language plpgsql
security definer
as $$
declare
  v_perfil text;
  v_ref text;
  v_ok boolean;
begin
  select perfil, nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha);

  if v_perfil = 'admin' then
    v_ok := true;
  else
    select case v_perfil
      when 'gcm' then (gcm = v_ref)
      when 'coordenador' then (coordenador = v_ref)
      when 'regional' then (regional = v_ref)
      else false
    end into v_ok
    from lojas where dn = p_dn;
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'sem permissão para esta loja';
  end if;

  update lojas set meta = p_meta, atualizado_em = now() where dn = p_dn;
  return true;
end;
$$;

grant execute on function fn_update_meta(text, text, integer, integer) to anon;

-- --------------------------------------------------------------------------
-- FUNÇÃO: upload "Lojas" (PARAM - REGIONAL) — admin only
-- p_rows: jsonb array de {dn, nome_loja, gcm, coordenador, regional}
-- --------------------------------------------------------------------------

create or replace function fn_upload_lojas(p_nome text, p_senha text, p_rows jsonb)
returns integer
language plpgsql
security definer
as $$
declare
  v_perfil text;
  v_ref text;
  v_count integer;
begin
  select perfil, nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha);
  if v_perfil <> 'admin' then
    raise exception 'apenas admin pode fazer este upload';
  end if;

  with dados as (
    select
      (r->>'dn')::integer as dn,
      r->>'nome_loja' as nome_loja,
      r->>'gcm' as gcm,
      r->>'coordenador' as coordenador,
      r->>'regional' as regional
    from jsonb_array_elements(p_rows) as r
  )
  insert into lojas (dn, nome_loja, gcm, coordenador, regional)
  select dn, nome_loja, gcm, coordenador, regional from dados
  on conflict (dn) do update
    set nome_loja = excluded.nome_loja,
        gcm = excluded.gcm,
        coordenador = excluded.coordenador,
        regional = excluded.regional,
        atualizado_em = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function fn_upload_lojas(text, text, jsonb) to anon;

-- --------------------------------------------------------------------------
-- FUNÇÃO: upload "Potencial" — admin only
-- p_rows: jsonb array de {dn, gravames_mercado, potencial}
-- --------------------------------------------------------------------------

create or replace function fn_upload_potencial(p_nome text, p_senha text, p_rows jsonb)
returns integer
language plpgsql
security definer
as $$
declare
  v_perfil text;
  v_ref text;
  v_count integer;
begin
  select perfil, nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha);
  if v_perfil <> 'admin' then
    raise exception 'apenas admin pode fazer este upload';
  end if;

  with dados as (
    select
      (r->>'dn')::integer as dn,
      (r->>'gravames_mercado')::integer as gravames_mercado,
      r->>'potencial' as potencial
    from jsonb_array_elements(p_rows) as r
  )
  update lojas l
  set gravames_mercado = d.gravames_mercado,
      potencial = d.potencial,
      atualizado_em = now()
  from dados d
  where l.dn = d.dn;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function fn_upload_potencial(text, text, jsonb) to anon;

-- --------------------------------------------------------------------------
-- FUNÇÃO: atualizar M1 direto, sem rotação (ajuste dentro do mês) — admin only
-- p_rows: jsonb array de {dn, contratos}
-- --------------------------------------------------------------------------

create or replace function fn_update_m1(p_nome text, p_senha text, p_rows jsonb)
returns integer
language plpgsql
security definer
as $$
declare
  v_perfil text;
  v_count integer;
begin
  select perfil into v_perfil from _valida_usuario(p_nome, p_senha);
  if v_perfil <> 'admin' then
    raise exception 'apenas admin pode fazer este upload';
  end if;

  with dados as (
    select
      (r->>'dn')::integer as dn,
      (r->>'contratos')::integer as contratos
    from jsonb_array_elements(p_rows) as r
  )
  update lojas l
  set m1 = d.contratos,
      atualizado_em = now()
  from dados d
  where l.dn = d.dn;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function fn_update_m1(text, text, jsonb) to anon;

-- --------------------------------------------------------------------------
-- FUNÇÃO: atualizar M2 direto, sem rotação — admin only
-- p_rows: jsonb array de {dn, contratos}
-- --------------------------------------------------------------------------

create or replace function fn_update_m2(p_nome text, p_senha text, p_rows jsonb)
returns integer
language plpgsql
security definer
as $$
declare
  v_perfil text;
  v_count integer;
begin
  select perfil into v_perfil from _valida_usuario(p_nome, p_senha);
  if v_perfil <> 'admin' then
    raise exception 'apenas admin pode fazer este upload';
  end if;

  with dados as (
    select
      (r->>'dn')::integer as dn,
      (r->>'contratos')::integer as contratos
    from jsonb_array_elements(p_rows) as r
  )
  update lojas l
  set m2 = d.contratos,
      atualizado_em = now()
  from dados d
  where l.dn = d.dn;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function fn_update_m2(text, text, jsonb) to anon;

-- --------------------------------------------------------------------------
-- FUNÇÃO: atualizar M3 direto, sem rotação — admin only
-- p_rows: jsonb array de {dn, contratos}
-- --------------------------------------------------------------------------

create or replace function fn_update_m3(p_nome text, p_senha text, p_rows jsonb)
returns integer
language plpgsql
security definer
as $$
declare
  v_perfil text;
  v_count integer;
begin
  select perfil into v_perfil from _valida_usuario(p_nome, p_senha);
  if v_perfil <> 'admin' then
    raise exception 'apenas admin pode fazer este upload';
  end if;

  with dados as (
    select
      (r->>'dn')::integer as dn,
      (r->>'contratos')::integer as contratos
    from jsonb_array_elements(p_rows) as r
  )
  update lojas l
  set m3 = d.contratos,
      atualizado_em = now()
  from dados d
  where l.dn = d.dn;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function fn_update_m3(text, text, jsonb) to anon;

-- --------------------------------------------------------------------------
-- FUNÇÃO: "Novo Mês" — rotaciona M3<-M2, M2<-M1, M1<-0 para TODAS as lojas,
-- depois grava os contratos enviados em M1. — admin only
-- p_rows: jsonb array de {dn, contratos}
-- --------------------------------------------------------------------------

create or replace function fn_novo_mes(p_nome text, p_senha text, p_rows jsonb)
returns integer
language plpgsql
security definer
as $$
declare
  v_perfil text;
  v_count integer;
begin
  select perfil into v_perfil from _valida_usuario(p_nome, p_senha);
  if v_perfil <> 'admin' then
    raise exception 'apenas admin pode fazer este upload';
  end if;

  -- rotação para todas as lojas
  update lojas set m3 = m2, m2 = m1, m1 = 0, atualizado_em = now();

  -- grava contratos do novo mês em M1 apenas para as lojas enviadas
  with dados as (
    select
      (r->>'dn')::integer as dn,
      (r->>'contratos')::integer as contratos
    from jsonb_array_elements(p_rows) as r
  )
  update lojas l
  set m1 = d.contratos,
      atualizado_em = now()
  from dados d
  where l.dn = d.dn;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function fn_novo_mes(text, text, jsonb) to anon;

-- ==========================================================================
-- COMO CRIAR USUÁRIOS (rode manualmente, um de cada vez, trocando os dados)
-- ==========================================================================
-- select admin_upsert_usuario('admin', 'SUA_SENHA_AQUI', 'admin', null);
-- select admin_upsert_usuario('marcos.custodio', 'senha123', 'gcm', 'MARCOS ALEXANDRE CUSTODIO');
-- select admin_upsert_usuario('hermes.junior', 'senha123', 'coordenador', 'HERMES FIDELES JUNIOR');
-- select admin_upsert_usuario('henrique.silverio', 'senha123', 'regional', 'HENRIQUE CAMPAGNUOLO SILVERIO');
--
-- IMPORTANTE: nome_referencia precisa bater EXATAMENTE (mesmo texto, maiúsculas)
-- com o valor da coluna GCM / NM_FILIAL / NM_GERENCIA da planilha de lojas.
-- ==========================================================================
