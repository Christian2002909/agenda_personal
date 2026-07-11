# Gestor de Obligaciones — Estado del Proyecto

Este documento resume todo lo construido hasta ahora, para poder continuar el desarrollo desde otra computadora sin perder contexto.

## Qué es

App de escritorio para un estudio contable en Paraguay. Controla clientes, obligaciones fiscales, sus vencimientos, si ya se presentaron, y los honorarios cobrados a cada cliente.

## Stack

- **Electron** (proceso principal en `main.js`, ventana carga `index.html`)
- **HTML / CSS / JavaScript** vanilla (sin framework, sin bundler)
- **Supabase** (Postgres en la nube) como backend, usando la librería `@supabase/supabase-js` directo desde la ventana (no hay servidor propio)

## Estado actual: Fases 1 a 6 completas y probadas en la app real

| Fase | Pantalla | Qué hace |
|---|---|---|
| 1 | Presentaciones | **Pantalla principal (se abre primero al entrar)**. Filtro por Obligación (arranca en IVA), clientes agrupados por "VENCIMIENTO N - FECHA D" según terminación de RUC — igual que la planilla de control en Excel que usaba el estudio. Checkbox de presentado con fecha automática, y un link en cada cliente para editarlo (abre la pestaña Clientes) |
| 2 | Clientes | Ahora es **solo para cargar/editar** un cliente (sin listado propio — para ver los ya cargados hay que ir a Presentaciones). Tiene clave de Marangatu (texto plano) y qué obligaciones le corresponden (checkboxes). Ya no tiene "Tipo de Contribuyente" (se sacó de la app y de la base, quedó redundante) |
| 3 | Obligaciones | Catálogo fijo (IVA, IRE SIMPLE, IRE GENERAL, ESTADO FINANCIERO, IRP-RSP, IRP-RGC, IDU). Ya no tiene pantalla propia — se usa desde Clientes para armar los checkboxes y desde Calendario/Presentaciones para calcular vencimientos |
| 4 | Calendario | Genera los vencimientos del **período VIGENTE únicamente** (se limpia solo cada mes/año, no acumula), solo para las obligaciones que cada cliente tiene asignadas, y solo muestra lo que todavía no se presentó. Se actualiza solo, nunca hay que recrearlo a mano |
| 5 | Historial | Filtro por Obligación (igual que Presentaciones), agrupado por vencimiento. Para IVA (mensual): grilla del año completo mes por mes con la fecha exacta de vencimiento, verde/rojo/gris. Para las anuales: una fila por año (actual y anterior) con fecha exacta y estado |
| 6 | Honorarios | Monto pactado por cliente, registro de pagos, estado "Al día"/"Debe" con deuda acumulada |
| 7 | Configuración | Tema claro/oscuro, guardado por computadora (localStorage) |

## Cómo levantar el proyecto en una PC nueva

1. Clonar el repositorio.
2. **Node.js v22.12 o superior** (LTS más reciente recomendado). Electron necesita esta versión para poder descargarse a sí mismo la primera vez (`npm install`/`npm start` fallan con `ERR_REQUIRE_ESM` en Node más viejo, ej. v20).
3. `npm install`
4. Copiar `.env.example` como `.env` y completar con las credenciales reales de Supabase (Project Settings → API Keys en supabase.com → "Clave publicable" `sb_publishable_...` es la que va en `SUPABASE_ANON_KEY`). **El archivo `.env` nunca se sube a git.**
5. Volver a correr `schema.sql` completo en el SQL Editor de Supabase (es idempotente: agrega lo nuevo — `cierre_fiscal_mes` restringido a 4/6/12, `clave_marangatu`, catálogo IRP-RSP/IRP-RGC, tabla `cliente_obligaciones`, tabla `perfiles`, RLS endurecida — y borra `tipo_contribuyente`, que quedó redundante).
6. Crear al menos un usuario en Authentication → Users del dashboard de Supabase (la app ya no acepta acceso anónimo, ver "Login" abajo).
7. `npm start`

## Estructura de archivos

