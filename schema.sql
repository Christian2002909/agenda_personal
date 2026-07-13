-- =====================================================================
-- SCHEMA.SQL — Fase 1: tabla `clientes`
-- Estudio contable (Paraguay) · Backend Supabase (Postgres)
-- App de escritorio Electron, sin backend intermedio (usa anon key)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLA clientes
-- ---------------------------------------------------------------------
create table if not exists public.clientes (
    id                  bigint generated always as identity primary key,

    -- RUC paraguayo: dígitos + guion + dígito verificador (ej: "80012345-6")
    ruc                 text not null,

    razon_social        text not null,

    -- Último dígito antes del guion del RUC. Se puede derivar automáticamente
    -- en la app, pero queda editable a mano. Se usará en fases posteriores
    -- para calcular el vencimiento mensual de IVA según el calendario del SET.
    terminacion_ruc     smallint,

    -- Encargado del cliente dentro del estudio. Texto libre: todavía no hay
    -- tabla de usuarios/autenticación, así que no es una FK.
    responsable         text not null,

    -- Mes de cierre del ejercicio fiscal de este cliente. Según el Decreto
    -- 3182/2019 (DNIT), no cualquier mes es válido: 12 = diciembre (regla
    -- general), 4 = abril (ingenios azucareros y cooperativas que
    -- industrializan productos agropecuarios), 6 = junio (aseguradoras/
    -- reaseguradoras e industrias de cerveza/gaseosas). calendario-logica.js
    -- usa este valor para calcular en qué mes vencen IRE SIMPLE/GENERAL,
    -- ESTADO FINANCIERO, IRP-RSP e IRP-RGC.
    cierre_fiscal_mes   smallint not null default 12,

    -- Clave de acceso del cliente al Sistema Marangatu (SET, Paraguay).
    -- Texto plano a propósito: el estudio ya la maneja así en su Excel de
    -- trabajo y la necesita visible de un vistazo, no oculta/encriptada.
    clave_marangatu     text,

    -- Membrete personalizado para la ficha de pago de ESTE cliente en
    -- particular (nombre del estudio/oficina, dirección, teléfono). Todos
    -- opcionales: si están en null, la ficha usa el membrete general de
    -- `configuracion_estudio`. Sirve para estudios con varias sucursales u
    -- oficinas que atienden distintos clientes con membretes distintos.
    membrete_nombre     text,
    membrete_direccion  text,
    membrete_telefono   text,

    fecha_alta          date not null default current_date,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint clientes_ruc_unique
        unique (ruc),

    constraint clientes_ruc_formato
        check (ruc ~ '^[0-9]{1,8}-[0-9]$'),

    constraint clientes_terminacion_ruc_rango
        check (terminacion_ruc is null or terminacion_ruc between 0 and 9),

    constraint clientes_cierre_fiscal_mes_rango
        check (cierre_fiscal_mes in (4, 6, 12))
);

-- Migración para bases ya existentes creadas antes de este campo (la
-- CREATE TABLE de arriba ya lo incluye para instalaciones nuevas; estas
-- líneas son no-op si la columna/constraint ya existen). Va ANTES de los
-- `comment on column` de abajo a propósito: si la tabla ya existía sin
-- esta columna, el CREATE TABLE de arriba fue un no-op y la columna
-- todavía no existe hasta que corre este ALTER.
alter table public.clientes
    add column if not exists cierre_fiscal_mes smallint not null default 12;

alter table public.clientes
    add column if not exists clave_marangatu text;

alter table public.clientes
    add column if not exists membrete_nombre text;

alter table public.clientes
    add column if not exists membrete_direccion text;

alter table public.clientes
    add column if not exists membrete_telefono text;

-- "Tipo de Contribuyente" quedó redundante desde que cada cliente elige a
-- mano qué obligaciones le corresponden (tabla cliente_obligaciones, ver
-- sección 6.1): antes se usaba solo para sugerir esas obligaciones. Se
-- borra la columna (y de paso el índice y el check constraint que
-- dependían de ella, Postgres los elimina solo al borrar la columna).
alter table public.clientes
    drop column if exists tipo_contribuyente;

-- El rango válido de cierre_fiscal_mes cambió de "1 a 12" a "solo 4, 6 o
-- 12" (Decreto 3182/2019). Se borra y se vuelve a crear el constraint
-- porque un `add constraint` con el mismo nombre no actualiza la
-- condición si ya existía con la regla vieja.
alter table public.clientes
    drop constraint if exists clientes_cierre_fiscal_mes_rango;

alter table public.clientes
    add constraint clientes_cierre_fiscal_mes_rango
    check (cierre_fiscal_mes in (4, 6, 12));

comment on table  public.clientes is
    'Clientes del estudio contable (Fase 1). Obligaciones, honorarios, etc. se agregan en fases posteriores.';
comment on column public.clientes.terminacion_ruc is
    'Último dígito antes del guion del RUC; se usa luego para el calendario de vencimientos de IVA (SET).';
