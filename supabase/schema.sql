-- Contadores de agua · esquema de Supabase
-- Pegar entero en Supabase > SQL Editor > Run. Se puede ejecutar más de una vez.
-- Al final devuelve el token de acceso que va en el enlace de la app.

create extension if not exists pgcrypto;

-- ============ Tablas ============

create table if not exists contadores (
  id                  serial primary key,
  nombre              text not null unique,
  orden               int  not null default 0,
  digitos_enteros     int  not null default 6 check (digitos_enteros between 1 and 12),
  umbral_fuga_pct     int  not null default 50 check (umbral_fuga_pct >= 0),
  umbral_fuga_min_m3  numeric(10,3) not null default 0.5 check (umbral_fuga_min_m3 >= 0),
  ventana_dias        int  not null default 14 check (ventana_dias between 3 and 90),
  activo              boolean not null default true
);

create table if not exists lecturas (
  id               bigserial primary key,
  contador_id      int not null references contadores(id),
  fecha            date not null,
  valor_milesimas  bigint not null check (valor_milesimas >= 0),
  origen           text not null check (origen in ('manual','foto')),
  cifras_dudosas   text,
  ocr_crudo        jsonb,
  reseteo          boolean not null default false,
  operario         text not null check (length(btrim(operario)) > 0),
  creada_en        timestamptz not null default now(),
  unique (contador_id, fecha)
);

create table if not exists correcciones (
  id                        bigserial primary key,
  lectura_id                bigint not null references lecturas(id),
  valor_anterior_milesimas  bigint not null,
  valor_nuevo_milesimas     bigint not null,
  reseteo_anterior          boolean not null,
  reseteo_nuevo             boolean not null,
  operario                  text not null check (length(btrim(operario)) > 0),
  motivo                    text,
  corregida_en              timestamptz not null default now()
);

create table if not exists acceso (
  token text primary key,
  creado_en timestamptz not null default now()
);

-- ============ Sin borrado ni edición del histórico ============

create or replace function no_borrar() returns trigger language plpgsql as $$
begin
  raise exception 'El histórico no se puede borrar ni modificar así';
end $$;

drop trigger if exists lecturas_no_delete on lecturas;
create trigger lecturas_no_delete before delete on lecturas
  for each row execute function no_borrar();

drop trigger if exists correcciones_no_delete on correcciones;
create trigger correcciones_no_delete before delete on correcciones
  for each row execute function no_borrar();

drop trigger if exists correcciones_no_update on correcciones;
create trigger correcciones_no_update before update on correcciones
  for each row execute function no_borrar();

drop trigger if exists contadores_no_delete on contadores;
create trigger contadores_no_delete before delete on contadores
  for each row execute function no_borrar();

-- ============ Acceso: ninguna tabla es accesible directamente ============

alter table contadores   enable row level security;
alter table lecturas     enable row level security;
alter table correcciones enable row level security;
alter table acceso       enable row level security;

revoke all on contadores, lecturas, correcciones, acceso from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ============ Funciones que usa la app (validan el token) ============

