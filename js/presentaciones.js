// js/presentaciones.js
// -----------------------------------------------------------------------
// Pantalla de Presentaciones: un checkbox por cada Cliente + Obligación +
// Período vigente. Al tildarlo, se guarda como "presentado" con la fecha
// en que se marcó. Cuando cambia el período (nuevo mes/año), esta misma
// pantalla genera un registro NUEVO en estado "pendiente" para el período
// nuevo -- el historial de períodos viejos queda intacto, nunca se toca
// ni se borra (eso se ve en la pantalla de Historial, Fase 5).
// -----------------------------------------------------------------------

// Todo el archivo va adentro de esta función para que sus variables no
// choquen con las de otras pantallas que importan las mismas funciones
// desde calendario-logica.js (ver la misma nota en calendario.js).
(function () {

const supabasePresentaciones = require('./js/supabaseClient.js');
const { formatearFechaISO, obtenerPeriodoVigente } = require('./js/calendario-logica.js');

const elTablaPresentacionesBody = document.getElementById('tabla-presentaciones-body');
const elSinPresentaciones = document.getElementById('sin-presentaciones');
const elPresentacionesMensaje = document.getElementById('presentaciones-mensaje');

// Crea (si todavía no existe) el registro "pendiente" del período vigente
// para cada cliente + obligación automática. Si ya existe -sea pendiente
// o ya presentado-, no lo toca.
async function asegurarPresentacionesDelPeriodoVigente() {
  const [
    { data: clientes, error: errorClientes },
    { data: obligaciones, error: errorObligaciones },
  ] = await Promise.all([
    supabasePresentaciones.from('clientes').select('id, cierre_fiscal_mes'),
    supabasePresentaciones.from('obligaciones').select('*').neq('periodicidad', 'manual'),
  ]);

  if (errorClientes) throw errorClientes;
  if (errorObligaciones) throw errorObligaciones;

  const registrosACrear = [];

  for (const cliente of clientes || []) {
    const cierreFiscalMes = cliente.cierre_fiscal_mes ?? 12;

    for (const obligacion of obligaciones || []) {
      const periodoAncla = obtenerPeriodoVigente(obligacion.periodicidad, cierreFiscalMes);

      registrosACrear.push({
        cliente_id: cliente.id,
        obligacion_id: obligacion.id,
        periodo: formatearFechaISO(periodoAncla),
        // No mandamos estado/fecha_presentacion: usan los valores por
        // defecto de la tabla ('pendiente' y null). Si el registro ya
        // existía como "presentado", el upsert de abajo no lo pisa.
      });
    }
  }

  if (registrosACrear.length === 0) return;

  const { error } = await supabasePresentaciones
    .from('presentaciones')
    .upsert(registrosACrear, {
      onConflict: 'cliente_id,obligacion_id,periodo',
      ignoreDuplicates: true,
    });

  if (error) throw error;
}

async function cargarPresentaciones() {
  if (!supabasePresentaciones) return;

  try {
    await asegurarPresentacionesDelPeriodoVigente();

    const { data, error } = await supabasePresentaciones
      .from('presentaciones')
      .select('id, periodo, estado, fecha_presentacion, clientes(razon_social, cierre_fiscal_mes), obligaciones(nombre, periodicidad)');

    if (error) throw error;

    // Esta pantalla solo muestra el período VIGENTE de cada obligación.
    // Los períodos anteriores (ya presentados o no) se ven en Historial.
    const vigentes = (data || []).filter((fila) => {
      const cierreFiscalMes = fila.clientes?.cierre_fiscal_mes ?? 12;
      const periodoVigenteISO = formatearFechaISO(obtenerPeriodoVigente(fila.obligaciones?.periodicidad, cierreFiscalMes));
      return fila.periodo === periodoVigenteISO;
    });

    vigentes.sort((a, b) => (a.clientes?.razon_social ?? '').localeCompare(b.clientes?.razon_social ?? ''));

    dibujarTablaPresentaciones(vigentes);
  } catch (error) {
    console.error('Error al cargar presentaciones:', error);
    if (elPresentacionesMensaje) {
      elPresentacionesMensaje.textContent = 'No se pudieron cargar las presentaciones.';
      elPresentacionesMensaje.classList.remove('oculto');
    }
  }
}

function dibujarTablaPresentaciones(filas) {
  elTablaPresentacionesBody.innerHTML = '';

  if (filas.length === 0) {
    elSinPresentaciones.classList.remove('oculto');
    return;
  }
  elSinPresentaciones.classList.add('oculto');

  for (const fila of filas) {
    const tr = document.createElement('tr');
    const marcado = fila.estado === 'presentado';

    tr.innerHTML = `
      <td>${escaparHtmlPresentaciones(fila.clientes?.razon_social)}</td>
      <td>${escaparHtmlPresentaciones(fila.obligaciones?.nombre)}</td>
      <td>${formatearPeriodoPresentaciones(fila.periodo, fila.obligaciones?.periodicidad)}</td>
      <td class="celda-checkbox"><input type="checkbox" data-id="${fila.id}" ${marcado ? 'checked' : ''} /></td>
      <td>${fila.fecha_presentacion ? formatearFechaVisiblePresentaciones(fila.fecha_presentacion) : '—'}</td>
    `;

    elTablaPresentacionesBody.appendChild(tr);
  }
}

function formatearFechaVisiblePresentaciones(fechaISOConHora) {
  const fecha = new Date(fechaISOConHora);
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const anio = fecha.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

const NOMBRES_MES_PRESENTACIONES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatearPeriodoPresentaciones(periodoISO, periodicidad) {
  const [anio, mes] = periodoISO.split('-');
  if (periodicidad === 'mensual') {
    return `${NOMBRES_MES_PRESENTACIONES[Number(mes) - 1]} ${anio}`;
  }
  return anio;
}

function escaparHtmlPresentaciones(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// --- Marcar / desmarcar un checkbox ------------------------------------

elTablaPresentacionesBody.addEventListener('change', async (evento) => {
  const checkbox = evento.target.closest('input[type="checkbox"]');
  if (!checkbox) return;

  const marcarComoPresentado = checkbox.checked;

  const cambios = marcarComoPresentado
    ? { estado: 'presentado', fecha_presentacion: new Date().toISOString() }
    : { estado: 'pendiente', fecha_presentacion: null };

  checkbox.disabled = true;

  try {
    const { error } = await supabasePresentaciones
      .from('presentaciones')
      .update(cambios)
      .eq('id', checkbox.dataset.id);

    if (error) throw error;
    await cargarPresentaciones();
  } catch (error) {
    console.error('Error al actualizar presentación:', error);
    checkbox.checked = !marcarComoPresentado; // revertimos el check visualmente
    if (elPresentacionesMensaje) {
      elPresentacionesMensaje.textContent = 'No se pudo guardar el cambio. Intentá de nuevo.';
      elPresentacionesMensaje.classList.remove('oculto');
    }
    checkbox.disabled = false;
  }
});

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarPresentaciones = cargarPresentaciones;

cargarPresentaciones();

})();