comment on column public.clientes.responsable is
    'Encargado del cliente dentro del estudio (texto libre, sin FK a usuarios todavía).';
comment on column public.clientes.cierre_fiscal_mes is
    'Mes de cierre del ejercicio fiscal: 12 = diciembre (regla general), 4 = abril, 6 = junio (excepciones del Decreto 3182/2019). Usado por calendario-logica.js para IRE SIMPLE/GENERAL, ESTADO FINANCIERO, IRP-RSP e IRP-RGC.';
comment on column public.clientes.clave_marangatu is
    'Clave de acceso del cliente al Sistema Marangatu (SET). Texto plano, visible en la tabla de Clientes.';
comment on column public.clientes.membrete_nombre is
    'Nombre de estudio/oficina a usar en la ficha de pago de este cliente en particular. Si es null, se usa el de configuracion_estudio.';

-- ---------------------------------------------------------------------
-- 2. ÍNDICES
-- ---------------------------------------------------------------------
-- El UNIQUE de arriba ya crea un índice para ruc, no hace falta duplicarlo.

-- Filtro más frecuente: "mis clientes" por responsable.
create index if not exists idx_clientes_responsable
    on public.clientes (responsable);

-- ---------------------------------------------------------------------
-- 3. TRIGGER updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_clientes_set_updated_at on public.clientes;

create trigger trg_clientes_set_updated_at
    before update on public.clientes
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS)
-- ---------------------------------------------------------------------
alter table public.clientes enable row level security;

-- ENDURECIDO: requiere Supabase Auth (ver tabla `perfiles`, sección 15).
-- Se elimina explícitamente la policy permisiva de Fase 1 (incluía `anon`)
-- para que esta migración limpie instalaciones que ya la tenían creada.
drop policy if exists "clientes_acceso_total_fase1" on public.clientes;
drop policy if exists "clientes_acceso_autenticados" on public.clientes;

create policy "clientes_acceso_autenticados"
    on public.clientes
    for all
    to authenticated
    using (true)
    with check (true);

revoke select, insert, update, delete on public.clientes from anon;
grant select, insert, update, delete on public.clientes to authenticated;

-- ---------------------------------------------------------------------
-- 5. ENDURECIMIENTO POR ROL (futuro, opcional)
-- ---------------------------------------------------------------------
-- Hoy cualquier usuario logueado (rol `authenticated`) tiene acceso total,
-- igual para todos los responsables del estudio. Si más adelante se
-- necesita restringir según el rol de `perfiles` (p.ej. que solo
-- admin/socio pueda editar clientes), reemplazar la policy de arriba por
-- algo como:
--        create policy "clientes_modificar_admin_o_responsable"
--          on public.clientes for update
--          to authenticated
--          using (
--            exists (
--              select 1 from public.perfiles p
--              where p.id = auth.uid() and p.rol in ('admin', 'socio')
--            )
--          );

-- =====================================================================
-- FASE 2 — Obligaciones, calendario de vencimientos, presentaciones,
-- honorarios (extiende el esquema de Fase 1, sobre la tabla `clientes`).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 6. TABLA obligaciones (catálogo FIJO, precargado — 5 filas, no se
--    inserta/edita desde la app)
-- ---------------------------------------------------------------------
create table if not exists public.obligaciones (
    id            bigint generated always as identity primary key,

    -- Identificador estable usado por la app (no cambia aunque cambie
    -- `nombre`). En mayúsculas y con guion bajo por convención.
    codigo        text not null,

    nombre        text not null,

    -- Determina cómo la lógica de generación del calendario (en JS) trata
    -- cada obligación:
    --   mensual = se genera un período todos los meses (IVA).
    --   anual   = se genera un período una vez al año (IRE SIMPLE/GENERAL,
    --             ESTADO FINANCIERO).
    --   manual  = NUNCA se genera solo; se crea a mano cuando el contador
    --             confirma que corresponde (IDU).
    periodicidad  text not null,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint obligaciones_codigo_unique
        unique (codigo),

    constraint obligaciones_periodicidad_valida
        check (periodicidad in ('mensual', 'anual', 'manual'))
);

comment on table  public.obligaciones is
    'Catálogo FIJO de obligaciones fiscales (9 filas precargadas, no se insertan/editan desde la app). Ver INSERT de carga inicial más abajo.';
comment on column public.obligaciones.periodicidad is
    'mensual = vence todos los meses (IVA, RG 90 Mensual). anual = vence una vez al año (IRE SIMPLE/GENERAL, ESTADO FINANCIERO, IRP-RSP/RGC, RG 90 Anual). manual = nunca se genera solo; se crea a mano cuando corresponde (IDU).';

