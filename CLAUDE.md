# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Electron desktop app for a Paraguayan accounting firm (estudio contable): tracks clients, their tax obligations (obligaciones), filing deadlines (vencimientos), whether each obligation was filed on time, and fees owed/paid per client. Backend is Supabase (Postgres), accessed directly from the renderer via `@supabase/supabase-js` — there is no separate API server.

## Commands

```bash
npm install       # install dependencies
npm start         # launch the Electron app (electron .)
```

There is no build step, bundler, linter, or test suite — this is vanilla HTML/CSS/JS loaded directly by Electron. There's no `node -c`/test command configured; syntax-check a changed file with `node --check js/<file>.js` since the renderer files use CommonJS `require()` and can be parsed by plain Node even though they reference `document`/`window`.

Electron requires **Node.js v22.12+** on the host machine — older Node fails with `ERR_REQUIRE_ESM` when Electron tries to self-download its binary on first run.

## Database

`schema.sql` is the single source of truth for the Postgres schema and is meant to be pasted into the Supabase SQL Editor and re-run whenever it changes. It is written to be **idempotent and safe to re-run against a live database that already has data** — every table/column addition uses `if not exists` guards, and every RLS policy is preceded by `drop policy if exists` before being recreated. When you add or change a column/constraint on an existing table, add the migration path (`alter table ... add column if not exists`, drop+recreate for constraints whose condition changed) rather than only updating the `create table` block, and order migration statements *before* any `comment on column` referencing the new column (a `create table if not exists` is a no-op against an existing table, so a comment on a column that migration hasn't added yet will fail on non-fresh installs).

Row Level Security is enabled on every table and requires the `authenticated` Supabase Auth role — there is no `anon` access anywhere. Users are created manually in the Supabase dashboard (Authentication → Users); the app has no sign-up flow.

## Architecture

**No build/module system**: every screen's JS file is loaded as a plain `<script>` tag in `index.html` and wraps its top-level code in `(function () { ... })();` so that two files can both `require()` `calendario-logica.js` without their top-level `const`s colliding. Each screen exposes exactly one function on `window` (`window.cargarClientes`, `window.cargarCalendario`, etc.) for `js/navegacion.js` to call when that tab is opened, via the `FUNCION_DE_RECARGA_POR_VISTA` map. A screen that needs to trigger another screen's logic does so through a similarly exposed `window.*` function (e.g. `window.editarClienteDesdeOtraVista`, `window.mostrarVista`) — this is the only cross-file communication mechanism in the app.

**Electron security posture**: `main.js` sets `nodeIntegration: true, contextIsolation: false` deliberately, so every renderer file can call `require()` directly. This is only acceptable because the window never loads remote content (`index.html` is always local) — if that ever changes, this must move to a `preload.js` + `contextBridge`.

**Auth gating**: `js/auth.js` shows `#vista-login` until Supabase Auth reports a session, then reveals `#app-autenticado` (the nav + all tabs). Screens self-invoke their `cargarX()` at script-load time regardless of auth state, so their first fetch attempt is expected to fail against RLS before login — this is harmless because `#app-autenticado` is hidden at that point, and `auth.js` re-triggers the active tab's load once a session exists.

**Perpetual calendar**: `js/calendario-logica.js` holds the only date-math in the app (pure functions, no Supabase/DOM access, unit-testable with plain `node -e`). Filing due dates are derived from `clientes.terminacion_ruc` (last digit of RUC → fixed day-of-month) and `clientes.cierre_fiscal_mes` (fiscal year-end: only 12/4/6 are valid per Decreto 3182/2019), expressed as "N months after fiscal close" so the same formula works regardless of which of the three close months a client uses. `clientes.terminacion_ruc`/`cierre_fiscal_mes` plus `cliente_obligaciones` (which obligations apply to which client, configured via checkboxes in the Clientes form — there is no automatic assignment) drive both `js/calendario.js` (generates the current period's `calendario_vencimientos` rows on every tab load — safe to re-run, upserts with `ignoreDuplicates`) and `js/presentaciones.js` (same generation for the `presentaciones` table, which tracks filed/not-filed status separately from the computed due date).

**Screen responsibilities have shifted from their original names** — check current behavior in code, not just the tab label:
- `js/presentaciones.js` is the default/first tab. It filters by a single obligación (dropdown, defaults to IVA) and groups clients by `terminacion_ruc` ("VENCIMIENTO N - FECHA D"), mirroring the firm's original Excel control sheet. It only shows the current vigente period.
- `js/clientes.js` is alta/edición only — no listing/table lives here. To edit an existing client, another screen calls `window.editarClienteDesdeOtraVista(clienteId)`, which must load that client's data and set an `ignorarProximaCarga` flag *before* switching tabs (switching tabs fires `cargarClientes()` via `navegacion.js`, which would otherwise reset the form to blank).
- `js/calendario.js` only shows the current vigente period, per obligación the client has assigned, that has *not* been marked presentado — it does not accumulate past periods.
- `js/historial.js` is the full audit trail: for the obligación selected in its own filter dropdown, it recomputes due dates for every period of the current year (monthly obligations) or the current+previous year (annual obligations) using `calcularFechaVencimiento()` directly — it does not depend on a `calendario_vencimientos` row existing, since that table only ever holds the currently-vigente period.

**Honorarios (fees)** intentionally has no `estado` column on the `honorarios` table — "Al día"/"Debe" is always derived by comparing pactado × elapsed periods (since `honorarios.created_at`) against the sum of `pagos_honorarios`, so it can never drift out of sync with actual payments.
