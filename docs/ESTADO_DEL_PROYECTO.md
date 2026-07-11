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
| 4 | Presentaciones | Checkbox por Cliente + Obligación + Período vigente, con fecha automática al marcar. **Ver "Pendientes" abajo: el usuario reportó un problema sin especificar todavía** |
| 5 | Historial | Todo lo presentado alguna vez, orden cronológico, sin agrupar |
| 6 | Honorarios | Monto pactado por cliente, registro de pagos, estado "Al día"/"Debe" calculado en el momento |

## Cómo levantar el proyecto en una PC nueva

1. Clonar el repositorio.
2. `npm install`
3. Copiar `.env.example` como `.env` y completar con las credenciales reales de Supabase (Project Settings → API Keys en supabase.com → "Clave publicable" `sb_publishable_...` es la que va en `SUPABASE_ANON_KEY`). **El archivo `.env` nunca se sube a git.**
4. La base de datos de Supabase ya existe con todas las tablas (se creó ejecutando `schema.sql` en el SQL Editor de Supabase). Si es una base nueva, hay que correr ese archivo ahí.
5. `npm start`

## Estructura de archivos

```
main.js                    Proceso principal de Electron (abre la ventana)
index.html                 Toda la interfaz (una sola página, varias "vistas" que se muestran/ocultan)
css/style.css               Estilos
js/supabaseClient.js        Crea la conexión a Supabase (null si falta el .env, para no romper la app)
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
- **RLS (seguridad de Supabase) permisiva por ahora**: no hay Supabase Auth todavía, así que todas las tablas tienen una policy que permite todo a la clave anónima. Está documentado el camino para endurecerlo en `schema.sql`, al final de cada sección de tabla.

## Reglas de negocio del calendario perpetuo (confirmadas con la SET, Paraguay)

Ver también `schema.sql`, sección "8.1 REGLAS DE NEGOCIO".

- **Día de vencimiento según terminación de RUC** (Resolución General 01/2007 y 38/2020): 0→7, 1→9, 2→11, 3→13, 4→15, 5→17, 6→19, 7→21, 8→23, 9→25.
- **IVA**: mensual, vence ese día del mismo mes.
- **IRE SIMPLE**: anual, vence en marzo del año siguiente al cierre fiscal.
- **IRE GENERAL** y **ESTADO FINANCIERO**: anuales, vencen en abril del año siguiente (se presentan juntos).
- **IDU**: NO se genera automático. Se carga a mano en Supabase cuando el contador confirma que un cliente distribuyó dividendos ese año.
- Si la fecha cae sábado, domingo o feriado, se corre al siguiente día hábil.
- **Se asume cierre fiscal 31/12 para todos los clientes** (no hay todavía un campo de cierre fiscal personalizado por cliente — ver "Pendientes").
- **Feriados**: no vienen precargados. Paraguay tiene feriados fijos + hasta 3 adicionales por decreto que cambian cada año, así que hay que cargarlos a mano en la tabla `feriados` de Supabase a medida que se conocen (justo como lo pidió el usuario).

## Honorarios: cómo se calcula "Al día" / "Debe"

Es una simplificación intencional: el estado solo mira si ya se pagó (parcial o total) el **período vigente** de ese cliente. No acumula deuda de períodos anteriores todavía. Si un cliente debe 3 meses atrasados pero pagó el mes actual, va a mostrar "Al día". Esto se puede mejorar más adelante si el estudio lo necesita (sumar toda la deuda histórica en vez de solo el período actual).

## Pendientes / próximos pasos

1. **Fase 4 (Presentaciones)**: el usuario escribió "no, la fase 4" en el chat sin especificar el problema todavía. Falta preguntarle qué vio mal y revisarlo. No asumir que está rota — puede ser un malentendido, hay que confirmar primero.
2. Empaquetar la app como `.exe` instalable con `electron-builder` (hoy solo corre en modo desarrollo con `npm start`).
3. Cuando se agregue Supabase Auth (login), endurecer las políticas RLS — el camino ya está documentado en `schema.sql`.
4. Si el estudio tiene clientes con cierre fiscal distinto a diciembre, habría que agregar un campo de cierre fiscal por cliente y ajustar `calendario-logica.js`.
5. Considerar si "Al día"/"Debe" en Honorarios debería acumular deuda de períodos anteriores en vez de mirar solo el período vigente.

## Credenciales de Supabase

Proyecto de Supabase ya creado (URL: `https://vdrbtiqspxbrppmvkcfs.supabase.co`). Las credenciales reales van en `.env` (nunca en git). En una PC nueva, copiar `.env.example` y completar con los mismos datos (Project Settings → API Keys en supabase.com).