-- Carga inicial (idempotente: si se corre de nuevo, actualiza nombre y
-- periodicidad en vez de duplicar filas).
-- RG 90 (Registro de Comprobantes, Resolución General N° 90/2021 - DNIT,
-- Sistema Marangatu): dos variantes, cada una con su propia regla de
-- vencimiento (ver calendario-logica.js). En Marangatu se identifican como
-- "código 955" (mensual, contribuyentes de IVA) y "código 956" (anual,
-- contribuyentes de IRP-RSP que NO son de IVA) — se dejan como comentario
-- acá porque `codigo` en esta tabla sigue la convención mnemónica del
-- resto del catálogo (IVA, IRE_SIMPLE, etc.), no los códigos de Marangatu.
insert into public.obligaciones (codigo, nombre, periodicidad) values
    ('IVA',               'IVA',                'mensual'),
    ('IRE_SIMPLE',        'IRE SIMPLE',          'anual'),
    ('IRE_GENERAL',       'IRE GENERAL',         'anual'),
    ('ESTADO_FINANCIERO', 'ESTADO FINANCIERO',   'anual'),
    ('IRP_RSP',           'IRP-RSP',             'anual'),
    ('IRP_RGC',           'IRP-RGC',             'anual'),
    ('IDU',               'IDU',                'manual'),
    ('RG90_MENSUAL',      'RG 90 Mensual',       'mensual'),
    ('RG90_ANUAL',        'RG 90 Anual',         'anual')
on conflict (codigo) do update
    set nombre       = excluded.nombre,
        periodicidad = excluded.periodicidad;

-- ---------------------------------------------------------------------
-- 6.1 TABLA cliente_obligaciones — qué obligaciones (del catálogo de
--     arriba) le corresponden a cada cliente. Se configura a mano desde
--     la pantalla de Clientes (checkboxes), reemplaza la suposición
--     anterior de que TODOS los clientes tenían todas las obligaciones
--     automáticas. El Calendario y Presentaciones solo generan registros
--     para las combinaciones que existen acá.
-- ---------------------------------------------------------------------
create table if not exists public.cliente_obligaciones (
    id             bigint generated always as identity primary key,

    cliente_id     bigint not null
                       references public.clientes(id) on delete cascade,

    obligacion_id  bigint not null
                       references public.obligaciones(id) on delete cascade,

    created_at     timestamptz not null default now(),

    constraint cliente_obligaciones_unique
        unique (cliente_id, obligacion_id)
);

comment on table public.cliente_obligaciones is
    'Qué obligaciones del catálogo le corresponden a cada cliente (configurado a mano en la pantalla de Clientes). El Calendario y Presentaciones solo generan vencimientos para estas combinaciones, no para todo el catálogo.';

create index if not exists idx_cliente_obligaciones_cliente
    on public.cliente_obligaciones (cliente_id);

alter table public.cliente_obligaciones enable row level security;

drop policy if exists "cliente_obligaciones_acceso_autenticados" on public.cliente_obligaciones;

create policy "cliente_obligaciones_acceso_autenticados"
    on public.cliente_obligaciones
    for all
    to authenticated
    using (true)
    with check (true);

grant select, insert, update, delete on public.cliente_obligaciones to authenticated;

-- ---------------------------------------------------------------------
-- 7. TABLA feriados
-- ---------------------------------------------------------------------
create table if not exists public.feriados (
    id           bigint generated always as identity primary key,

    fecha        date not null,

    -- Ej: "Día de la Independencia" o "Decreto 6280 - Mundial".
    descripcion  text not null,

    -- Opcional: distingue feriados fijos (de ley, se repiten cada año) de
    -- los agregados por decreto (hasta 3 por año, no predecibles). NULL si
    -- no se quiere clasificar.
    origen       text,

    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),

    constraint feriados_fecha_unique
        unique (fecha),

    constraint feriados_origen_valido
        check (origen is null or origen in ('fijo', 'decreto'))
);

comment on table  public.feriados is
    'Feriados cargados manualmente por el estudio (fijos + hasta 3 por decreto/año, no predecibles). Se usan para correr vencimientos al siguiente día hábil.';

-- ---------------------------------------------------------------------
-- 8. TABLA calendario_vencimientos
-- ---------------------------------------------------------------------
create table if not exists public.calendario_vencimientos (
    id                 bigint generated always as identity primary key,

    cliente_id         bigint not null
                            references public.clientes(id) on delete cascade,

    obligacion_id      bigint not null
                            references public.obligaciones(id) on delete restrict,

    -- Fecha "ancla" del período (NO es la fecha de vencimiento):
    --   - obligación mensual (IVA): primer día del mes declarado
    --     (ej. "julio 2026" -> 2026-07-01).
    --   - obligación anual/manual (IRE SIMPLE/GENERAL, ESTADO FINANCIERO,
    --     IDU): 1º de enero del año declarado (ej. "2026" -> 2026-01-01).
    -- Se eligió `date` (en vez de texto "2026-07" / "2026") para ordenar y
    -- filtrar con operadores de fecha nativos y no mezclar formatos entre
    -- mensual y anual.
    periodo            date not null,

    fecha_vencimiento  date not null,

    -- false = calculado automáticamente por la lógica de calendario (JS).
    -- true  = ingresado/ajustado a mano (uso típico: IDU, que nunca se
    --         genera solo — ver reglas de negocio en el bloque 8.1).
    generado_manual    boolean not null default false,

    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    constraint calendario_cliente_obligacion_periodo_unique
        unique (cliente_id, obligacion_id, periodo)
);

