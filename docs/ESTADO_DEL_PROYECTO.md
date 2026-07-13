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
| 1 | Presentaciones | **Pantalla principal (se abre primero al entrar)**. Filtro por Obligación (arranca en IVA, incluye RG 90 Mensual/Anual), clientes agrupados por "VENCIMIENTO N - FECHA D" según terminación de RUC — igual que la planilla de control en Excel que usaba el estudio. Checkbox de presentado (sin columna de fecha, se sacó por pedido del usuario), y un link en cada cliente para editarlo (abre la pestaña Clientes) |
| 2 | Clientes | **Solo para cargar/editar** un cliente (sin listado propio — para ver los ya cargados hay que ir a Presentaciones). Tiene clave de Marangatu (texto plano), campo **Responsable como lista desplegable** (se elige de los usuarios reales del sistema, tabla `perfiles`, ya no es texto libre), y qué obligaciones le corresponden (checkboxes, incluye RG 90 Mensual/Anual). Ya no tiene "Tipo de Contribuyente" ni la sección de membrete por cliente (el membrete quedó único y centralizado en Configuración) |
| 3 | Obligaciones | Catálogo fijo (IVA, IRE SIMPLE, IRE GENERAL, ESTADO FINANCIERO, IRP-RSP, IRP-RGC, IDU, RG 90 Mensual, RG 90 Anual). Ya no tiene pantalla propia — se usa desde Clientes para armar los checkboxes y desde Calendario/Presentaciones/Historial para calcular vencimientos |
| 4 | Calendario | Solo muestra lo que **vence EN EL MES EN CURSO** (no todo el período vigente) y todavía no se presentó, con la columna "Obligación" de vuelta. En **enero** aparece además una sección aparte con las obligaciones anuales que recién entraron en ejercicio nuevo (aviso adelantado, aunque su vencimiento real sea marzo/abril). Ambas cosas (la columna y la sección de enero) se pueden ocultar desde Configuración → Paneles. Se actualiza solo, nunca hay que recrearlo a mano |
| 5 | Historial | Filtro por Obligación + **selector de año** (2022 en adelante), agrupado por vencimiento, grilla compacta con scroll horizontal solo si hace falta. Para obligaciones mensuales: 12 columnas del año elegido con la fecha exacta de vencimiento, verde/rojo/gris — **cada celda es editable**, tocarla marca/desmarca "presentado" para ese período aunque ya haya pasado, sin necesidad de pasar por Presentaciones/Calendario. Para las anuales: una fila por cliente del ejercicio elegido, con la misma lógica |
| 6 | Honorarios | Cuota mensual y/o anual por cliente (independientes, se configuran en Clientes o editables directo desde acá), búsqueda por nombre/RUC, sección aparte para la cuota anual (visible solo desde febrero), registro de pago como fila desplegable por cliente (no un formulario fijo), edición de pagos ya cargados, vista de detalle de pagos por cliente y por período, estado "Al día"/"Debe" con deuda acumulada, y ficha de pago descargable en PDF (con logo del estudio si está cargado) |
| 7 | Configuración | Organizada en pestañas: **Tema** (claro/oscuro, localStorage), **Membrete** (nombre/dirección/teléfono/nota/logo del estudio, único para todos los clientes, Supabase compartido) y **Paneles** (mostrar/ocultar secciones opcionales del sistema: aviso de enero en Calendario, columna Obligación en Calendario, visibilidad de RG 90, cuota anual de Honorarios) |

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

## Calendario: solo el mes en curso, anuales aparte en enero

Antes el Calendario mostraba todo el período vigente no presentado (podía incluir una obligación anual todo el año, aunque su vencimiento real fuera recién en marzo/abril). Ahora `js/calendario.js` separa la lista en dos:

- **Lista principal**: solo lo que vence dentro del mes calendario actual (compara año y mes de `fecha_vencimiento` contra hoy).
- **"Obligaciones Anuales — Nuevo Ejercicio"** (`#seccion-anuales-nuevo-ejercicio`): sección aparte que solo aparece en **enero**, con las obligaciones anuales cuyo período vigente ya cambió de ejercicio aunque su vencimiento real (marzo/abril) todavía esté lejos — sirve de aviso temprano. El resto del año esta sección queda oculta.

