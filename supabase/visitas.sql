-- ==========================================================================
-- META POR LOJA — VISITAS + INCLUIR/EXCLUIR LOJA
-- Rode este arquivo inteiro no SQL Editor do Supabase (pode rodar de novo
-- sem problema: ele só cria o que ainda não existe e atualiza as funções).
-- ==========================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- TABELAS
-- --------------------------------------------------------------------------

-- Endereço e posição de cada loja (separado de "lojas" para não mexer nos uploads)
create table if not exists lojas_local (
  dn integer primary key,
  logradouro text,
  numero text,
  bairro text,
  cep text,
  latitude double precision,
  longitude double precision,
  posicao_confirmada boolean not null default false,  -- true = salva na loja pelo botão
  atualizado_em timestamptz not null default now()
);

-- Cada linha = uma visita. Sem chave estrangeira de propósito:
-- apagar uma loja não apaga o histórico de visitas.
create table if not exists visitas (
  id bigserial primary key,
  dn integer not null,
  usuario text not null,                 -- login de quem marcou
  visitada_em timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  distancia_m integer,
  precisao_m integer,
  origem text not null check (origem in ('gps', 'atalho', 'manual', 'migrada')),
  origem_id text unique                  -- id no site antigo (evita importar 2x)
);

create index if not exists idx_visitas_dn_data on visitas (dn, visitada_em);

alter table usuarios add column if not exists token_atalho_hash text;

alter table lojas_local enable row level security;
alter table visitas enable row level security;
revoke all on lojas_local from anon, authenticated;
revoke all on visitas from anon, authenticated;

-- --------------------------------------------------------------------------
-- AJUDANTES (internos, não liberados para o site)
-- --------------------------------------------------------------------------

-- A loja está na carteira do usuário?
create or replace function _visita_no_escopo(
  p_perfil text, p_ref text, p_gcm text, p_coordenador text, p_regional text
) returns boolean
language sql immutable
as $$
  select case p_perfil
    when 'admin'       then true
    when 'gcm'         then p_gcm         = p_ref
    when 'coordenador' then p_coordenador = p_ref
    when 'regional'    then p_regional    = p_ref
    else false
  end;
$$;

-- Distância em metros entre dois pontos (fórmula de Haversine)
create or replace function _distancia_m(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
) returns double precision
language sql immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$$;