comment on table  public.calendario_vencimientos is
    'Próximo vencimiento calculado (o ingresado a mano) por cliente + obligación + período. Un registro por combinación (ver unique constraint); el cálculo de fecha_vencimiento vive en la app (JS), no en SQL.';
comment on column public.calendario_vencimientos.periodo is
    'Fecha ancla del período: primer día del mes (mensual) o 1º de enero del año (anual/manual). No es la fecha de vencimiento.';
comment on column public.calendario_vencimientos.generado_manual is
    'true si el registro fue creado/ajustado a mano (típico de IDU); false si lo generó automáticamente la lógica de calendario.';

create index if not exists idx_calendario_fecha_vencimiento
    on public.calendario_vencimientos (fecha_vencimiento);

create index if not exists idx_calendario_obligacion_id
    on public.calendario_vencimientos (obligacion_id);

-- ---------------------------------------------------------------------
-- 8.1 REGLAS DE NEGOCIO para fecha_vencimiento — SOLO REFERENCIA.
--     El cálculo real se implementa en JavaScript (app), no en SQL.
--     Confirmadas con la SET; revisar si cambian por nueva normativa.
-- ---------------------------------------------------------------------
-- 1) Día base del mes según terminación de RUC del cliente (aplica a IVA,
--    IRE SIMPLE, IRE GENERAL, ESTADO FINANCIERO, IRP-RSP e IRP-RGC — todas
--    usan esta misma tabla de días, solo cambia el MES, ver punto 2):
--
--        terminacion_ruc  ->  día del mes
--        0                ->  7
--        1                ->  9
--        2                ->  11
--        3                ->  13
--        4                ->  15
--        5                ->  17
--        6                ->  19
--        7                ->  21
--        8                ->  23
--        9                ->  25
--
-- 2) Meses posteriores al cierre fiscal según obligación (el cierre fiscal
--    es por cliente, ver clientes.cierre_fiscal_mes — con cierre 31/12,
--    que es la regla general, esto da los meses de siempre):
--      - IVA               (mensual): mismo mes que el período declarado
--                                     (no depende del cierre fiscal).
--      - RG 90 MENSUAL     (mensual): mismo día/mes que IVA (mismo cálculo,
--                                     código 955 en Marangatu). Para
--                                     contribuyentes de IVA + IRP-RSP o
--                                     IVA + IRE SIMPLE.
--      - IRE SIMPLE        (anual):   3er mes posterior al cierre.
--                                     Cierre 31/12 => vence en MARZO.
--      - IRP-RSP           (anual):   3er mes posterior al cierre, igual
--                                     que IRE SIMPLE (Formulario 515,
--                                     Sistema Marangatu).
--      - IRP-RGC           (anual):   3er mes posterior al cierre, igual
--                                     que IRE SIMPLE (Formulario 516,
--                                     Sistema Marangatu).
--      - IRE GENERAL       (anual):   4to mes posterior al cierre.
--                                     Cierre 31/12 => vence en ABRIL.
--      - ESTADO FINANCIERO (anual):   mismo vencimiento que IRE GENERAL
--                                     (se presentan juntos, mismo mes/día).
--      - RG 90 ANUAL       (anual):   2do mes posterior al cierre (código
--                                     956 en Marangatu). Cierre 31/12 =>
--                                     vence en FEBRERO. Para contribuyentes
--                                     de IRP-RSP que NO son de IVA. El día
--                                     dentro del mes usa la misma tabla de
--                                     terminación de RUC que el resto: es
--                                     una asunción documentada (no hay
--                                     tabla propia publicada por Marangatu
--                                     para esta obligación), confirmada con
--                                     el usuario, a ajustar si en la
--                                     práctica no coincide.
--      - IDU               (manual):  NO se genera automáticamente en
--                                     ningún período. Se crea a mano cuando
--                                     el contador confirma que el cliente
--                                     distribuyó dividendos ese año
--                                     (calendario_vencimientos.generado_manual
--                                     = true).
--
-- 3) Ajuste por día inhábil: si la fecha resultante (día base + mes) cae
--    sábado, domingo o figura en `feriados`, se corre al siguiente día
--    hábil (siguiente día que no sea sábado/domingo/feriado).
--
-- 4) Cierre fiscal válido (Decreto 3182/2019, DNIT): no cualquier mes,
--    solo diciembre (regla general), abril (ingenios azucareros y
--    cooperativas que industrializan productos agropecuarios) o junio
--    (aseguradoras/reaseguradoras e industrias de cerveza/gaseosas). Ver
--    constraint clientes_cierre_fiscal_mes_rango.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 9. TABLA presentaciones
-- ---------------------------------------------------------------------
create table if not exists public.presentaciones (
    id                  bigint generated always as identity primary key,

    cliente_id          bigint not null
                             references public.clientes(id) on delete cascade,

    obligacion_id       bigint not null
                             references public.obligaciones(id) on delete restrict,

    -- Misma convención de fecha ancla que calendario_vencimientos.periodo.
    periodo             date not null,

    estado              text not null default 'pendiente',

    -- Se completa sola al marcar como presentado (now() desde la app);
    -- permanece NULL mientras estado = 'pendiente'.
    fecha_presentacion  timestamptz,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint presentaciones_cliente_obligacion_periodo_unique
        unique (cliente_id, obligacion_id, periodo),

    constraint presentaciones_estado_valido
        check (estado in ('pendiente', 'presentado')),

    constraint presentaciones_fecha_presentacion_consistente
        check (
            (estado = 'pendiente'  and fecha_presentacion is null)
            or
            (estado = 'presentado' and fecha_presentacion is not null)
        )
);

