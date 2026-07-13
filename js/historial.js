// js/historial.js
// -----------------------------------------------------------------------
// Pantalla Historial: muestra, para la obligación elegida en el filtro,
// TODOS los períodos (se hayan presentado o no), agrupados por vencimiento
// igual que Presentaciones. Para obligaciones mensuales (IVA) se ve el año
// completo, mes por mes, con la fecha exacta de vencimiento de cada uno
// (como en Marangatu): verde si se presentó, rojo si ya venció y no se
// presentó, gris si todavía no llega la fecha. Para las anuales se ve una
// fila por año (actual y anterior).
//
// A diferencia de Calendario (que solo muestra el período VIGENTE y
// desaparece apenas se presenta), acá se ve todo: por eso sirve para
// encontrar lo que se pasó de fecha sin presentar.
// -----------------------------------------------------------------------

(function () {

const supabaseHistorial = require('./js/supabaseClient.js');
const { formatearFechaISO, calcularFechaVencimiento, DIA_POR_TERMINACION_RUC } = require('./js/calendario-logica.js');

const elFiltroObligacion = document.getElementById('historial-filtro-obligacion');
const elGrupos = document.getElementById('historial-grupos');
const elSinHistorial = document.getElementById('sin-historial');
const elHistorialMensaje = document.getElementById('historial-mensaje');

const NOMBRES_MES_HISTORIAL = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

let obligacionesCache = [];

// --- Filtro por obligación ---------------------------------------------

async function cargarCatalogoObligaciones() {
  const { data, error } = await supabaseHistorial
    .from('obligaciones')
    .select('*')
    .neq('periodicidad', 'manual')
    .order('id');

  if (error) throw error;

  obligacionesCache = data || [];

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

// --- Cargar y mostrar ----------------------------------------------------

async function cargarHistorial() {
  if (!supabaseHistorial) return;

  try {
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
      dibujarGrupoMensual(clientes, obligacion, presentacionesPorClientePeriodo, feriadosSet);
    } else {
      dibujarGrupoAnual(clientes, obligacion, presentacionesPorClientePeriodo, feriadosSet);
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

function dibujarGrupoMensual(clientes, obligacion, presentacionesPorClientePeriodo, feriadosSet) {
  elGrupos.innerHTML = '';

  if (clientes.length === 0) {
    elSinHistorial.classList.remove('oculto');
    return;
  }
  elSinHistorial.classList.add('oculto');

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const anioActual = hoy.getFullYear();

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
        const periodoAncla = new Date(anioActual, mes - 1, 1);
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
        const { estado } = calcularEstadoCelda(fechaVencimiento, filaPresentacion, hoy);

        celdasMes.push(
          `<td class="celda-historial celda-historial-${estado}">${formatearFechaVisibleHistorial(fechaVencimiento)}</td>`
        );
      }

      tr.innerHTML = `
        <td><button class="boton-link" data-editar-cliente="${cliente.id}">${escaparHtmlHistorial(cliente.razon_social)}</button></td>
        <td>${escaparHtmlHistorial(cliente.ruc)}</td>
        ${celdasMes.join('')}
      `;
      tbody.appendChild(tr);
    }

    grupo.appendChild(tabla);
    elGrupos.appendChild(grupo);
  }
}

function dibujarGrupoAnual(clientes, obligacion, presentacionesPorClientePeriodo, feriadosSet) {
  elGrupos.innerHTML = '';

  if (clientes.length === 0) {
    elSinHistorial.classList.remove('oculto');
    return;
  }
  elSinHistorial.classList.add('oculto');

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const anioActual = hoy.getFullYear();
  const aniosAMostrar = [anioActual - 1, anioActual];

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
          <th>Estado</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = tabla.querySelector('tbody');

    for (const cliente of clientesDelGrupo) {
      const cierreFiscalMes = cliente.cierre_fiscal_mes ?? 12;

      for (const anioEjercicio of aniosAMostrar) {
        const periodoAncla = new Date(anioEjercicio, 0, 1);
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
          <td>${anioEjercicio}</td>
          <td class="celda-historial celda-historial-${estado}">${formatearFechaVisibleHistorial(fechaVencimiento)}</td>
          <td>${estado === 'presentado' ? `Presentado el ${formatearFechaHoraHistorial(fecha)}` : estado === 'vencido' ? 'No presentado' : 'Todavía no vence'}</td>
        `;
        tbody.appendChild(tr);
      }
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

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarHistorial = cargarHistorial;

cargarHistorial();

})();
