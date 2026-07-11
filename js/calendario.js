// js/calendario.js
// -----------------------------------------------------------------------
// Pantalla de Calendario. Cada vez que se abre esta pestaña:
//   1. Se asegura que exista el vencimiento del período vigente para cada
//      cliente x obligación automática (IVA, IRE SIMPLE, IRE GENERAL,
//      ESTADO FINANCIERO). Si ya existe, no se toca (por eso es "perpetuo":
//      nunca hay que recrearlo a mano).
//   2. Se muestra todo lo que hay en la tabla, ordenado por fecha de
//      vencimiento.
// La obligación IDU queda afuera de la generación automática: se crea a
// mano desde Supabase cuando el contador confirma una distribución de
// dividendos (ver reglas de negocio en schema.sql, sección 8.1).
// -----------------------------------------------------------------------

// Todo el archivo va adentro de esta función para que sus variables
// (formatearFechaISO, obtenerPeriodoVigente, etc.) queden "encerradas" acá
// y no choquen con las de otras pantallas que importan las mismas
// funciones desde calendario-logica.js (en un <script> clásico, sin esto,
// dos archivos no pueden declarar el mismo "const" en el nivel superior).
(function () {

const supabaseCalendario = require('./js/supabaseClient.js');
const {
  formatearFechaISO,
  calcularFechaVencimiento,
  obtenerPeriodoVigente,
} = require('./js/calendario-logica.js');

const elTablaCalendarioBody = document.getElementById('tabla-calendario-body');
const elSinVencimientos = document.getElementById('sin-vencimientos');
const elCalendarioMensaje = document.getElementById('calendario-mensaje');

// Revisa, para cada obligación que el contador le asignó a cada cliente
// (tabla cliente_obligaciones, configurada desde la pantalla de Clientes),
// si corresponde generar automáticamente el vencimiento del período
// vigente. Las obligaciones "manual" (IDU) nunca se generan solas, aunque
// estén asignadas al cliente.
async function asegurarVencimientosDelPeriodoVigente() {
  const [
    { data: clientes, error: errorClientes },
    { data: clienteObligaciones, error: errorClienteObligaciones },
    { data: feriados, error: errorFeriados },
  ] = await Promise.all([
    supabaseCalendario.from('clientes').select('id, terminacion_ruc, cierre_fiscal_mes'),
    supabaseCalendario.from('cliente_obligaciones').select('cliente_id, obligaciones(id, codigo, periodicidad)'),
    supabaseCalendario.from('feriados').select('fecha'),
  ]);

  if (errorClientes) throw errorClientes;
  if (errorClienteObligaciones) throw errorClienteObligaciones;
  if (errorFeriados) throw errorFeriados;

  const feriadosSet = new Set((feriados || []).map((f) => f.fecha));
  const clientesPorId = new Map((clientes || []).map((c) => [c.id, c]));
  const registrosACrear = [];

  for (const fila of clienteObligaciones || []) {
    const cliente = clientesPorId.get(fila.cliente_id);
    const obligacion = fila.obligaciones;

    if (!cliente || !obligacion) continue;
    if (obligacion.periodicidad === 'manual') continue;
    // Si el cliente todavía no tiene cargada la terminación de RUC, no
    // podemos calcular su día de vencimiento: lo saltamos por ahora.
    if (cliente.terminacion_ruc === null || cliente.terminacion_ruc === undefined) continue;

    const cierreFiscalMes = cliente.cierre_fiscal_mes ?? 12;
    const periodoAncla = obtenerPeriodoVigente(obligacion.periodicidad, cierreFiscalMes);

    const fechaVencimiento = calcularFechaVencimiento({
      codigoObligacion: obligacion.codigo,
      periodicidad: obligacion.periodicidad,
      terminacionRuc: cliente.terminacion_ruc,
      periodoAncla,
      feriadosSet,
      cierreFiscalMes,
    });

    if (!fechaVencimiento) continue;

    registrosACrear.push({
      cliente_id: cliente.id,
      obligacion_id: obligacion.id,
      periodo: formatearFechaISO(periodoAncla),
      fecha_vencimiento: formatearFechaISO(fechaVencimiento),
      generado_manual: false,
    });
  }

  if (registrosACrear.length === 0) return;

  // "upsert" con ignoreDuplicates: si ya existe un registro para ese
  // cliente + obligación + período (ver unique constraint en la tabla),
  // lo deja tal cual está; si no existe, lo crea. Así nunca pisamos un
  // vencimiento que ya se había calculado antes.
  const { error: errorUpsert } = await supabaseCalendario
    .from('calendario_vencimientos')
    .upsert(registrosACrear, {
      onConflict: 'cliente_id,obligacion_id,periodo',
      ignoreDuplicates: true,
    });

  if (errorUpsert) throw errorUpsert;
}

async function cargarCalendario() {
  if (!supabaseCalendario) return;

  try {
    await asegurarVencimientosDelPeriodoVigente();

    const { data, error } = await supabaseCalendario
      .from('calendario_vencimientos')
      .select('fecha_vencimiento, periodo, clientes(razon_social), obligaciones(periodicidad)')
      .order('fecha_vencimiento', { ascending: true });

    if (error) throw error;

    dibujarTablaCalendario(data || []);
  } catch (error) {
    console.error('Error al cargar el calendario:', error);
    if (elCalendarioMensaje) {
      elCalendarioMensaje.textContent = 'No se pudo generar/cargar el calendario de vencimientos.';
      elCalendarioMensaje.classList.remove('oculto');
    }
  }
}

function dibujarTablaCalendario(filas) {
  elTablaCalendarioBody.innerHTML = '';

  if (filas.length === 0) {
    elSinVencimientos.classList.remove('oculto');
    return;
  }
  elSinVencimientos.classList.add('oculto');

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  for (const fila of filas) {
    const tr = document.createElement('tr');
    const fechaVencimiento = new Date(`${fila.fecha_vencimiento}T00:00:00`);
    const estaVencido = fechaVencimiento < hoy;

    tr.innerHTML = `
      <td>${escaparHtmlCalendario(fila.clientes?.razon_social)}</td>
      <td>${formatearPeriodoVisible(fila.periodo, fila.obligaciones?.periodicidad)}</td>
      <td class="${estaVencido ? 'fecha-vencida' : ''}">${formatearFechaVisible(fila.fecha_vencimiento)}</td>
    `;

    elTablaCalendarioBody.appendChild(tr);
  }
}

function formatearFechaVisible(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}/${anio}`;
}

const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatearPeriodoVisible(periodoISO, periodicidad) {
  const [anio, mes] = periodoISO.split('-');
  if (periodicidad === 'mensual') {
    return `${NOMBRES_MES[Number(mes) - 1]} ${anio}`;
  }
  return anio;
}

function escaparHtmlCalendario(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarCalendario = cargarCalendario;

cargarCalendario();

})();