comment on table  public.presentaciones is
    'Estado de presentación por cliente + obligación + período. Al cambiar de período se inserta una fila nueva en estado pendiente; las filas de períodos anteriores nunca se borran ni se sobrescriben (historial permanente).';

-- Acelera el caso de uso más común del dashboard: "qué está pendiente
-- ahora", sin tener que escanear el historial ya presentado.
create index if not exists idx_presentaciones_pendientes
    on public.presentaciones (periodo)
    where estado = 'pendiente';

-- ---------------------------------------------------------------------
-- 10. TABLA honorarios
-- ---------------------------------------------------------------------
create table if not exists public.honorarios (
    id             bigint generated always as identity primary key,

    cliente_id     bigint not null
                       references public.clientes(id) on delete cascade,

    -- Un cliente puede tener cuota mensual, anual, o ambas a la vez (ej:
    -- 110.000 Gs/mes de honorario recurrente + 150.000 Gs/año por la
    -- presentación anual de IVA/IRE). Ambas son opcionales, pero tiene que
    -- haber al menos una cargada (ver constraint). numeric(14,0): sin
    -- decimales (el Gs. no usa centavos en la práctica de este estudio).
    monto_mensual  numeric(14, 0),
    monto_anual    numeric(14, 0),

    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),

    constraint honorarios_cliente_unique
        unique (cliente_id),

    constraint honorarios_monto_mensual_positivo
        check (monto_mensual is null or monto_mensual > 0),

    constraint honorarios_monto_anual_positivo
        check (monto_anual is null or monto_anual > 0),

    constraint honorarios_al_menos_un_monto
        check (monto_mensual is not null or monto_anual is not null)
);

-- Migración para bases ya existentes con el esquema viejo (monto +
-- periodicidad, un solo monto por cliente). Antes de borrar esas columnas,
-- se traslada el dato que tuvieran a la columna nueva que corresponda.
alter table public.honorarios add column if not exists monto_mensual numeric(14, 0);
alter table public.honorarios add column if not exists monto_anual numeric(14, 0);

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'honorarios' and column_name = 'periodicidad'
    ) then
        update public.honorarios set monto_mensual = monto where periodicidad = 'mensual' and monto_mensual is null;
        update public.honorarios set monto_anual = monto where periodicidad = 'anual' and monto_anual is null;
    end if;
end $$;

alter table public.honorarios drop column if exists monto;
alter table public.honorarios drop column if exists periodicidad;

alter table public.honorarios drop constraint if exists honorarios_monto_positivo;
alter table public.honorarios drop constraint if exists honorarios_periodicidad_valida;

alter table public.honorarios drop constraint if exists honorarios_monto_mensual_positivo;
alter table public.honorarios add constraint honorarios_monto_mensual_positivo
    check (monto_mensual is null or monto_mensual > 0);

alter table public.honorarios drop constraint if exists honorarios_monto_anual_positivo;
alter table public.honorarios add constraint honorarios_monto_anual_positivo
    check (monto_anual is null or monto_anual > 0);

alter table public.honorarios drop constraint if exists honorarios_al_menos_un_monto;
alter table public.honorarios add constraint honorarios_al_menos_un_monto
    check (monto_mensual is not null or monto_anual is not null);

comment on table public.honorarios is
    'Honorario pactado por cliente (uno por cliente, ver unique constraint). Monto mensual y anual son independientes, un cliente puede tener uno, otro, o ambos. Deliberadamente NO tiene columna de estado "al día / debe": ese estado se deriva comparando esta tabla con pagos_honorarios para que nunca quede desincronizado de los pagos reales.';

