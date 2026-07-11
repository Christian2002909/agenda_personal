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
| 1 | Clientes | Alta, edición, listado, filtro por responsable |
| 2 | Obligaciones | Catálogo fijo precargado: IVA, IRE SIMPLE, IRE GENERAL, ESTADO FINANCIERO, IDU |
| 3 | Calendario | Genera y muestra los vencimientos calculados según terminación de RUC. Se actualiza solo, nunca hay que recrearlo a mano |
| 4 | Presentaciones | Checkbox por Cliente + Obligación + Período vigente, con fecha automática al marcar |
| 5 | Historial | Todo lo presentado alguna vez, orden cronológico, sin agrupar |
| 6 | Honorarios | Monto pactado por cliente, registro de pagos, estado "Al día"/"Debe" calculado en el momento |

## Cómo levantar el proyecto en una PC nueva

1. Clonar el repositorio.
2. `npm install`
3. Copiar `.env.example` como `.env` y completar con las credenciales reales de Supabase (Project Settings → API Keys en supabase.com → "Clave publicable" `sb_publishable_...` es la que va en `SUPABASE_ANON_KEY`). **El archivo `.env` nunca se sube a git.**
4. Volver a correr `schema.sql` completo en el SQL Editor de Supabase (es idempotente: agrega lo nuevo — `cierre_fiscal_mes`, tabla `perfiles`, RLS endurecida — sin duplicar lo que ya existía).
5. Crear al menos un usuario en Authentication → Users del dashboard de Supabase (la app ya no acepta acceso anónimo, ver "Login" abajo).
6. `npm start`

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
js/clientes.js               Pantalla Clientes
js/obligaciones.js           Pantalla Obligaciones (solo lectura)
js/calendario-logica.js      Funciones puras de cálculo de fechas (día por RUC, ajuste por feriado, etc.)
js/calendario.js             Pantalla Calendario (usa calendario-logica.js)
js/presentaciones.js         Pantalla Presentaciones (usa calendario-logica.js)
js/historial.js              Pantalla Historial
js/honorarios.js             Pantalla Honorarios
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
- **IRE SIMPLE**: anual, vence en marzo del año siguiente al cierre fiscal.
- **IRE GENERAL** y **ESTADO FINANCIERO**: anuales, vencen en abril del año siguiente (se presentan juntos).
- **IDU**: NO se genera automático. Se carga a mano en Supabase cuando el contador confirma que un cliente distribuyó dividendos ese año.
- Si la fecha cae sábado, domingo o feriado, se corre al siguiente día hábil.
- **Cierre fiscal personalizado por cliente** (`clientes.cierre_fiscal_mes`, 1-12, default 12 = diciembre): `calendario-logica.js` calcula el vencimiento como "N meses después del mes de cierre" (N=3 para IRE SIMPLE, N=4 para IRE GENERAL/ESTADO FINANCIERO), y el "período vigente" como el ejercicio que cerró más recientemente según la fecha de hoy. Con cierre en diciembre esto da exactamente el comportamiento original (marzo/abril del año siguiente).
- **Feriados**: no vienen precargados. Paraguay tiene feriados fijos + hasta 3 adicionales por decreto que cambian cada año, así que hay que cargarlos a mano en la tabla `feriados` de Supabase a medida que se conocen (justo como lo pidió el usuario).

## Login (Supabase Auth)

La app pide email/contraseña al arrancar (`js/auth.js`, sección `#vista-login` de `index.html`). No hay pantalla de alta de usuarios: se crean a mano en el dashboard de Supabase (Authentication → Users). Mientras no haya sesión válida, RLS rechaza cualquier consulta a la base (la seguridad real está en `schema.sql`, no en el frontend).

## Honorarios: cómo se calcula "Al día" / "Debe"

Acumula TODA la deuda desde que se configuró el honorario de ese cliente (`honorarios.created_at`): cuenta cuántos períodos (meses o años, según periodicidad) pasaron hasta el período vigente inclusive, multiplica por el monto pactado, y le resta la suma de TODOS los pagos históricos del cliente (no solo los del período vigente). Si un cliente debe 3 meses atrasados y solo pagó el mes actual, ahora sí muestra "Debe" con el saldo pendiente.

## Pendientes / próximos pasos

1. Empaquetar la app como `.exe` instalable con `electron-builder` (hoy solo corre en modo desarrollo con `npm start`). Deliberadamente dejado para el final, después de terminar y probar bien todo lo demás en modo desarrollo.
2. Si más adelante se necesita distinguir permisos por rol (admin vs responsable), usar la columna `perfiles.rol` para escribir policies más finas (hoy cualquier autenticado tiene acceso total — ver sección 5/14 de `schema.sql`).
3. Evaluar agregar un flujo de invitación/alta de usuarios desde la propia app (hoy se crean a mano en el dashboard de Supabase).

> Nota: la Fase 4 (Presentaciones) no tenía ningún problema real — el comentario anterior sobre "revisar Fase 4" fue una falsa alarma, confirmada con el usuario.

## Agentes de desarrollo (agency-agents)

Se instalaron en `.claude/agents/` 68 subagentes de Claude Code tomados de [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) (MIT), divisiones `engineering`, `testing` y `security` — para usar en la próxima etapa (modificar/mejorar cosas puntuales de la app).

## Credenciales de Supabase

Proyecto de Supabase ya creado (URL: `https://vdrbtiqspxbrppmvkcfs.supabase.co`). Las credenciales reales van en `.env` (nunca en git). En una PC nueva, copiar `.env.example` y completar con los mismos datos (Project Settings → API Keys en supabase.com).