```
main.js                    Proceso principal de Electron (abre la ventana)
index.html                 Toda la interfaz (una sola página, varias "vistas" que se muestran/ocultan)
css/style.css               Estilos
js/supabaseClient.js        Crea la conexión a Supabase (null si falta el .env, para no romper la app)
js/auth.js                   Login/logout con Supabase Auth. Muestra #vista-login u #app-autenticado
                              según haya sesión o no. No hay alta de usuarios desde la app.
js/navegacion.js             Muestra/oculta las vistas al hacer clic en el menú, y vuelve a pedir los
                              datos de esa pantalla (llama a window.cargarX())
js/clientes.js               Pantalla Clientes: SOLO alta/edición (sin listado, ver window.editarClienteDesdeOtraVista)
js/calendario-logica.js      Funciones puras de cálculo de fechas (día por RUC, ajuste por feriado, etc.)
js/calendario.js             Pantalla Calendario (usa calendario-logica.js, filtra por cliente_obligaciones)
js/presentaciones.js         Pantalla PRINCIPAL: filtro por Obligación, agrupado por vencimiento (como el Excel)
js/historial.js              Pantalla Historial
js/honorarios.js             Pantalla Honorarios
js/configuracion.js          Pantalla Configuración (tema claro/oscuro, aplica data-theme en <html>)
schema.sql                  Todo el esquema de la base de datos (Supabase/Postgres), con comentarios
.env.example                 Plantilla de credenciales (copiar a .env y completar)
```

## Decisiones de arquitectura importantes

- **`nodeIntegration: true`, `contextIsolation: false`** en `main.js`: simplifica mucho el código para alguien que recién aprende a programar (se puede usar `require()` directo en los archivos de la interfaz). Es aceptable porque la app SOLO carga `index.html` local, nunca contenido remoto. Si en el futuro se carga algo remoto, hay que cambiar a un `preload.js` con `contextBridge`.
- **Cada archivo de pantalla está envuelto en `(function () { ... })();`**: en un `<script>` clásico (sin módulos), dos archivos no pueden declarar el mismo `const` en el nivel superior sin chocar. Ya pasó con `calendario.js` y `presentaciones.js` (los dos importaban `formatearFechaISO` de `calendario-logica.js`). La solución fue envolver cada pantalla en su propia función, y exponer solo la función `cargarX()` en `window` para que `navegacion.js` pueda llamarla.
- **`navegacion.js` llama a `window.cargarX()` al cambiar de pestaña**: si no se hace esto, cambiar de pestaña muestra los datos que había cuando se abrió la app, no los datos actuales (bug real que apareció en la Fase 3 y se corrigió).
- **RLS endurecida con Supabase Auth**: todas las tablas exigen `authenticated` (se eliminó el acceso `anon`). Hay una tabla `perfiles` (uuid = `auth.users.id`, con columna `rol`) preparada para el día que se necesite restringir por rol — hoy cualquier usuario logueado tiene acceso total, no hay distinción admin/responsable todavía. Los usuarios se crean a mano desde el dashboard de Supabase (Authentication → Users); la app no tiene alta de usuarios.

## Reglas de negocio del calendario perpetuo (confirmadas con la SET, Paraguay)

Ver también `schema.sql`, sección "8.1 REGLAS DE NEGOCIO".