-- ---------------------------------------------------------------------
-- 11. TABLA pagos_honorarios
-- ---------------------------------------------------------------------
create table if not exists public.pagos_honorarios (
    id              bigint generated always as identity primary key,

    cliente_id      bigint not null
                        references public.clientes(id) on delete cascade,

    -- A cuál de las dos cuotas del cliente corresponde este pago (ver
    -- honorarios.monto_mensual / monto_anual). Necesario porque un mismo
    -- cliente puede deber las dos por separado.
    tipo_honorario  text not null default 'mensual',

    monto_pagado    numeric(14, 0) not null,

    fecha_pago      date not null default current_date,

    -- Cómo se cobró: importa para la ficha de pago descargable y para
    -- conciliar caja/banco.
    forma_pago      text not null default 'efectivo',

    -- Número del recibo físico/digital emitido al cliente por este pago.
    -- Texto libre (algunos recibos tienen letras o guiones) y opcional:
    -- no todos los estudios numeran recibos desde el día uno.
    numero_recibo   text,

    -- Período que cubre el pago (misma convención de fecha ancla que
    -- calendario_vencimientos.periodo: primer día del mes si tipo_honorario
    -- es 'mensual', 1º de enero si es 'anual'). Se permite más de un pago
    -- por cliente+tipo+período (pagos parciales).
    periodo         date not null,

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint pagos_honorarios_monto_positivo
        check (monto_pagado > 0),

    constraint pagos_honorarios_tipo_valido
        check (tipo_honorario in ('mensual', 'anual')),

    constraint pagos_honorarios_forma_pago_valida
        check (forma_pago in ('efectivo', 'transferencia', 'cheque'))
);

-- Migración para bases ya existentes (la CREATE TABLE de arriba ya
-- incluye estas columnas para instalaciones nuevas).
alter table public.pagos_honorarios add column if not exists tipo_honorario text not null default 'mensual';
alter table public.pagos_honorarios add column if not exists forma_pago text not null default 'efectivo';
alter table public.pagos_honorarios add column if not exists numero_recibo text;

alter table public.pagos_honorarios drop constraint if exists pagos_honorarios_tipo_valido;
alter table public.pagos_honorarios add constraint pagos_honorarios_tipo_valido
    check (tipo_honorario in ('mensual', 'anual'));

alter table public.pagos_honorarios drop constraint if exists pagos_honorarios_forma_pago_valida;
alter table public.pagos_honorarios add constraint pagos_honorarios_forma_pago_valida
    check (forma_pago in ('efectivo', 'transferencia', 'cheque'));

comment on table public.pagos_honorarios is
    'Historial de pagos de honorarios por cliente. Los pagos parciales se registran como filas adicionales del mismo período. tipo_honorario distingue si el pago es de la cuota mensual o la anual. La pantalla de Honorarios permite corregir (UPDATE) un pago ya cargado -monto/fecha/forma de pago/recibo- por si se cargó mal; nunca se borra uno.';

-- Se recrea (en vez de "if not exists") porque el índice viejo no incluía
-- tipo_honorario; "create index if not exists" no actualiza la definición
-- de un índice que ya existía con menos columnas.
drop index if exists idx_pagos_honorarios_cliente_periodo;
create index idx_pagos_honorarios_cliente_periodo
    on public.pagos_honorarios (cliente_id, tipo_honorario, periodo);

create index if not exists idx_pagos_honorarios_cliente_fecha
    on public.pagos_honorarios (cliente_id, fecha_pago desc);

-- ---------------------------------------------------------------------
-- 12. TRIGGERS updated_at — reusan public.set_updated_at(), ya creada en
--     la sección 3 para `clientes` (no se redefine la función).
-- ---------------------------------------------------------------------
drop trigger if exists trg_obligaciones_set_updated_at on public.obligaciones;
create trigger trg_obligaciones_set_updated_at
    before update on public.obligaciones
    for each row
    execute function public.set_updated_at();

drop trigger if exists trg_feriados_set_updated_at on public.feriados;
create trigger trg_feriados_set_updated_at
    before update on public.feriados
    for each row
    execute function public.set_updated_at();

drop trigger if exists trg_calendario_vencimientos_set_updated_at on public.calendario_vencimientos;
create trigger trg_calendario_vencimientos_set_updated_at
    before update on public.calendario_vencimientos
    for each row
    execute function public.set_updated_at();

drop trigger if exists trg_presentaciones_set_updated_at on public.presentaciones;
create trigger trg_presentaciones_set_updated_at
    before update on public.presentaciones
    for each row
    execute function public.set_updated_at();

drop trigger if exists trg_honorarios_set_updated_at on public.honorarios;
create trigger trg_honorarios_set_updated_at
    before update on public.honorarios
    for each row
    execute function public.set_updated_at();

drop trigger if exists trg_pagos_honorarios_set_updated_at on public.pagos_honorarios;
create trigger trg_pagos_honorarios_set_updated_at
    before update on public.pagos_honorarios
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 13. ROW LEVEL SECURITY (RLS) — ENDURECIDO, mismo criterio que `clientes`
--     (sección 4): requiere Supabase Auth, se elimina el acceso `anon`.
--
--     Excepción deliberada: `obligaciones` es un catálogo fijo que NO se
--     inserta/edita desde la app (solo las 5 filas precargadas arriba), así
--     que su policy es de SOLO LECTURA — a diferencia del resto, que sí
--     recibe la policy de acceso total igual que `clientes`.
-- ---------------------------------------------------------------------

-- obligaciones: solo lectura desde la app
alter table public.obligaciones enable row level security;