## Honorarios: cuota mensual y/o anual, pago como fila desplegable, ficha de pago en PDF

Rediseño completo pedido comparando con el Excel real del estudio ("Control de Honorarios"), en dos tandas.

- **Cuota independiente mensual y anual** (`honorarios.monto_mensual` / `monto_anual`, ambas nullable, al menos una obligatoria): un cliente puede tener las dos a la vez (ej. IVA con IRE: mensualidad + cuota anual), solo una, o la otra. Se configuran desde la pantalla de Clientes, o directo desde Honorarios con el botón "Editar cuota" de cada fila (hace `upsert` sobre `honorarios`, sirve también para configurar el honorario de un cliente que todavía no tenía uno).
- **`js/honorarios.js`** tiene una barra de búsqueda (por nombre o RUC) sobre la tabla principal, que muestra Cliente / Cuota Mensual / Cuota Anual / Estado. El estado "Al día"/"Debe" suma el saldo de cada cuota por separado (`calcularSaldoPorTipo`): cada una acumula deuda desde `honorarios.created_at` según su propia periodicidad, y se resta lo pagado de ese mismo tipo (`pagos_honorarios.tipo_honorario`). La cuota **anual** tiene una regla extra: en enero todavía no cuenta como adeudada (recién empieza a sumar desde febrero), y tiene su propia sección aparte en la pantalla (visible solo desde febrero, y solo si el panel `panel_honorarios_cuota_anual` de Configuración está activado).
- **Registrar un pago ya no es un formulario fijo**: cada cliente tiene una casilla "¿Pagó?" en su fila que, al tildarla, despliega un mini-formulario en el momento (mismo patrón que el checkbox de Presentado en Presentaciones/Calendario) pidiendo a qué cuota corresponde (si tiene las dos), monto, **forma de pago** (efectivo/transferencia/cheque), **número de recibo** (opcional) y el período (mes+año para mensual, año para anual — ya no es una fecha suelta). La fecha de pago sugiere el día de hoy por defecto, editable.
- **Pagos editables**: cada pago ya cargado tiene un botón "Editar" que reabre el mismo mini-formulario con los datos precargados para corregir monto/fecha/forma de pago/recibo. Hay también una vista de detalle por cliente (todo su historial de pagos junto) y un filtro por período sobre la tabla de pagos, para ubicar y corregir pagos atrasados.
- **Ficha de pago descargable en PDF**: botón "Ficha" por cliente arma el HTML de la ficha (tabla mes a mes para la cuota mensual con Balance Anual, y/o tabla de la cuota anual, más el **logo del estudio** si está cargado en Configuración) en un `<div id="ficha-pago-imprimir">` oculto, y llama a `window.print()` — no hay IPC ni ventana nueva de Electron; el `@media print` de `css/style.css` oculta todo lo demás y el usuario elige "Guardar como PDF" en el diálogo nativo de impresión.
- **Membrete de la ficha** (nombre del estudio, dirección, teléfono, nota de vencimiento, logo): un solo valor, **único para todos los clientes**, configurado en Configuración → pestaña "Membrete" (tabla `configuracion_estudio`, fila única). Ya no existe override por cliente — se sacó esa sección del formulario de Clientes (las columnas `clientes.membrete_*` siguen en la base sin usarse, no se borraron).

## Historial: filtro por Obligación + selector de año + grilla editable

Antes era una lista cronológica simple de solo lo YA presentado. Ahora (`js/historial.js`) tiene el mismo filtro por Obligación que Presentaciones (arranca en IVA, incluye RG 90) y agrupa por vencimiento igual que el Excel, pero muestra TODOS los períodos, se hayan presentado o no, para el año elegido en un **selector de año** (2022 hasta el actual, uno a la vez):