create or replace function _check(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_token is null or not exists (select 1 from acceso where token = p_token) then
    raise exception 'Enlace no válido';
  end if;
end $$;

create or replace function app_datos(p_token text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _check(p_token);
  return json_build_object(
    'contadores', (select coalesce(json_agg(c order by c.orden, c.id), '[]'::json) from contadores c where c.activo),
    'lecturas',   (select coalesce(json_agg(json_build_object(
                      'id', l.id, 'contador_id', l.contador_id, 'fecha', l.fecha,
                      'valor', l.valor_milesimas, 'origen', l.origen, 'cifras_dudosas', l.cifras_dudosas,
                      'reseteo', l.reseteo, 'operario', l.operario, 'creada_en', l.creada_en
                    ) order by l.fecha), '[]'::json) from lecturas l),
    'correcciones', (select coalesce(json_agg(json_build_object(
                      'id', r.id, 'lectura_id', r.lectura_id,
                      'valor_anterior', r.valor_anterior_milesimas, 'valor_nuevo', r.valor_nuevo_milesimas,
                      'reseteo_anterior', r.reseteo_anterior, 'reseteo_nuevo', r.reseteo_nuevo,
                      'operario', r.operario, 'motivo', r.motivo, 'corregida_en', r.corregida_en
                    ) order by r.corregida_en), '[]'::json) from correcciones r)
  );
end $$;

create or replace function app_guardar_lectura(
  p_token text, p_contador int, p_fecha date, p_valor bigint, p_origen text,
  p_dudosas text, p_ocr jsonb, p_reseteo boolean, p_operario text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_dig int; v_id bigint;
begin
  perform _check(p_token);
  select digitos_enteros into v_dig from contadores where id = p_contador and activo;
  if v_dig is null then raise exception 'Contador no válido'; end if;
  if p_valor < 0 or p_valor >= (10::numeric ^ (v_dig + 3)) then
    raise exception 'La lectura tiene más dígitos de los configurados (% enteros)', v_dig;
  end if;
  if p_fecha > (now() at time zone 'Europe/Madrid')::date then
    raise exception 'No se puede registrar una lectura con fecha futura';
  end if;
  if p_operario is null or length(btrim(p_operario)) = 0 then
    raise exception 'Falta el nombre del operario';
  end if;
  insert into lecturas (contador_id, fecha, valor_milesimas, origen, cifras_dudosas, ocr_crudo, reseteo, operario)
  values (p_contador, p_fecha, p_valor, p_origen, p_dudosas, p_ocr, coalesce(p_reseteo,false), btrim(p_operario))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Ya existe una lectura de ese contador para ese día. Corrígela desde el historial.';
end $$;

create or replace function app_corregir_lectura(
  p_token text, p_lectura bigint, p_valor bigint, p_reseteo boolean, p_operario text, p_motivo text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  l lecturas%rowtype; v_dig int;
begin
  perform _check(p_token);
  if p_operario is null or length(btrim(p_operario)) = 0 then
    raise exception 'Falta el nombre del operario';
  end if;
  select * into l from lecturas where id = p_lectura for update;
  if not found then raise exception 'Lectura no encontrada'; end if;
  select digitos_enteros into v_dig from contadores where id = l.contador_id;
  if p_valor < 0 or p_valor >= (10::numeric ^ (v_dig + 3)) then
    raise exception 'La lectura tiene más dígitos de los configurados (% enteros)', v_dig;
  end if;
  if p_valor = l.valor_milesimas and coalesce(p_reseteo,false) = l.reseteo then
    raise exception 'No hay ningún cambio que guardar';
  end if;
  insert into correcciones (lectura_id, valor_anterior_milesimas, valor_nuevo_milesimas,
                            reseteo_anterior, reseteo_nuevo, operario, motivo)
  values (l.id, l.valor_milesimas, p_valor, l.reseteo, coalesce(p_reseteo,false), btrim(p_operario), nullif(btrim(p_motivo),''));
  update lecturas set valor_milesimas = p_valor, reseteo = coalesce(p_reseteo,false) where id = l.id;
end $$;

create or replace function app_ajustes_contador(
  p_token text, p_contador int, p_digitos int, p_pct int, p_min numeric, p_ventana int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check(p_token);
  update contadores set digitos_enteros = p_digitos, umbral_fuga_pct = p_pct,
         umbral_fuga_min_m3 = p_min, ventana_dias = p_ventana
   where id = p_contador;
end $$;

revoke all on function _check(text) from public, anon, authenticated;
revoke all on function app_datos(text) from public;
revoke all on function app_guardar_lectura(text,int,date,bigint,text,text,jsonb,boolean,text) from public;
revoke all on function app_corregir_lectura(text,bigint,bigint,boolean,text,text) from public;
revoke all on function app_ajustes_contador(text,int,int,int,numeric,int) from public;
grant execute on function app_datos(text) to anon;
grant execute on function app_guardar_lectura(text,int,date,bigint,text,text,jsonb,boolean,text) to anon;
grant execute on function app_corregir_lectura(text,bigint,bigint,boolean,text,text) to anon;
grant execute on function app_ajustes_contador(text,int,int,int,numeric,int) to anon;

-- ============ Datos iniciales ============

insert into contadores (nombre, orden) values ('Botafoc',1), ('Centro',2), ('Marina Seca',3)
on conflict (nombre) do nothing;

insert into acceso (token)
select encode(gen_random_bytes(24), 'hex') where not exists (select 1 from acceso);

-- Esta es la parte del enlace: https://iaelicozzolino-boop.github.io/contadores-de-agua/#t=<token>
select token from acceso;