drop policy if exists "obligaciones_lectura_fase1" on public.obligaciones;
drop policy if exists "obligaciones_lectura_autenticados" on public.obligaciones;

create policy "obligaciones_lectura_autenticados"
    on public.obligaciones
    for select
    to authenticated
    using (true);

revoke select on public.obligaciones from anon;
grant select on public.obligaciones to authenticated;

-- feriados: lectura + escritura (se van cargando a mano cada año)
alter table public.feriados enable row level security;

drop policy if exists "feriados_acceso_total_fase1" on public.feriados;
drop policy if exists "feriados_acceso_autenticados" on public.feriados;

create policy "feriados_acceso_autenticados"
    on public.feriados
    for all
    to authenticated
    using (true)
    with check (true);

revoke select, insert, update, delete on public.feriados from anon;
grant select, insert, update, delete on public.feriados to authenticated;

-- calendario_vencimientos
alter table public.calendario_vencimientos enable row level security;

drop policy if exists "calendario_vencimientos_acceso_total_fase1" on public.calendario_vencimientos;
drop policy if exists "calendario_vencimientos_acceso_autenticados" on public.calendario_vencimientos;

create policy "calendario_vencimientos_acceso_autenticados"
    on public.calendario_vencimientos
    for all
    to authenticated
    using (true)
    with check (true);

revoke select, insert, update, delete on public.calendario_vencimientos from anon;
grant select, insert, update, delete on public.calendario_vencimientos to authenticated;

-- presentaciones
alter table public.presentaciones enable row level security;

drop policy if exists "presentaciones_acceso_total_fase1" on public.presentaciones;
drop policy if exists "presentaciones_acceso_autenticados" on public.presentaciones;

create policy "presentaciones_acceso_autenticados"
    on public.presentaciones
    for all
    to authenticated
    using (true)
    with check (true);

revoke select, insert, update, delete on public.presentaciones from anon;
grant select, insert, update, delete on public.presentaciones to authenticated;

-- honorarios
alter table public.honorarios enable row level security;

drop policy if exists "honorarios_acceso_total_fase1" on public.honorarios;
drop policy if exists "honorarios_acceso_autenticados" on public.honorarios;

create policy "honorarios_acceso_autenticados"
    on public.honorarios
    for all
    to authenticated
    using (true)
    with check (true);

revoke select, insert, update, delete on public.honorarios from anon;
grant select, insert, update, delete on public.honorarios to authenticated;

-- pagos_honorarios
alter table public.pagos_honorarios enable row level security;

drop policy if exists "pagos_honorarios_acceso_total_fase1" on public.pagos_honorarios;
drop policy if exists "pagos_honorarios_acceso_autenticados" on public.pagos_honorarios;

create policy "pagos_honorarios_acceso_autenticados"
    on public.pagos_honorarios
    for all
    to authenticated
    using (true)
    with check (true);

revoke select, insert, update, delete on public.pagos_honorarios from anon;
grant select, insert, update, delete on public.pagos_honorarios to authenticated;

-- ---------------------------------------------------------------------
-- 14. ENDURECIMIENTO POR ROL (futuro, opcional) — mismo criterio que la
--     sección 5 (clientes). Si en el futuro se necesita editar el catálogo
--     `obligaciones` desde una UI de administración, agregar ahí una
--     policy adicional de insert/update restringida por `perfiles.rol`
--     (hoy es intencionalmente de solo lectura).
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 15. TABLA perfiles + Supabase Auth
-- ---------------------------------------------------------------------
-- Un perfil por usuario de Supabase Auth. Esta app NO tiene pantalla de
-- alta de usuarios: los usuarios se crean a mano desde el dashboard de
-- Supabase (Authentication → Users) y quien los crea agrega la fila
-- correspondiente acá (o se puede automatizar con un trigger sobre
-- auth.users más adelante si hace falta).
create table if not exists public.perfiles (
    id          uuid primary key references auth.users(id) on delete cascade,

    nombre      text,

    -- Por ahora ninguna policy distingue por rol (ver sección 5/14): todo
    -- usuario autenticado tiene acceso total. Se deja la columna lista
    -- para cuando haga falta un endurecimiento más fino.
    rol         text not null default 'responsable',

    created_at  timestamptz not null default now(),

    constraint perfiles_rol_valido
        check (rol in ('admin', 'responsable'))
);

comment on table public.perfiles is
    'Un perfil por usuario de Supabase Auth (alta manual desde el dashboard de Supabase). rol queda preparado para endurecer RLS por rol en el futuro; hoy todas las policies solo exigen estar logueado.';

alter table public.perfiles enable row level security;

-- Antes cada usuario solo podía leer SU PROPIO perfil (using (id =
-- auth.uid())). Se amplía a "cualquier autenticado puede leer cualquier
-- perfil" porque la pantalla de Clientes necesita listar los nombres de
-- todos los perfiles para armar el <select> de "Responsable" -- sigue sin
-- exponerse nada a `anon`. Se elimina la policy vieja por nombre porque
-- una policy con el mismo nombre no actualiza su condición sola.
drop policy if exists "perfiles_leer_propio" on public.perfiles;
drop policy if exists "perfiles_lectura_autenticados" on public.perfiles;