-- Início do dia de hoje no fuso de São Paulo
create or replace function _inicio_hoje_sp() returns timestamptz
language sql stable
as $$
  select (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
$$;

-- Regra única de marcação por posição (usada pelo site aberto e pelo atalho):
-- acha a loja MAIS PRÓXIMA da carteira; marca só se estiver a até 30 m,
-- e só uma vez por dia (marcações automáticas).
create or replace function _visita_por_posicao(
  p_usuario text, p_perfil text, p_ref text,
  p_lat double precision, p_lon double precision,
  p_precisao double precision, p_origem text
) returns jsonb
language plpgsql security definer
as $$
declare
  c_raio constant double precision := 30;
  c_precisao_max constant double precision := 30;
  v_dn integer;
  v_nome text;
  v_dist double precision;
begin
  if p_lat is null or p_lon is null then
    return jsonb_build_object('status', 'sem_posicao', 'mensagem', 'Não recebi a localização.');
  end if;

  if p_precisao is not null and p_precisao > c_precisao_max then
    return jsonb_build_object('status', 'sem_precisao',
      'mensagem', format('GPS impreciso (%s m). Aguardando sinal melhor.', round(p_precisao)));
  end if;

  select l.dn, l.nome_loja, _distancia_m(p_lat, p_lon, ll.latitude, ll.longitude)
    into v_dn, v_nome, v_dist
  from lojas l
  join lojas_local ll on ll.dn = l.dn
  where ll.latitude is not null and ll.longitude is not null
    and _visita_no_escopo(p_perfil, p_ref, l.gcm, l.coordenador, l.regional)
  order by _distancia_m(p_lat, p_lon, ll.latitude, ll.longitude)
  limit 1;

  if v_dn is null then
    return jsonb_build_object('status', 'longe', 'mensagem', 'Nenhuma loja com posição cadastrada.');
  end if;

  if v_dist > c_raio then
    return jsonb_build_object('status', 'longe', 'dn', v_dn, 'nome_loja', v_nome,
      'distancia', round(v_dist),
      'mensagem', format('Nenhuma loja aqui. Mais próxima: %s (%s m).', v_nome, round(v_dist)));
  end if;

  if exists (
    select 1 from visitas
    where dn = v_dn and visitada_em >= _inicio_hoje_sp()
      and origem in ('gps', 'atalho')
  ) then
    return jsonb_build_object('status', 'ja_marcada', 'dn', v_dn, 'nome_loja', v_nome,
      'distancia', round(v_dist),
      'mensagem', format('%s já estava marcada hoje.', v_nome));
  end if;

  insert into visitas (dn, usuario, latitude, longitude, distancia_m, precisao_m, origem)
  values (v_dn, p_usuario, p_lat, p_lon, round(v_dist), round(p_precisao), p_origem);

  return jsonb_build_object('status', 'marcada', 'dn', v_dn, 'nome_loja', v_nome,
    'distancia', round(v_dist),
    'mensagem', format('Visita marcada: %s (%s m).', v_nome, round(v_dist)));
end;
$$;

-- Confere se a loja está na carteira do usuário (erro se não estiver)
create or replace function _exige_loja_no_escopo(p_perfil text, p_ref text, p_dn integer)
returns void
language plpgsql security definer
as $$
begin
  if not exists (
    select 1 from lojas l
    where l.dn = p_dn
      and _visita_no_escopo(p_perfil, p_ref, l.gcm, l.coordenador, l.regional)
  ) then
    raise exception 'sem permissão para esta loja';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- FUNÇÕES USADAS PELO SITE
-- --------------------------------------------------------------------------

-- Lista as lojas da carteira com as visitas do período (datas no fuso de SP).
-- visitas_lista = cada visita do período: [{id, origem, em}], da mais antiga para a mais nova.
drop function if exists fn_visitas_painel(text, text, date, date);
create or replace function fn_visitas_painel(p_nome text, p_senha text, p_de date, p_ate date)
returns table (
  dn integer,
  nome_loja text,
  gcm text,
  gravames_mercado integer,
  mes_atual integer,
  logradouro text,
  numero text,
  bairro text,
  cep text,
  latitude double precision,
  longitude double precision,
  posicao_confirmada boolean,
  visitas integer,
  ultima_visita timestamptz,
  visitou_hoje boolean,
  visitas_lista jsonb
)
language plpgsql security definer
as $$
#variable_conflict use_column
declare
  v_perfil text;
  v_ref text;
  v_ini timestamptz := p_de::timestamp at time zone 'America/Sao_Paulo';
  v_fim timestamptz := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  select u.perfil, u.nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha) u;

  return query
  select
    l.dn, l.nome_loja, l.gcm,
    coalesce(l.gravames_mercado, 0), coalesce(l.mes_atual, 0),
    ll.logradouro, ll.numero, ll.bairro, ll.cep,
    ll.latitude, ll.longitude, coalesce(ll.posicao_confirmada, false),
    (select count(*)::integer from visitas v
      where v.dn = l.dn and v.visitada_em >= v_ini and v.visitada_em < v_fim),
    (select max(v.visitada_em) from visitas v where v.dn = l.dn),
    exists (select 1 from visitas v where v.dn = l.dn and v.visitada_em >= _inicio_hoje_sp()),
    coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'origem', v.origem, 'em', v.visitada_em)
                               order by v.visitada_em)
              from visitas v
              where v.dn = l.dn and v.visitada_em >= v_ini and v.visitada_em < v_fim), '[]'::jsonb)
  from lojas l
  left join lojas_local ll on ll.dn = l.dn
  where _visita_no_escopo(v_perfil, v_ref, l.gcm, l.coordenador, l.regional)
  order by l.nome_loja;
end;
$$;

-- Marcação manual (toque no quadradinho)
create or replace function fn_visita_marcar(
  p_nome text, p_senha text, p_dn integer,
  p_lat double precision default null, p_lon double precision default null
) returns boolean
language plpgsql security definer
as $$
declare
  v_perfil text;
  v_ref text;
begin
  select u.perfil, u.nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha) u;
  perform _exige_loja_no_escopo(v_perfil, v_ref, p_dn);

  insert into visitas (dn, usuario, latitude, longitude, origem)
  values (p_dn, p_nome, p_lat, p_lon, 'manual');
  return true;
end;
$$;

-- Desmarca: apaga a visita mais recente da loja dentro do período
create or replace function fn_visita_desmarcar(
  p_nome text, p_senha text, p_dn integer, p_de date, p_ate date
) returns boolean
language plpgsql security definer
as $$
declare
  v_perfil text;
  v_ref text;
  v_id bigint;
begin
  select u.perfil, u.nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha) u;
  perform _exige_loja_no_escopo(v_perfil, v_ref, p_dn);

  select v.id into v_id from visitas v
  where v.dn = p_dn
    and v.visitada_em >= (p_de::timestamp at time zone 'America/Sao_Paulo')
    and v.visitada_em <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  order by v.visitada_em desc
  limit 1;

  if v_id is null then
    return false;
  end if;

  delete from visitas where id = v_id;
  return true;