- **Obligaciones mensuales (IVA, etc.)**: una fila por cliente con 12 columnas (Ene-Dic) del año elegido. Cada celda calcula la fecha exacta de vencimiento con `calcularFechaVencimiento()` (la misma función pura que usa Calendario, no depende de que exista un registro en la base) y se colorea: verde si está presentado, rojo si ya venció y no se presentó, gris si todavía no llega la fecha.
- **Obligaciones anuales**: una fila por cliente para el ejercicio elegido, con la misma lógica de colores.
- **Cada celda es editable**: un click tilda/destilda "presentado" para ese período — hace `upsert` sobre `presentaciones` (`onConflict: cliente_id,obligacion_id,periodo`), así que funciona igual si la fila ya existía (períodos recientes) o si hay que crearla de cero (períodos viejos, que nunca se autogeneran salvo el vigente). La fecha de presentación se pone automática (hoy), no hay selector de fecha retroactiva.
- El nombre del cliente también es un link que abre Clientes para editarlo, igual que en Presentaciones.
- Grilla envuelta en `.tabla-scroll` (mismo contenedor que usa Honorarios) con columnas angostas y fechas cortas ("dd/mm") para que entren los 12 meses sin desbordar.

## RG 90 (Registro de Comprobantes, Marangatu)

Nueva obligación agregada al catálogo, con dos variantes independientes (un cliente puede tener una, la otra, o ninguna, tildadas en Clientes igual que el resto):

- **RG 90 Mensual** (`RG90_MENSUAL`): mismo vencimiento que IVA (mismo día por terminación de RUC, mismo mes).
- **RG 90 Anual** (`RG90_ANUAL`): vence el segundo mes posterior al cierre fiscal (ej. cierre diciembre → vence febrero), con el día calculado con la misma tabla de terminación de RUC que el resto — esto último es una asunción (las fuentes oficiales no publican una tabla propia por RUC para esta obligación puntual, solo dicen que sigue "el calendario de vencimientos de las declaraciones juradas informativas"), a ajustar si en la práctica con Marangatu no coincide.
- Aparece en Calendario, Presentaciones e Historial igual que cualquier otra obligación. Se puede ocultar de los filtros y checkboxes desde Configuración → Paneles (`panel_rg90_visible`), para estudios que no la necesiten.

## Responsable por cliente: ahora es una lista de usuarios reales

El campo "Responsable" del formulario de Clientes pasó de texto libre a un `<select>` poblado con los usuarios reales del sistema (tabla `perfiles`, columna `nombre`). Para que esto funcione, se tuvo que abrir la policy de lectura de `perfiles` (antes cada usuario solo podía leer su propio perfil, `using (id = auth.uid())`) a `using (true)` para cualquier autenticado — sigue sin exponerse a `anon`. Se sigue guardando como texto libre en `clientes.responsable` (el nombre elegido, no el uuid), así que no rompe nada de lo que ya lee ese campo. Es solo un cambio de cómo se carga el dato — todavía NO filtra ni restringe qué clientes ve cada usuario (eso quedó pausado, ver más abajo).

## Paneles: mostrar/ocultar secciones opcionales desde Configuración

Nueva pestaña "Paneles" en Configuración, con 4 switches guardados en `configuracion_estudio` (todos `true` por defecto, para no cambiar el comportamiento de nadie hasta que se apague alguno a mano):

- `panel_calendario_nuevo_ejercicio`: sección de enero en Calendario.
- `panel_calendario_columna_obligacion`: columna "Obligación" en Calendario.
- `panel_rg90_visible`: si RG 90 aparece en filtros/checkboxes.
- `panel_honorarios_cuota_anual`: si se muestra la sección de cuota anual en Honorarios.

Pensado para crecer más adelante con más opciones a medida que se necesiten — esta primera versión cubre solo estas 4.

## Tema claro/oscuro

`js/configuracion.js` guarda la preferencia en `localStorage` (por computadora, no por usuario de Supabase) y aplica `data-theme="oscuro"` en `<html>`. Todos los colores de `css/style.css` están en variables CSS (`--color-*`) definidas en `:root` y sobreescritas en `:root[data-theme='oscuro']`; si se agrega un color nuevo a algún estilo, tiene que usar una variable existente (o agregar una nueva en ambos bloques), nunca un color fijo, para no romper el tema oscuro.

## Login (Supabase Auth)

La app pide email/contraseña al arrancar (`js/auth.js`, sección `#vista-login` de `index.html`). No hay pantalla de alta de usuarios: se crean a mano en el dashboard de Supabase (Authentication → Users). Mientras no haya sesión válida, RLS rechaza cualquier consulta a la base (la seguridad real está en `schema.sql`, no en el frontend). Los campos de email/contraseña tienen `autocomplete="username"`/`autocomplete="current-password"`, así que el navegador/Electron los recuerda solo. Hay un link "¿Olvidaste tu contraseña?" que dispara `supabase.auth.resetPasswordForEmail()`.

