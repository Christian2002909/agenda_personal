// js/obligaciones.js
// -----------------------------------------------------------------------
// Esta pantalla es de SOLO LECTURA: el catálogo de obligaciones (IVA, IRE
// SIMPLE, IRE GENERAL, ESTADO FINANCIERO, IDU) ya viene precargado en
// Supabase (ver schema.sql) y no se edita desde la app. Acá solo lo
// mostramos, y de paso lo usamos como referencia visual para las fases
// que vienen (Calendario, Presentaciones).
// -----------------------------------------------------------------------

// Todo el archivo va adentro de esta función para que sus variables no
// choquen con las de otras pantallas (en un <script> clásico, sin esto,
// dos archivos no pueden declarar el mismo "const" en el nivel superior).
(function () {

const supabaseObligaciones = require('./js/supabaseClient.js');

const elTablaObligacionesBody = document.getElementById('tabla-obligaciones-body');

// Traduce el valor guardado en la base (mensual/anual/manual) a un texto
// más claro para quien use la app.
const ETIQUETAS_PERIODICIDAD = {
  mensual: 'Mensual',
  anual: 'Anual',
  manual: 'Manual (solo cuando corresponde)',
};

async function cargarObligaciones() {
  if (!supabaseObligaciones) {
    // Si falta configurar Supabase, simplemente no mostramos nada acá;
    // el aviso principal ya se muestra desde la pantalla de Clientes.
    return;
  }

  try {
    const { data, error } = await supabaseObligaciones
      .from('obligaciones')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;

    dibujarTablaObligaciones(data || []);
  } catch (error) {
    console.error('Error al cargar obligaciones:', error);
  }
}

function dibujarTablaObligaciones(obligaciones) {
  elTablaObligacionesBody.innerHTML = '';

  for (const obligacion of obligaciones) {
    const fila = document.createElement('tr');
    const etiqueta = ETIQUETAS_PERIODICIDAD[obligacion.periodicidad] || obligacion.periodicidad;

    fila.innerHTML = `
      <td>${obligacion.codigo}</td>
      <td>${obligacion.nombre}</td>
      <td>${etiqueta}</td>
    `;

    elTablaObligacionesBody.appendChild(fila);
  }
}

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarObligaciones = cargarObligaciones;

cargarObligaciones();

})();
