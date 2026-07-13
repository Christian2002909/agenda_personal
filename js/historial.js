// js/historial.js
// -----------------------------------------------------------------------
// Pantalla Historial: muestra, para la obligación elegida en el filtro,
// TODOS los períodos (se hayan presentado o no) de UN año elegido en el
// segundo filtro (un año a la vez), agrupados por vencimiento igual que
// Presentaciones. Para obligaciones mensuales (IVA) se ve el año elegido
// completo, mes por mes, con la fecha exacta de vencimiento de cada uno
// (como en Marangatu): verde si se presentó, rojo si ya venció y no se
// presentó, gris si todavía no llega la fecha. Para las anuales se ve una
// fila por cliente para el ejercicio elegido.
//
// A diferencia de Calendario (que solo muestra el período VIGENTE y
// desaparece apenas se presenta), acá se ve todo: por eso sirve para
// encontrar lo que se pasó de fecha sin presentar -- y, a diferencia de
// antes, acá también se puede corregir: cada celda de período (pasado,
// presente o futuro) es clickeable y tilda/destilda "presentado" en la
// tabla `presentaciones`, creando la fila si todavía no existía (esa tabla
// solo se autogenera para el período vigente desde presentaciones.js).
// -----------------------------------------------------------------------

(function () {

const supabaseHistorial = require('./js/supabaseClient.js');
const { formatearFechaISO, calcularFechaVencimiento, DIA_POR_TERMINACION_RUC } = require('./js/calendario-logica.js');

const elFiltroObligacion = document.getElementById('historial-filtro-obligacion');
const elFiltroAnio = document.getElementById('historial-filtro-anio');
const elGrupos = document.getElementById('historial-grupos');
const elSinHistorial = document.getElementById('sin-historial');
const elHistorialMensaje = document.getElementById('historial-mensaje');

const NOMBRES_MES_HISTORIAL = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Primer año que muestra el selector. No hay datos reales de antes de esto,
// así que no hace falta ir más atrás; el techo del selector es siempre el
// año actual, calculado en el momento (nunca hardcodeado).
const ANIO_MINIMO_HISTORIAL = 2022;

let obligacionesCache = [];

// --- Filtro por obligación ---------------------------------------------

async function cargarCatalogoObligaciones() {
  const [{ data, error }, { data: configuracion, error: errorConfiguracion }] = await Promise.all([
    supabaseHistorial.from('obligaciones').select('*').neq('periodicidad', 'manual').order('id'),
    supabaseHistorial.from('configuracion_estudio').select('panel_rg90_visible').eq('id', 1).maybeSingle(),
  ]);

  if (error) throw error;

  // Si falló la lectura de configuración, no ocultamos nada por un error
  // transitorio de una tabla que no es la esencial de esta pantalla.
  const panelRg90Visible = errorConfiguracion ? true : (configuracion?.panel_rg90_visible ?? true);

  obligacionesCache = panelRg90Visible
    ? (data || [])
    : (data || []).filter((o) => o.codigo !== 'RG90_MENSUAL' && o.codigo !== 'RG90_ANUAL');

  const seleccionActual = elFiltroObligacion.value;
  elFiltroObligacion.innerHTML = '';

  for (const obligacion of obligacionesCache) {
    const opcion = document.createElement('option');
    opcion.value = obligacion.id;
    opcion.textContent = obligacion.nombre;
    elFiltroObligacion.appendChild(opcion);
  }

  const sigueExistiendo = [...elFiltroObligacion.options].some((o) => o.value === seleccionActual);
  if (sigueExistiendo) {
    elFiltroObligacion.value = seleccionActual;
  } else {
    const iva = obligacionesCache.find((o) => o.codigo === 'IVA');
    if (iva) elFiltroObligacion.value = iva.id;
  }
}

elFiltroObligacion.addEventListener('change', () => dibujarHistorial());

// --- Filtro por año (un año a la vez, ej. 2022...año actual) -------------

// El rango es siempre el mismo dentro de un mismo día, así que se arma una
// sola vez (no hace falta rehacerlo en cada `cargarHistorial`); si ya tiene
// opciones, no lo reconstruye para no perder la selección del usuario.
function poblarFiltroAnio() {
  if (!elFiltroAnio || elFiltroAnio.options.length > 0) return;

  const anioActual = new Date().getFullYear();
  for (let anio = anioActual; anio >= ANIO_MINIMO_HISTORIAL; anio -= 1) {
    const opcion = document.createElement('option');
    opcion.value = anio;
    opcion.textContent = anio;
    elFiltroAnio.appendChild(opcion);
  }
  elFiltroAnio.value = anioActual;
}

if (elFiltroAnio) elFiltroAnio.addEventListener('change', () => dibujarHistorial());

// --- Cargar y mostrar ----------------------------------------------------

async function cargarHistorial() {
  if (!supabaseHistorial) return;

  try {
    poblarFiltroAnio();
    await cargarCatalogoObligaciones();
    await dibujarHistorial();
  } catch (error) {
    console.error('Error al cargar el historial:', error);
    if (elHistorialMensaje) {
      elHistorialMensaje.textContent = 'No se pudo cargar el historial.';
      elHistorialMensaje.classList.remove('oculto');
    }
  }
}

async function dibujarHistorial() {
  const obligacionId = Number(elFiltroObligacion.value);
  const obligacion = obligacionesCache.find((o) => o.id === obligacionId);
  if (!obligacion) return;

  const anioSeleccionado = Number(elFiltroAnio?.value) || new Date().getFullYear();

  try {
    const [
      { data: clienteObligaciones, error: errorClienteObligaciones },
      { data: presentaciones, error: errorPresentaciones },
      { data: feriados, error: errorFeriados },
    ] = await Promise.all([
      supabaseHistorial
        .from('cliente_obligaciones')
        .select('clientes(id, razon_social, ruc, terminacion_ruc, cierre_fiscal_mes)')
        .eq('obligacion_id', obligacionId),
      supabaseHistorial
        .from('presentaciones')
        .select('cliente_id, periodo, estado, fecha_presentacion')
        .eq('obligacion_id', obligacionId),
      supabaseHistorial.from('feriados').select('fecha'),
    ]);

    if (errorClienteObligaciones) throw errorClienteObligaciones;
    if (errorPresentaciones) throw errorPresentaciones;
    if (errorFeriados) throw errorFeriados;

    const feriadosSet = new Set((feriados || []).map((f) => f.fecha));
    const clientes = (clienteObligaciones || [])
      .map((fila) => fila.clientes)
      .filter((cliente) => cliente && cliente.terminacion_ruc !== null && cliente.terminacion_ruc !== undefined);

    // Clave "cliente_id-periodo" -> fila de presentaciones, para no tener
    // que recorrer el arreglo entero por cada celda.
    const presentacionesPorClientePeriodo = new Map(
      (presentaciones || []).map((p) => [`${p.cliente_id}-${p.periodo}`, p])
    );

    if (obligacion.periodicidad === 'mensual') {
      dibujarGrupoMensual(clientes, obligacion, presentacionesPorClientePeriodo, feriadosSet, anioSeleccionado);
    } else {
      dibujarGrupoAnual(clientes, obligacion, presentacionesPorClientePeriodo, feriadosSet, anioSeleccionado);
    }
    // La carga salió bien: si había quedado pegado un cartel de error de
    // un intento anterior (por ejemplo, el primero antes de loguearse),
    // lo ocultamos.
    if (elHistorialMensaje) elHistorialMensaje.classList.add('oculto');
  } catch (error) {
    console.error('Error al mostrar el historial:', error);
    if (elHistorialMensaje) {
      elHistorialMensaje.textContent = 'No se pudo cargar el historial.';
      elHistorialMensaje.classList.remove('oculto');
    }
  }
}

// Agrupa clientes por terminación de RUC, igual que Presentaciones.
function agruparPorVencimiento(clientes) {
  const porTerminacion = new Map();
  for (const cliente of clientes) {
    const terminacion = cliente.terminacion_ruc;
    if (!porTerminacion.has(terminacion)) porTerminacion.set(terminacion, []);
    porTerminacion.get(terminacion).push(cliente);
  }

  for (const lista of porTerminacion.values()) {
    lista.sort((a, b) => a.razon_social.localeCompare(b.razon_social));
  }

  return [...porTerminacion.keys()]
    .sort((a, b) => a - b)
    .map((terminacion) => ({ terminacion, clientes: porTerminacion.get(terminacion) }));
}

// Determina el estado de un período ya calculado: "presentado" (verde),
// "vencido" (rojo, ya pasó la fecha y no se presentó) o "pendiente" (gris,
// todavía no llega la fecha).
function calcularEstadoCelda(fechaVencimiento, filaPresentacion, hoy) {
  if (filaPresentacion?.estado === 'presentado') {
    return { estado: 'presentado', fecha: filaPresentacion.fecha_presentacion };
  }
  return { estado: fechaVencimiento < hoy ? 'vencido' : 'pendiente', fecha: null };
}

// Texto descriptivo del estado de una celda, usado como título/tooltip en
// la grilla mensual y como texto visible en la columna "Presentado" anual.
function textoEstadoHistorial(estado, fecha) {
  if (estado === 'presentado') return `Presentado el ${formatearFechaHoraHistorial(fecha)}`;
  if (estado === 'vencido') return 'No presentado (vencido)';
  return 'Todavía no vence';
}

// Arma el <td> editable de un período: un checkbox que ocupa toda la celda
// (clickear en cualquier parte de la celda tilda/destilda), con los datos
// necesarios en el dataset para que el listener de más abajo sepa qué fila
// de `presentaciones` crear o actualizar. `compacta` apila el checkbox
// arriba de la fecha en vez de ponerlos lado a lado (grilla mensual).
function construirCeldaEditableHtml({ clienteId, obligacionId, periodo, estado, fecha, textoVisible, compacta }) {
  const marcado = estado === 'presentado';
  const titulo = textoEstadoHistorial(estado, fecha);
  return `
    <td class="celda-historial celda-historial-${estado}">
      <label class="celda-historial-toggle${compacta ? ' celda-historial-toggle-compacta' : ''}" title="${escaparHtmlHistorial(titulo)}">
        <input
          type="checkbox"
          data-historial-celda
          data-cliente-id="${clienteId}"
          data-obligacion-id="${obligacionId}"
          data-periodo="${periodo}"
          ${marcado ? 'checked' : ''}
        />
        <span>${textoVisible}</span>
      </label>
    </td>
  `;
}

function dibujarGrupoMensual(clientes, obligacion, presentacionesPorClientePeriodo, feriadosSet, anioSeleccionado) {
  elGrupos.innerHTML = '';

  if (clientes.length === 0) {
    elSinHistorial.classList.remove('oculto');
    return;
  }
  elSinHistorial.classList.add('oculto');

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  for (const { terminacion, clientes: clientesDelGrupo } of agruparPorVencimiento(clientes)) {
    const grupo = document.createElement('div');
    grupo.className = 'grupo-vencimiento';

    const encabezado = document.createElement('h3');
    encabezado.className = 'grupo-vencimiento-titulo';
    encabezado.textContent = `VENCIMIENTO ${terminacion} - FECHA ${DIA_POR_TERMINACION_RUC[terminacion]}`;
    grupo.appendChild(encabezado);

    const tabla = document.createElement('table');
    tabla.className = 'tabla-clientes tabla-historial-mensual';
    tabla.innerHTML = `
      <thead>
        <tr>
          <th>Cliente</th>
          <th>RUC</th>
          ${NOMBRES_MES_HISTORIAL.map((mes) => `<th>${mes}</th>`).join('')}
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = tabla.querySelector('tbody');

    for (const cliente of clientesDelGrupo) {
      const cierreFiscalMes = cliente.cierre_fiscal_mes ?? 12;
      const tr = document.createElement('tr');

      const celdasMes = [];
      for (let mes = 1; mes <= 12; mes += 1) {
        const periodoAncla = new Date(anioSeleccionado, mes - 1, 1);
        const fechaVencimiento = calcularFechaVencimiento({
          codigoObligacion: obligacion.codigo,
          periodicidad: 'mensual',
          terminacionRuc: cliente.terminacion_ruc,
          periodoAncla,
          feriadosSet,
          cierreFiscalMes,
        });

        if (!fechaVencimiento) {
          celdasMes.push('<td>—</td>');
          continue;
        }

        const periodoISO = formatearFechaISO(periodoAncla);
        const filaPresentacion = presentacionesPorClientePeriodo.get(`${cliente.id}-${periodoISO}`);
        const { estado, fecha } = calcularEstadoCelda(fechaVencimiento, filaPresentacion, hoy);

        celdasMes.push(construirCeldaEditableHtml({
          clienteId: cliente.id,
          obligacionId: obligacion.id,
          periodo: periodoISO,
          estado,
          fecha,
          textoVisible: formatearFechaCortaHistorial(fechaVencimiento),
          compacta: true,
        }));
      }

      tr.innerHTML = `
        <td><button class="boton-link" data-editar-cliente="${cliente.id}">${escaparHtmlHistorial(cliente.razon_social)}</button></td>
        <td>${escaparHtmlHistorial(cliente.ruc)}</td>
        ${celdasMes.join('')}
      `;
      tbody.appendChild(tr);
    }

    grupo.appendChild(tabla);

    // Envuelta en .tabla-scroll (mismo contenedor que usa Honorarios) para
    // que, si la ventana es angosta, la tabla scrollee horizontalmente en
    // vez de desbordar la tarjeta.
    const contenedorScroll = document.createElement('div');
    contenedorScroll.className = 'tabla-scroll';
    contenedorScroll.appendChild(tabla);
    grupo.appendChild(contenedorScroll);

    elGrupos.appendChild(grupo);
  }
}

function dibujarGrupoAnual(clientes, obligacion, presentacionesPorClientePeriodo, feriadosSet, anioSeleccionado) {
  elGrupos.innerHTML = '';

  if (clientes.length === 0) {
    elSinHistorial.classList.remove('oculto');
    return;
  }
  elSinHistorial.classList.add('oculto');

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  for (const { terminacion, clientes: clientesDelGrupo } of agruparPorVencimiento(clientes)) {
    const grupo = document.createElement('div');
    grupo.className = 'grupo-vencimiento';

    const encabezado = document.createElement('h3');
    encabezado.className = 'grupo-vencimiento-titulo';
    encabezado.textContent = `VENCIMIENTO ${terminacion} - FECHA ${DIA_POR_TERMINACION_RUC[terminacion]}`;
    grupo.appendChild(encabezado);

    const tabla = document.createElement('table');
    tabla.className = 'tabla-clientes';
    tabla.innerHTML = `
      <thead>
        <tr>
          <th>Cliente</th>
          <th>RUC</th>
          <th>Ejercicio</th>
          <th>Vencimiento</th>
          <th>Presentado</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = tabla.querySelector('tbody');

    for (const cliente of clientesDelGrupo) {
      const cierreFiscalMes = cliente.cierre_fiscal_mes ?? 12;

      const periodoAncla = new Date(anioSeleccionado, 0, 1);
      const fechaVencimiento = calcularFechaVencimiento({
        codigoObligacion: obligacion.codigo,
        periodicidad: 'anual',
        terminacionRuc: cliente.terminacion_ruc,
        periodoAncla,
        feriadosSet,
        cierreFiscalMes,
      });

      if (!fechaVencimiento) continue;

      const periodoISO = formatearFechaISO(periodoAncla);
      const filaPresentacion = presentacionesPorClientePeriodo.get(`${cliente.id}-${periodoISO}`);
      const { estado, fecha } = calcularEstadoCelda(fechaVencimiento, filaPresentacion, hoy);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><button class="boton-link" data-editar-cliente="${cliente.id}">${escaparHtmlHistorial(cliente.razon_social)}</button></td>
        <td>${escaparHtmlHistorial(cliente.ruc)}</td>
        <td>${anioSeleccionado}</td>
        <td>${formatearFechaVisibleHistorial(fechaVencimiento)}</td>
        ${construirCeldaEditableHtml({
          clienteId: cliente.id,
          obligacionId: obligacion.id,
          periodo: periodoISO,
          estado,
          fecha,
          textoVisible: textoEstadoHistorial(estado, fecha),
          compacta: false,
        })}
      `;
      tbody.appendChild(tr);
    }

    grupo.appendChild(tabla);
    elGrupos.appendChild(grupo);
  }
}

function formatearFechaVisibleHistorial(fecha) {
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const anio = fecha.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

// Fecha corta ("dd/mm", sin año) usada en la grilla mensual: el año ya está
// fijado por el selector de arriba, así que repetirlo en cada una de las 12
// celdas solo ocupaba espacio sin agregar información.
function formatearFechaCortaHistorial(fecha) {
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}`;
}

function formatearFechaHoraHistorial(fechaISOConHora) {
  const fecha = new Date(fechaISOConHora);
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const anio = fecha.getFullYear();
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minutos = String(fecha.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${anio} ${hora}:${minutos}`;
}

function escaparHtmlHistorial(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// --- Abrir un cliente para editar (desde el nombre) -----------------------

elGrupos.addEventListener('click', (evento) => {
  const boton = evento.target.closest('button[data-editar-cliente]');
  if (boton && typeof window.editarClienteDesdeOtraVista === 'function') {
    window.editarClienteDesdeOtraVista(Number(boton.dataset.editarCliente));
  }
});

// --- Marcar / desmarcar "presentado" en cualquier período, pasado o no ----
// A diferencia de Presentaciones (que solo actualiza una fila que ya existe
// siempre, porque `asegurarPresentacionesDelPeriodoVigente` la crea de
// antemano), acá el período puede ser viejo y no tener fila todavía -- por
// eso usamos `upsert` sobre la misma constraint única que ya usa esa
// función (`cliente_id, obligacion_id, periodo`) en vez de `update`.
elGrupos.addEventListener('change', async (evento) => {
  const checkbox = evento.target.closest('input[type="checkbox"][data-historial-celda]');
  if (!checkbox) return;

  const marcarComoPresentado = checkbox.checked;
  const clienteId = Number(checkbox.dataset.clienteId);
  const obligacionId = Number(checkbox.dataset.obligacionId);
  const periodo = checkbox.dataset.periodo;

  const cambios = marcarComoPresentado
    ? { estado: 'presentado', fecha_presentacion: new Date().toISOString() }
    : { estado: 'pendiente', fecha_presentacion: null };

  checkbox.disabled = true;

  try {
    const { error } = await supabaseHistorial
      .from('presentaciones')
      .upsert(
        [{ cliente_id: clienteId, obligacion_id: obligacionId, periodo, ...cambios }],
        { onConflict: 'cliente_id,obligacion_id,periodo' }
      );

    if (error) throw error;

    // Repintamos toda la grilla para reflejar el nuevo estado (sin
    // recargar la pantalla ni el catálogo de obligaciones/años, que no
    // cambiaron) -- mismo patrón que usa Presentaciones tras cada tilde.
    await dibujarHistorial();
  } catch (error) {
    console.error('Error al actualizar el historial:', error);
    checkbox.checked = !marcarComoPresentado; // revertimos el check visualmente
    checkbox.disabled = false;
    if (elHistorialMensaje) {
      elHistorialMensaje.textContent = 'No se pudo guardar el cambio. Intentá de nuevo.';
      elHistorialMensaje.classList.remove('oculto');
    }
  }
});

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarHistorial = cargarHistorial;

cargarHistorial();

})();
