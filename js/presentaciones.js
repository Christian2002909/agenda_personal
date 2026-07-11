// js/presentaciones.js
// -----------------------------------------------------------------------
// Pantalla principal de la app. Muestra, para la obligación elegida en el
// filtro (arranca en IVA), todos los clientes que la tienen asignada,
// agrupados por "VENCIMIENTO N - FECHA D" según la terminación de su RUC
// -- igual que la planilla de control que usaba el estudio antes de esta
// app. Un checkbox por cliente marca "Presentado" con fecha automática.
//
// Al cambiar de período (nuevo mes/año), esta misma pantalla genera un
// registro NUEVO en estado "pendiente" para el período nuevo -- el
// historial de períodos viejos queda intacto, nunca se toca ni se borra
// (eso se ve en la pantalla de Historial).
// -----------------------------------------------------------------------

// Todo el archivo va adentro de esta función para que sus variables no
// choquen con las de otras pantallas que importan las mismas funciones
// desde calendario-logica.js (ver la misma nota en calendario.js).
(function () {

const supabasePresentaciones = require('./js/supabaseClient.js');
const {
  formatearFechaISO,
  obtenerPeriodoVigente,
  DIA_POR_TERMINACION_RUC,
} = require('./js/calendario-logica.js');

const elFiltroObligacion = document.getElementById('presentaciones-filtro-obligacion');
const elGrupos = document.getElementById('presentaciones-grupos');
const elSinPresentaciones = document.getElementById('sin-presentaciones');
const elPresentacionesMensaje = document.getElementById('presentaciones-mensaje');

const NOMBRES_MES_PRESENTACIONES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Catálogo de obligaciones para armar el filtro (sin IDU: no se presenta
// en un cronograma, se carga a mano cuando corresponde).
let obligacionesCache = [];

// Crea (si todavía no existe) el registro "pendiente" del período vigente
// para cada obligación que el contador le asignó a cada cliente (tabla
// cliente_obligaciones, configurada desde la pantalla de Clientes). Las
// obligaciones "manual" (IDU) quedan afuera, aunque estén asignadas. Si el
// registro ya existe -sea pendiente o ya presentado-, no lo toca.
async function asegurarPresentacionesDelPeriodoVigente() {
  const [
    { data: clientes, error: errorClientes },
    { data: clienteObligaciones, error: errorClienteObligaciones },
  ] = await Promise.all([
    supabasePresentaciones.from('clientes').select('id, cierre_fiscal_mes'),
    supabasePresentaciones.from('cliente_obligaciones').select('cliente_id, obligaciones(id, periodicidad)'),
  ]);

  if (errorClientes) throw errorClientes;
  if (errorClienteObligaciones) throw errorClienteObligaciones;

  const clientesPorId = new Map((clientes || []).map((c) => [c.id, c]));
  const registrosACrear = [];

  for (const fila of clienteObligaciones || []) {
    const cliente = clientesPorId.get(fila.cliente_id);
    const obligacion = fila.obligaciones;

    if (!cliente || !obligacion) continue;
    if (obligacion.periodicidad === 'manual') continue;

    const cierreFiscalMes = cliente.cierre_fiscal_mes ?? 12;
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

  if (registrosACrear.length === 0) return;

  const { error } = await supabasePresentaciones
    .from('presentaciones')
    .upsert(registrosACrear, {
      onConflict: 'cliente_id,obligacion_id,periodo',
      ignoreDuplicates: true,
    });

  if (error) throw error;
}

// --- Filtro por obligación ---------------------------------------------

async function cargarCatalogoObligaciones() {
  const { data, error } = await supabasePresentaciones
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
    // Primera carga: arranca siempre en IVA.
    const iva = obligacionesCache.find((o) => o.codigo === 'IVA');
    if (iva) elFiltroObligacion.value = iva.id;
  }
}

elFiltroObligacion.addEventListener('change', () => dibujarPresentaciones());

// --- Cargar y mostrar ----------------------------------------------------

async function cargarPresentaciones() {
  if (!supabasePresentaciones) return;

  try {
    await Promise.all([cargarCatalogoObligaciones(), asegurarPresentacionesDelPeriodoVigente()]);
    await dibujarPresentaciones();
  } catch (error) {
    console.error('Error al cargar presentaciones:', error);
    if (elPresentacionesMensaje) {
      elPresentacionesMensaje.textContent = 'No se pudieron cargar las presentaciones.';
      elPresentacionesMensaje.classList.remove('oculto');
    }
  }
}

async function dibujarPresentaciones() {
  const obligacionId = Number(elFiltroObligacion.value);
  const obligacion = obligacionesCache.find((o) => o.id === obligacionId);
  if (!obligacion) return;

  try {
    const { data, error } = await supabasePresentaciones
      .from('presentaciones')
      .select('id, periodo, estado, fecha_presentacion, clientes(id, razon_social, ruc, clave_marangatu, terminacion_ruc, cierre_fiscal_mes)')
      .eq('obligacion_id', obligacionId);

    if (error) throw error;

    // Esta pantalla solo muestra el período VIGENTE de la obligación
    // elegida. Los períodos anteriores (ya presentados o no) se ven en
    // Historial.
    const vigentes = (data || []).filter((fila) => {
      const cierreFiscalMes = fila.clientes?.cierre_fiscal_mes ?? 12;
      const periodoVigenteISO = formatearFechaISO(obtenerPeriodoVigente(obligacion.periodicidad, cierreFiscalMes));
      return fila.periodo === periodoVigenteISO && fila.clientes;
    });

    dibujarGrupos(vigentes);
  } catch (error) {
    console.error('Error al mostrar presentaciones:', error);
    if (elPresentacionesMensaje) {
      elPresentacionesMensaje.textContent = 'No se pudieron cargar las presentaciones.';
      elPresentacionesMensaje.classList.remove('oculto');
    }
  }
}

// Agrupa por terminación de RUC (como la planilla de control: "VENCIMIENTO
// N - FECHA D") y dibuja una mini-tabla por grupo, en orden de fecha.
function dibujarGrupos(filas) {
  elGrupos.innerHTML = '';

  if (filas.length === 0) {
    elSinPresentaciones.classList.remove('oculto');
    return;
  }
  elSinPresentaciones.classList.add('oculto');

  const porTerminacion = new Map();
  for (const fila of filas) {
    const terminacion = fila.clientes.terminacion_ruc;
    if (terminacion === null || terminacion === undefined) continue;
    if (!porTerminacion.has(terminacion)) porTerminacion.set(terminacion, []);
    porTerminacion.get(terminacion).push(fila);
  }

  const terminacionesOrdenadas = [...porTerminacion.keys()].sort((a, b) => a - b);
  let numero = 0;

  for (const terminacion of terminacionesOrdenadas) {
    const filasDelGrupo = porTerminacion.get(terminacion)
      .sort((a, b) => a.clientes.razon_social.localeCompare(b.clientes.razon_social));

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
          <th>N°</th>
          <th>Nombre Completo</th>
          <th>RUC</th>
          <th>Clave</th>
          <th>Presentado</th>
          <th>Fecha</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = tabla.querySelector('tbody');

    for (const fila of filasDelGrupo) {
      numero += 1;
      const marcado = fila.estado === 'presentado';
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${numero}</td>
        <td><button class="boton-link" data-editar-cliente="${fila.clientes.id}">${escaparHtmlPresentaciones(fila.clientes.razon_social)}</button></td>
        <td>${escaparHtmlPresentaciones(fila.clientes.ruc)}</td>
        <td>${escaparHtmlPresentaciones(fila.clientes.clave_marangatu)}</td>
        <td class="celda-checkbox"><input type="checkbox" data-id="${fila.id}" ${marcado ? 'checked' : ''} /></td>
        <td>${fila.fecha_presentacion ? formatearFechaVisiblePresentaciones(fila.fecha_presentacion) : '—'}</td>
      `;

      tbody.appendChild(tr);
    }

    grupo.appendChild(tabla);
    elGrupos.appendChild(grupo);
  }
}

function formatearFechaVisiblePresentaciones(fechaISOConHora) {
  const fecha = new Date(fechaISOConHora);
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const anio = fecha.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

function escaparHtmlPresentaciones(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// --- Marcar / desmarcar un checkbox, o abrir un cliente para editar -------

elGrupos.addEventListener('click', (evento) => {
  const botonEditar = evento.target.closest('button[data-editar-cliente]');
  if (botonEditar && typeof window.editarClienteDesdeOtraVista === 'function') {
    window.editarClienteDesdeOtraVista(Number(botonEditar.dataset.editarCliente));
  }
});

elGrupos.addEventListener('change', async (evento) => {
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
    await dibujarPresentaciones();
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