end;
$$;

-- Remove UMA visita específica (escolhida no detalhe da loja)
create or replace function fn_visita_remover(p_nome text, p_senha text, p_id bigint)
returns boolean
language plpgsql security definer
as $$
declare
  v_perfil text;
  v_ref text;
  v_dn integer;
begin
  select u.perfil, u.nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha) u;
  select v.dn into v_dn from visitas v where v.id = p_id;
  if v_dn is null then
    return false;
  end if;
  perform _exige_loja_no_escopo(v_perfil, v_ref, v_dn);
  delete from visitas where id = p_id;
  return true;
end;
$$;

-- Marcação automática com o site aberto
create or replace function fn_visita_gps(
  p_nome text, p_senha text,
  p_lat double precision, p_lon double precision, p_precisao double precision
) returns jsonb
language plpgsql security definer
as $$
declare
  v_perfil text;
  v_ref text;
begin
  select u.perfil, u.nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha) u;
  return _visita_por_posicao(p_nome, v_perfil, v_ref, p_lat, p_lon, p_precisao, 'gps');
end;
$$;

-- "Estou na loja — salvar posição"
create or replace function fn_loja_salvar_posicao(
  p_nome text, p_senha text, p_dn integer,
  p_lat double precision, p_lon double precision
) returns boolean
language plpgsql security definer
as $$
declare
  v_perfil text;
  v_ref text;
begin
  select u.perfil, u.nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha) u;
  perform _exige_loja_no_escopo(v_perfil, v_ref, p_dn);

  insert into lojas_local (dn, latitude, longitude, posicao_confirmada, atualizado_em)
  values (p_dn, p_lat, p_lon, true, now())
  on conflict (dn) do update
    set latitude = excluded.latitude,
        longitude = excluded.longitude,
        posicao_confirmada = true,
        atualizado_em = now();
  return true;
end;
$$;

-- Gera (ou troca) a senha do atalho do iPhone. A senha só aparece agora;
-- no banco fica guardado apenas o "hash" dela.
create or replace function fn_atalho_gerar_token(p_nome text, p_senha text)
returns text
language plpgsql security definer
as $$
declare
  v_perfil text;
  v_ref text;
  v_token text;
begin
  select u.perfil, u.nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha) u;
  v_token := encode(gen_random_bytes(16), 'hex');
  update usuarios set token_atalho_hash = encode(digest(v_token, 'sha256'), 'hex')
  where nome = p_nome;
  return v_token;
end;
$$;

-- O usuário já tem senha do atalho?
create or replace function fn_atalho_tem_token(p_nome text, p_senha text)
returns boolean
language plpgsql security definer
as $$
declare
  v_perfil text;
  v_ref text;
begin
  select u.perfil, u.nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha) u;
  return exists (select 1 from usuarios where nome = p_nome and token_atalho_hash is not null);
end;
$$;

-- Chamado pelo ATALHO DO IPHONE. Não usa a senha do login, só a do atalho.
-- Devolve uma frase pronta para aparecer na notificação.
create or replace function fn_atalho_visita(
  p_token text, p_lat double precision, p_lon double precision,
  p_precisao double precision default null
) returns text
language plpgsql security definer
as $$
declare
  v_nome text;
  v_perfil text;
  v_ref text;
  v_res jsonb;
begin
  select u.nome, u.perfil, u.nome_referencia into v_nome, v_perfil, v_ref
  from usuarios u
  where p_token is not null and length(p_token) >= 16
    and u.token_atalho_hash = encode(digest(trim(p_token), 'sha256'), 'hex');

  if v_nome is null then
    return 'Senha do atalho inválida. Gere uma nova no Meta por Loja.';
  end if;

  v_res := _visita_por_posicao(v_nome, v_perfil, v_ref, p_lat, p_lon, p_precisao, 'atalho');
  return v_res->>'mensagem';
end;
$$;

grant execute on function fn_visitas_painel(text, text, date, date) to anon;
grant execute on function fn_visita_marcar(text, text, integer, double precision, double precision) to anon;
grant execute on function fn_visita_desmarcar(text, text, integer, date, date) to anon;
grant execute on function fn_visita_remover(text, text, bigint) to anon;
grant execute on function fn_visita_gps(text, text, double precision, double precision, double precision) to anon;
grant execute on function fn_loja_salvar_posicao(text, text, integer, double precision, double precision) to anon;
grant execute on function fn_atalho_gerar_token(text, text) to anon;
grant execute on function fn_atalho_tem_token(text, text) to anon;
grant execute on function fn_atalho_visita(text, double precision, double precision, double precision) to anon;