## Bug corregido: cartel de error "pegado" tras el login

Cada pantalla intenta cargar sus datos apenas arranca la app, antes de terminar de loguearse (a propósito: `#app-autenticado` está oculto en ese momento, así que no se nota). Ese primer intento fallaba por falta de sesión y mostraba un cartel rojo de error — pero el código nunca lo volvía a ocultar cuando la carga real, después del login, salía bien. Se corrigió en Presentaciones, Calendario e Historial (ocultan el cartel en el punto de éxito de su función de carga); Honorarios y Configuración ya no tenían el bug porque su mensaje se autooculta solo con un `setTimeout`.

## Honorarios: cómo se calcula "Al día" / "Debe"

Acumula TODA la deuda desde que se configuró el honorario de ese cliente (`honorarios.created_at`), **por separado para la cuota mensual y la anual** (un cliente puede tener las dos): para cada cuota configurada, cuenta cuántos períodos (meses o años) pasaron hasta el período vigente inclusive, multiplica por el monto pactado de esa cuota, y le resta la suma de los pagos históricos de ese mismo `tipo_honorario` (no solo los del período vigente). El estado general es "Debe" si cualquiera de las dos cuotas tiene saldo pendiente; el badge muestra la suma de ambos saldos. Si un cliente debe 3 meses atrasados de la cuota mensual y solo pagó el mes actual, sigue mostrando "Debe" con el saldo pendiente.

## Pendientes / próximos pasos

1. Empaquetar la app como `.exe` instalable con `electron-builder` (hoy solo corre en modo desarrollo con `npm start`). Deliberadamente dejado para el final, después de terminar y probar bien todo lo demás en modo desarrollo. Para esto, las credenciales de Supabase van EMPAQUETADAS dentro del instalador (no un `.env` que cada usuario complete a mano) — la clave publicable está pensada para eso, y la seguridad real sigue estando en el login + RLS.
2. Posición del menú de navegación configurable (izquierda/arriba/abajo/derecha) — pedido por el usuario pero marcado como secundario, se hace después de lo demás.
3. Si más adelante se necesita distinguir permisos por rol (admin vs responsable), usar la columna `perfiles.rol` para escribir policies más finas (hoy cualquier autenticado tiene acceso total — ver sección 5/14 de `schema.sql`).
4. Evaluar agregar un flujo de invitación/alta de usuarios desde la propia app (hoy se crean a mano en el dashboard de Supabase).
5. Corrector ortográfico (`spellcheck="true"`) y formato de miles con punto ya están aplicados en los campos de texto y montos, respectivamente — sin pendientes ahí.
6. Cualquier tema de acceso/visibilidad por usuario (más allá de que el campo Responsable ahora se elija de una lista) queda fuera de este documento por ahora — se retoma directamente con el usuario cuando corresponda.

> Nota: la Fase 4 (Presentaciones) no tenía ningún problema real — el comentario anterior sobre "revisar Fase 4" fue una falsa alarma, confirmada con el usuario.

> Nota técnica: la pantalla de login tenía un bug de CSS (`.vista-login { display: flex }` empatada en especificidad con `.oculto { display: none }`, y como estaba declarada después en el archivo, ganaba la cascada y el login nunca se ocultaba después de loguearse). Se arregló agregando `.vista-login.oculto { display: none }`, más específico. Ojo con esto al agregar estilos nuevos a una vista que ya tiene su propia clase de layout además de `vista`/`oculto`.

## Agentes de desarrollo (agency-agents)

Se instalaron en `.claude/agents/` 68 subagentes de Claude Code tomados de [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) (MIT), divisiones `engineering`, `testing` y `security` — para usar en la próxima etapa (modificar/mejorar cosas puntuales de la app).

## Credenciales de Supabase

Proyecto de Supabase ya creado (URL: `https://vdrbtiqspxbrppmvkcfs.supabase.co`). Las credenciales reales van en `.env` (nunca en git). En una PC nueva, copiar `.env.example` y completar con los mismos datos (Project Settings → API Keys en supabase.com).