create policy "perfiles_lectura_autenticados"
    on public.perfiles
    for select
    to authenticated
    using (true);

grant select on public.perfiles to authenticated;

-- ---------------------------------------------------------------------
-- 16. TABLA configuracion_estudio
-- ---------------------------------------------------------------------
-- Membrete general (nombre, dirección, teléfono) para la ficha de pago
-- descargable de Honorarios. Es una tabla de una sola fila (id fijo = 1,
-- ver constraint) en vez de una fila por "configuración" porque hoy solo
-- hay un dato de este tipo; si el estudio necesita un membrete distinto
-- para un cliente puntual, se carga en clientes.membrete_* (sección 1) y
-- ese pisa a este cuando la ficha se genera.
create table if not exists public.configuracion_estudio (
    id                smallint primary key default 1,

    nombre_estudio    text,
    direccion         text,
    telefono          text,
    nota_vencimiento  text default 'Vencimiento: 1 al 10 de cada mes',

    -- Logo del estudio para la ficha de pago, guardado como base64 (sin
    -- Supabase Storage/buckets: es una sola imagen chica, la fila única de
    -- esta tabla alcanza). NULL si todavía no se cargó ninguno.
    logo_base64       text,

    -- Interruptores para mostrar/ocultar paneles opcionales del sistema.
    -- Todos arrancan en `true` (default) para no cambiar el comportamiento
    -- actual de nadie hasta que alguien los apague a mano desde la pestaña
    -- "Paneles" de Configuración.
    panel_calendario_nuevo_ejercicio   boolean not null default true,
    panel_calendario_columna_obligacion boolean not null default true,
    panel_rg90_visible                 boolean not null default true,
    -- Conectada en js/honorarios.js: si es false, oculta la sección de
    -- cuota anual de Honorarios (que de por sí solo se muestra desde
    -- febrero, ver esEnero() en ese archivo).
    panel_honorarios_cuota_anual       boolean not null default true,

    updated_at        timestamptz not null default now(),

    constraint configuracion_estudio_singleton
        check (id = 1)
);

-- Migración para bases ya existentes creadas antes de estas columnas (la
-- CREATE TABLE de arriba ya las incluye para instalaciones nuevas).
alter table public.configuracion_estudio
    add column if not exists logo_base64 text;

alter table public.configuracion_estudio
    add column if not exists panel_calendario_nuevo_ejercicio boolean not null default true;

alter table public.configuracion_estudio
    add column if not exists panel_calendario_columna_obligacion boolean not null default true;

alter table public.configuracion_estudio
    add column if not exists panel_rg90_visible boolean not null default true;

alter table public.configuracion_estudio
    add column if not exists panel_honorarios_cuota_anual boolean not null default true;

comment on table public.configuracion_estudio is
    'Membrete general del estudio para la ficha de pago (una sola fila, id=1). Un cliente puntual puede tener su propio membrete en clientes.membrete_*, que pisa a este. También guarda los switches de paneles opcionales (panel_*).';
comment on column public.configuracion_estudio.logo_base64 is
    'Logo del estudio para la ficha de pago, codificado en base64 (sin Storage/buckets). NULL si no se cargó ninguno.';
comment on column public.configuracion_estudio.panel_calendario_nuevo_ejercicio is
    'Si es false, Calendario no muestra la sección "Obligaciones Anuales - Nuevo Ejercicio" en enero aunque corresponda por fecha.';
comment on column public.configuracion_estudio.panel_calendario_columna_obligacion is
    'Si es false, la tabla de Calendario no muestra la columna "Obligación".';
comment on column public.configuracion_estudio.panel_rg90_visible is
    'Si es false, RG90_MENSUAL/RG90_ANUAL se excluyen de los filtros de Obligación (Presentaciones/Historial) y de los checkboxes de asignación de obligaciones (Clientes).';
comment on column public.configuracion_estudio.panel_honorarios_cuota_anual is
    'Si es false, Honorarios no muestra la sección de cuota anual aunque corresponda por fecha (desde febrero, ver js/honorarios.js).';

-- Fila única, creada una sola vez (si ya existe, no se toca).
insert into public.configuracion_estudio (id)
values (1)
on conflict (id) do nothing;

drop trigger if exists trg_configuracion_estudio_set_updated_at on public.configuracion_estudio;
create trigger trg_configuracion_estudio_set_updated_at
    before update on public.configuracion_estudio
    for each row
    execute function public.set_updated_at();

alter table public.configuracion_estudio enable row level security;

drop policy if exists "configuracion_estudio_acceso_autenticados" on public.configuracion_estudio;

create policy "configuracion_estudio_acceso_autenticados"
    on public.configuracion_estudio
    for all
    to authenticated
    using (true)
    with check (true);

grant select, insert, update, delete on public.configuracion_estudio to authenticated;
