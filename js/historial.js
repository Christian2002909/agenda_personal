// js/historial.js
// -----------------------------------------------------------------------
// Pantalla de Historial: muestra TODO lo que ya se presentó (no solo el
// período vigente, como en la pantalla de Presentaciones), ordenado por
// fecha en que se marcó, del más reciente al más antiguo. No se agrupa
// por mes ni por cliente: es una lista cronológica simple.
// -----------------------------------------------------------------------

(function () {

const supabaseHistorial = require('./js/supabaseClient.js');

const elTablaHistorialBody = document.getElementById('tabla-historial-body');
const elSinHistorial = document.getElementById('sin-historial');

const NOMBRES_MES_HISTORIAL = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

async function cargarHistorial() {
  if (!supabaseHistorial) return;

  try {
    const { data, error } = await supabaseHistorial
      .from('presentaciones')
      .select('periodo, fecha_presentacion, clientes(razon_social), obligaciones(nombre, periodicidad)')
      .eq('estado', 'presentado')
      .order('fecha_presentacion', { ascending: false });

    if (error) throw error;

    dibujarTablaHistorial(data || []);
  } catch (error) {
    console.error('Error al cargar el historial:', error);
  }
}

function dibujarTablaHistorial(filas) {
  elTablaHistorialBody.innerHTML = '';

  if (filas.length === 0) {
    elSinHistorial.classList.remove('oculto');
    return;
  }
  elSinHistorial.classList.add('oculto');

  for (const fila of filas) {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${escaparHtmlHistorial(fila.clientes?.razon_social)}</td>
      <td>${escaparHtmlHistorial(fila.obligaciones?.nombre)}</td>
      <td>${formatearPeriodoHistorial(fila.periodo, fila.obligaciones?.periodicidad)}</td>
      <td>${formatearFechaHoraHistorial(fila.fecha_presentacion)}</td>
    `;

    elTablaHistorialBody.appendChild(tr);
  }
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

function formatearPeriodoHistorial(periodoISO, periodicidad) {
  const [anio, mes] = periodoISO.split('-');
  if (periodicidad === 'mensual') {
    return `${NOMBRES_MES_HISTORIAL[Number(mes) - 1]} ${anio}`;
  }
  return anio;
}

function escaparHtmlHistorial(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarHistorial = cargarHistorial;

cargarHistorial();

})();