-- --------------------------------------------------------------------------
-- GESTÃO DE LOJAS: excluir (agora também GCM) e incluir uma loja na mão.
-- Tudo na tabela "lojas", então reflete no Painel e nas Visitas.
-- --------------------------------------------------------------------------

-- Excluir loja: qualquer perfil, desde que a loja esteja na sua carteira.
-- O histórico de visitas e a posição ficam guardados pelo DN (se a loja
-- voltar com o mesmo DN, eles voltam junto).
create or replace function fn_excluir_loja(p_nome text, p_senha text, p_dn integer)
returns boolean
language plpgsql security definer
as $$
declare
  v_perfil text;
  v_ref text;
begin
  select u.perfil, u.nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha) u;
  perform _exige_loja_no_escopo(v_perfil, v_ref, p_dn);
  delete from lojas where dn = p_dn;
  return true;
end;
$$;

-- Incluir uma loja na mão.
-- GCM: a loja entra na própria carteira; coordenador/regional são copiados das
--      outras lojas do GCM. Coordenador/regional: entram como responsáveis.
-- Admin: escolhe tudo (coordenador/regional em branco = copiados do GCM).
create or replace function fn_incluir_loja(
  p_nome text, p_senha text,
  p_dn integer, p_nome_loja text,
  p_gcm text default null, p_coordenador text default null, p_regional text default null,
  p_logradouro text default null, p_numero text default null,
  p_bairro text default null, p_cep text default null
) returns boolean
language plpgsql security definer
as $$
declare
  v_perfil text;
  v_ref text;
  v_gcm text := nullif(trim(p_gcm), '');
  v_coord text := nullif(trim(p_coordenador), '');
  v_reg text := nullif(trim(p_regional), '');
  v_nome_loja text := upper(nullif(trim(p_nome_loja), ''));
  v_existente record;
begin
  select u.perfil, u.nome_referencia into v_perfil, v_ref from _valida_usuario(p_nome, p_senha) u;

  if p_dn is null or p_dn <= 0 then
    raise exception 'Informe um DN válido (só números).';
  end if;
  if v_nome_loja is null then
    raise exception 'Informe o nome da loja.';
  end if;

  select l.nome_loja, l.gcm into v_existente from lojas l where l.dn = p_dn;
  if found then
    raise exception 'O DN % já está cadastrado (% · GCM %).', p_dn, v_existente.nome_loja, coalesce(v_existente.gcm, '-');
  end if;

  if v_perfil = 'gcm' then
    v_gcm := v_ref;
    v_coord := null;
    v_reg := null;
  elsif v_perfil = 'coordenador' then
    v_coord := v_ref;
  elsif v_perfil = 'regional' then
    v_reg := v_ref;
  end if;

  if v_gcm is null then
    raise exception 'Informe o GCM da loja.';
  end if;

  -- Completa coordenador/regional com o que é mais comum nas lojas do GCM
  if v_coord is null then
    select l.coordenador into v_coord from lojas l
    where l.gcm = v_gcm and l.coordenador is not null
    group by l.coordenador order by count(*) desc limit 1;
  end if;
  if v_reg is null then
    select l.regional into v_reg from lojas l
    where l.gcm = v_gcm and l.regional is not null
    group by l.regional order by count(*) desc limit 1;
  end if;

  if not _visita_no_escopo(v_perfil, v_ref, v_gcm, v_coord, v_reg) then
    raise exception 'Essa loja ficaria fora da sua carteira.';
  end if;

  insert into lojas (dn, nome_loja, gcm, coordenador, regional)
  values (p_dn, v_nome_loja, v_gcm, v_coord, v_reg);

  if coalesce(nullif(trim(p_logradouro), ''), nullif(trim(p_numero), ''),
              nullif(trim(p_bairro), ''), nullif(trim(p_cep), '')) is not null then
    insert into lojas_local (dn, logradouro, numero, bairro, cep)
    values (p_dn, upper(nullif(trim(p_logradouro), '')), nullif(trim(p_numero), ''),
            upper(nullif(trim(p_bairro), '')), nullif(trim(p_cep), ''))
    on conflict (dn) do update
      set logradouro = excluded.logradouro,
          numero = excluded.numero,
          bairro = excluded.bairro,
          cep = excluded.cep,
          atualizado_em = now();
  end if;

  return true;
end;
$$;

grant execute on function fn_excluir_loja(text, text, integer) to anon;
grant execute on function fn_incluir_loja(text, text, integer, text, text, text, text, text, text, text, text) to anon;

-- Ajudantes internos não ficam acessíveis pelo site
revoke execute on function _visita_por_posicao(text, text, text, double precision, double precision, double precision, text) from public, anon, authenticated;
revoke execute on function _exige_loja_no_escopo(text, text, integer) from public, anon, authenticated;