- **Día de vencimiento según terminación de RUC** (Resolución General 01/2007 y 38/2020): 0→7, 1→9, 2→11, 3→13, 4→15, 5→17, 6→19, 7→21, 8→23, 9→25.
- **IVA**: mensual, vence ese día del mismo mes.
- **IRE SIMPLE, IRP-RSP e IRP-RGC**: anuales, vencen en marzo del año siguiente al cierre fiscal (Formularios 141/515/516 en Sistema Marangatu — [fuente DNIT](https://www.dnit.gov.py/web/portal-institucional/w/en-marzo-vence-el-plazo-para-la-liquidacion-del-irp-correspondiente-al-ejercicio-fiscal-2022-en-tanto-que-los-registros-de-comprobantes-del-mismo-ano-pueden-ser-presentados-excepcionalmente-hasta-junio)).
- **IRE GENERAL** y **ESTADO FINANCIERO**: anuales, vencen en abril del año siguiente (se presentan juntos).
- **IDU**: NO se genera automático. Se carga a mano en Supabase cuando el contador confirma que un cliente distribuyó dividendos ese año.
- Si la fecha cae sábado, domingo o feriado, se corre al siguiente día hábil.
- **Cierre fiscal personalizado por cliente** (`clientes.cierre_fiscal_mes`): `calendario-logica.js` calcula el vencimiento como "N meses después del mes de cierre", y el "período vigente" como el ejercicio que cerró más recientemente según la fecha de hoy. Con cierre en diciembre esto da exactamente el comportamiento original (marzo/abril del año siguiente). **Solo se aceptan 3 valores** (constraint `clientes_cierre_fiscal_mes_rango`), según el Decreto 3182/2019 (DNIT): 12 = diciembre (regla general), 4 = abril (ingenios azucareros y cooperativas que industrializan productos agropecuarios), 6 = junio (aseguradoras/reaseguradoras e industrias de cerveza/gaseosas).
- **Feriados**: no vienen precargados. Paraguay tiene feriados fijos + hasta 3 adicionales por decreto que cambian cada año, así que hay que cargarlos a mano en la tabla `feriados` de Supabase a medida que se conocen (justo como lo pidió el usuario).

## Obligaciones por cliente (tabla cliente_obligaciones)

Antes, el Calendario y Presentaciones asumían que TODOS los clientes tenían todas las obligaciones automáticas (IVA + IRE SIMPLE/GENERAL + ESTADO FINANCIERO), sin mirar si correspondía. Ahora cada cliente tiene una lista explícita de qué obligaciones le corresponden (tabla `cliente_obligaciones`, configurada con checkboxes en la pantalla de Clientes), sin ninguna sugerencia automática — el contador tilda a mano las que correspondan para cada cliente nuevo.

- **"Tipo de Contribuyente" se eliminó de la app y de la base** (columna, constraint e índice borrados en `schema.sql`): quedó redundante en cuanto se pudo elegir la obligación directamente. Antes se usaba solo para sugerir qué tildar.
- Al guardar, se reemplazan todas las filas de `cliente_obligaciones` de ese cliente por las que quedaron tildadas (se borra todo y se reinserta; son pocas filas, no vale la pena comparar diferencias).
- Calendario y Presentaciones ahora recorren `cliente_obligaciones` (en vez de cliente × catálogo completo) para decidir qué vencimientos/presentaciones generar. IDU sigue sin generarse nunca automáticamente aunque esté tildado (periodicidad "manual").
- La pantalla de catálogo de Obligaciones (antes Fase 2, de solo lectura) se sacó del menú: ya no aporta nada que no esté en el formulario de Clientes.
- El Calendario ya no muestra la columna "Obligación" (pedido explícito del usuario); Historial sí la sigue mostrando. Presentaciones tampoco la muestra, porque ahora se filtra por una sola obligación a la vez (ver siguiente sección).

## Clave de Marangatu

Cada cliente tiene un campo `clave_marangatu` (texto plano) — es la clave de acceso al Sistema Marangatu (SET) de ese contribuyente, igual que en el Excel que usaba el estudio antes de esta app. A propósito no está oculta ni encriptada: el pedido explícito fue que se vea de un vistazo. Se ve en la pantalla de Presentaciones (columna "Clave"), no hay listado de clientes aparte (ver siguiente sección).

## Presentaciones es la pantalla principal; Clientes es solo para cargar

Reestructuración pedida por el usuario mostrándole cómo se veía su planilla Excel de control (una hoja por obligación, agrupada por "VENCIMIENTO N - FECHA D" según terminación de RUC, columnas N°/Nombre/RUC/Clave).

- **`js/presentaciones.js`** es ahora la primera pestaña que se ve al loguearse (antes era Clientes). Tiene un filtro `<select>` por Obligación (arranca siempre en IVA, no hay opción "Todos" — se decidió así en vez de una vista mezclada porque el usuario prefirió una sola obligación a la vez, como las hojas del Excel). Para la obligación elegida, agrupa por terminación de RUC igual que el Excel (`VENCIMIENTO N - FECHA D`, usando `DIA_POR_TERMINACION_RUC` de `calendario-logica.js`) y muestra N° (correlativo sin cortes entre grupos), Nombre, RUC, Clave, y el checkbox de Presentado con fecha. El nombre del cliente es un botón que abre la pestaña Clientes para editarlo (`window.editarClienteDesdeOtraVista`).
- **`js/clientes.js`** perdió su tabla/listado y su filtro por responsable: ahora solo tiene el formulario de alta/edición, siempre visible (no hay botón "+ Nuevo Cliente" para mostrarlo/ocultarlo). Al entrar directo a esta pestaña arranca en blanco ("Nuevo Cliente"); si se llega desde el botón de editar en Presentaciones, arranca con los datos de ese cliente cargados.
- El truco para que no se pisen: `editarClienteDesdeOtraVista(clienteId)` carga los datos del cliente y sus obligaciones, pone una bandera `ignorarProximaCarga = true`, y recién ahí llama a `window.mostrarVista('vista-clientes')` (que dispara `cargarClientes()` vía `navegacion.js`) — `cargarClientes()` ve la bandera, no resetea el formulario, y la función de edición lo completa con los datos ya cargados. Sin esta bandera, `cargarClientes()` limpiaría el formulario a "Nuevo Cliente" antes de poder mostrarlo lleno.

## Calendario: se limpia solo cada mes/año

Antes, `js/calendario.js` mostraba TODOS los `calendario_vencimientos` no presentados, sin importar de qué período eran — con obligaciones mensuales (IVA) esto iba acumulando filas viejas sin presentar mes tras mes. Ahora, igual que Presentaciones, solo muestra el **período VIGENTE** de cada obligación (comparando contra `obtenerPeriodoVigente()`): lo de períodos anteriores, se haya presentado o no, deja de aparecer acá y solo queda visible en Historial.

## Historial: filtro por Obligación + grilla mensual con fecha exacta

Antes era una lista cronológica simple de solo lo YA presentado. Ahora (`js/historial.js`) tiene el mismo filtro por Obligación que Presentaciones (arranca en IVA) y agrupa por vencimiento igual que el Excel, pero muestra TODOS los períodos, se hayan presentado o no:

- **Obligaciones mensuales (IVA)**: una fila por cliente con 12 columnas (Ene-Dic) del año actual. Cada celda calcula la fecha exacta de vencimiento con `calcularFechaVencimiento()` (la misma función pura que usa Calendario, no depende de que exista un registro en la base) y se colorea: verde si está presentado, rojo si ya venció y no se presentó, gris si todavía no llega la fecha.
- **Obligaciones anuales**: una fila por cliente por ejercicio (año actual y el anterior), con la misma lógica de colores, más una columna de texto ("Presentado el...", "No presentado", "Todavía no vence").
- El nombre del cliente también es un link que abre Clientes para editarlo, igual que en Presentaciones.

## Tema claro/oscuro

`js/configuracion.js` guarda la preferencia en `localStorage` (por computadora, no por usuario de Supabase) y aplica `data-theme="oscuro"` en `<html>`. Todos los colores de `css/style.css` están en variables CSS (`--color-*`) definidas en `:root` y sobreescritas en `:root[data-theme='oscuro']`; si se agrega un color nuevo a algún estilo, tiene que usar una variable existente (o agregar una nueva en ambos bloques), nunca un color fijo, para no romper el tema oscuro.

## Login (Supabase Auth)

La app pide email/contraseña al arrancar (`js/auth.js`, sección `#vista-login` de `index.html`). No hay pantalla de alta de usuarios: se crean a mano en el dashboard de Supabase (Authentication → Users). Mientras no haya sesión válida, RLS rechaza cualquier consulta a la base (la seguridad real está en `schema.sql`, no en el frontend).

## Honorarios: cómo se calcula "Al día" / "Debe"

Acumula TODA la deuda desde que se configuró el honorario de ese cliente (`honorarios.created_at`): cuenta cuántos períodos (meses o años, según periodicidad) pasaron hasta el período vigente inclusive, multiplica por el monto pactado, y le resta la suma de TODOS los pagos históricos del cliente (no solo los del período vigente). Si un cliente debe 3 meses atrasados y solo pagó el mes actual, ahora sí muestra "Debe" con el saldo pendiente.

## Pendientes / próximos pasos

1. Empaquetar la app como `.exe` instalable con `electron-builder` (hoy solo corre en modo desarrollo con `npm start`). Deliberadamente dejado para el final, después de terminar y probar bien todo lo demás en modo desarrollo. Para esto, las credenciales de Supabase van EMPAQUETADAS dentro del instalador (no un `.env` que cada usuario complete a mano) — la clave publicable está pensada para eso, y la seguridad real sigue estando en el login + RLS.
2. Posición del menú de navegación configurable (izquierda/arriba/abajo/derecha) — pedido por el usuario pero marcado como secundario, se hace después de lo demás.
3. Si más adelante se necesita distinguir permisos por rol (admin vs responsable), usar la columna `perfiles.rol` para escribir policies más finas (hoy cualquier autenticado tiene acceso total — ver sección 5/14 de `schema.sql`).
4. Evaluar agregar un flujo de invitación/alta de usuarios desde la propia app (hoy se crean a mano en el dashboard de Supabase).

> Nota: la Fase 4 (Presentaciones) no tenía ningún problema real — el comentario anterior sobre "revisar Fase 4" fue una falsa alarma, confirmada con el usuario.

> Nota técnica: la pantalla de login tenía un bug de CSS (`.vista-login { display: flex }` empatada en especificidad con `.oculto { display: none }`, y como estaba declarada después en el archivo, ganaba la cascada y el login nunca se ocultaba después de loguearse). Se arregló agregando `.vista-login.oculto { display: none }`, más específico. Ojo con esto al agregar estilos nuevos a una vista que ya tiene su propia clase de layout además de `vista`/`oculto`.

## Agentes de desarrollo (agency-agents)

Se instalaron en `.claude/agents/` 68 subagentes de Claude Code tomados de [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) (MIT), divisiones `engineering`, `testing` y `security` — para usar en la próxima etapa (modificar/mejorar cosas puntuales de la app).

## Credenciales de Supabase

Proyecto de Supabase ya creado (URL: `https://vdrbtiqspxbrppmvkcfs.supabase.co`). Las credenciales reales van en `.env` (nunca en git). En una PC nueva, copiar `.env.example` y completar con los mismos datos (Project Settings → API Keys en supabase.com).
