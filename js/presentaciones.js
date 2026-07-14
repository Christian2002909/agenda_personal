// js/presentaciones.js
// -----------------------------------------------------------------------
// Pantalla principal de la app. Reemplaza también a la antigua pestaña
// Calendario (eliminada): para cada cliente se muestra, en una TABLA
// compacta, el estado del período VIGENTE de cada obligación que tiene
// asignada (tabla cliente_obligaciones) -- mensuales y anuales por igual.
//
// A diferencia del diseño anterior (un bloque por cliente con checkboxes
// apilados, que solo mostraba lo pendiente y en el que el cliente
// desaparecía apenas se presentaba todo), ahora es una tabla de verdad:
// una fila por cliente, una columna por obligación, y las filas/celdas
// NUNCA desaparecen mientras la obligación siga asignada -- el checkbox
// de la celda simplemente refleja si el período vigente ya se presentó o
// no (con su fecha de vencimiento visible), y cuando el período cambia
// (nuevo mes/año) la celda vuelve a mostrarse pendiente automáticamente.
//
// Las columnas de obligación son "automáticas" por defecto: la unión de
// todas las obligaciones (mensuales y anuales) que tengan asignadas los
// clientes que se están mostrando. Un selector adicional ("Obligación")
// permite acotar la tabla a una sola obligación puntual, mismo patrón que
// ya usa el filtro de Historial (js/historial.js). La obligación IDU
// (periodicidad "manual") nunca es columna, ni automática ni seleccionable
// a mano -- igual que antes.
//
// Los clientes se agrupan por terminación de RUC ("VENCIMIENTO N - FECHA
// D", el día fijo por terminación -- no cambia entre obligaciones) igual
// que la planilla de control que usaba el estudio antes de esta app.
//
// El selector "Ver cartera de" (Yo / cada perfil / Todos) filtra los
// clientes mostrados por `clientes.responsable_id`; es solo un filtro de
// visualización, no de acceso (cualquiera puede ver y marcar presentado
// clientes de cualquier responsable). Se aplica primero, y sobre esos
// clientes se arma la tabla.
// -----------------------------------------------------------------------

// Todo el archivo va adentro de esta función para que sus variables no
// choquen con las de otras pantallas que importan las mismas funciones
// desde calendario-logica.js.
(function () {

const supabasePresentaciones = require('./js/supabaseClient.js');
const {
  formatearFechaISO,
  calcularFechaVencimiento,
  obtenerPeriodoVigente,
  DIA_POR_TERMINACION_RUC,
} = require('./js/calendario-logica.js');

const elFiltroCartera = document.getElementById('presentaciones-filtro-cartera');
const elFiltroObligacion = document.getElementById('presentaciones-filtro-obligacion');
const elGrupos = document.getElementById('presentaciones-grupos');
const elSinPresentaciones = document.getElementById('sin-presentaciones');
const elPresentacionesMensaje = document.getElementById('presentaciones-mensaje');

// Valores especiales del selector "Ver cartera de" (los perfiles puntuales
// usan directamente su uuid como value).
const VALOR_CARTERA_YO = 'yo';
const VALOR_CARTERA_TODOS = 'todos';

// Catálogo de obligaciones automáticas (todas menos "manual" = IDU), ya
// filtrado según el panel RG 90 de Configuración. Es también el universo
// de opciones del selector "Obligación" (más la opción "Todas").
let obligacionesCache = [];
// Perfiles (tabla `perfiles`), para armar las opciones del selector de cartera.
let perfilesCache = [];
// uuid del usuario logueado (auth.users.id vía supabase.auth.getSession()),
// usado para la opción "Yo". null si no se pudo determinar.
let usuarioActualId = null;

// Crea (si todavía no existe) el registro "pendiente" del período vigente
// para cada obligación que el contador le asignó a cada cliente (tabla
// cliente_obligaciones, configurada desde la pantalla de Clientes). Las
// obligaciones "manual" (IDU) quedan afuera, aunque estén asignadas. Si el
// registro ya existe -sea pendiente o ya presentado-, no lo toca. Esto
// corre para TODAS las obligaciones de cada cliente (no solo las que la
// tabla vaya a mostrar según el selector de "Obligación"), porque la fila
// tiene que existir de antemano para que el checkbox de la celda pueda
// tildarla sin fallar.
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

// --- Catálogo de obligaciones (columnas automáticas + selector manual) ---

async function cargarCatalogoObligaciones() {
  const [{ data, error }, { data: configuracion, error: errorConfiguracion }] = await Promise.all([
    supabasePresentaciones.from('obligaciones').select('*').neq('periodicidad', 'manual').order('id'),
    supabasePresentaciones.from('configuracion_estudio').select('panel_rg90_visible').eq('id', 1).maybeSingle(),
  ]);

  if (error) throw error;

  // Si falló la lectura de configuración, no ocultamos nada por un error
  // transitorio de una tabla que no es la esencial de esta pantalla.
  const panelRg90Visible = errorConfiguracion ? true : (configuracion?.panel_rg90_visible ?? true);

  obligacionesCache = panelRg90Visible
    ? (data || [])
    : (data || []).filter((o) => o.codigo !== 'RG90_MENSUAL' && o.codigo !== 'RG90_ANUAL');
}

// Arma las opciones del selector manual "Obligación": "Todas" (comportamiento
// automático de columnas, ver dibujarPresentaciones) + una por obligación del
// catálogo -- mismo patrón que ya usa el filtro de Historial, pero con esta
// opción extra por defecto en vez de arrancar en IVA.
function poblarFiltroObligacion() {
  if (!elFiltroObligacion) return;

  const seleccionActual = elFiltroObligacion.value;
  elFiltroObligacion.innerHTML = '';

  const opcionTodas = document.createElement('option');
  opcionTodas.value = '';
  opcionTodas.textContent = 'Todas';
  elFiltroObligacion.appendChild(opcionTodas);

  for (const obligacion of obligacionesCache) {
    const opcion = document.createElement('option');
    opcion.value = obligacion.id;
    opcion.textContent = obligacion.nombre;
    elFiltroObligacion.appendChild(opcion);
  }

  const sigueExistiendo = [...elFiltroObligacion.options].some((o) => o.value === seleccionActual);
  elFiltroObligacion.value = sigueExistiendo ? seleccionActual : '';
}

if (elFiltroObligacion) elFiltroObligacion.addEventListener('change', () => dibujarPresentaciones());

// --- Usuario logueado y catálogo de perfiles, para "Ver cartera de" -------

async function cargarUsuarioActual() {
  try {
    const { data, error } = await supabasePresentaciones.auth.getSession();
    if (error) throw error;
    usuarioActualId = data?.session?.user?.id ?? null;
  } catch (error) {
    console.error('Error al obtener el usuario logueado:', error);
    usuarioActualId = null;
  }
}

async function cargarPerfiles() {
  const { data, error } = await supabasePresentaciones.from('perfiles').select('id, nombre').order('nombre');
  if (error) throw error;
  perfilesCache = (data || []).filter((perfil) => perfil.nombre);
}

// Arma las opciones "Yo" / cada perfil / "Todos". Si ya había una selección
// (por ejemplo, se volvió a esta pestaña), la respetamos; si es la primera
// vez que se arma el selector, arranca en "Yo" (confirmado por el usuario).
function poblarFiltroCartera() {
  if (!elFiltroCartera) return;

  const seleccionActual = elFiltroCartera.value;
  elFiltroCartera.innerHTML = '';

  const opcionYo = document.createElement('option');
  opcionYo.value = VALOR_CARTERA_YO;
  opcionYo.textContent = 'Yo';
  elFiltroCartera.appendChild(opcionYo);

  for (const perfil of perfilesCache) {
    const opcion = document.createElement('option');
    opcion.value = perfil.id;
    opcion.textContent = perfil.nombre;
    elFiltroCartera.appendChild(opcion);
  }

  const opcionTodos = document.createElement('option');
  opcionTodos.value = VALOR_CARTERA_TODOS;
  opcionTodos.textContent = 'Todos';
  elFiltroCartera.appendChild(opcionTodos);

  const sigueExistiendo = [...elFiltroCartera.options].some((o) => o.value === seleccionActual);
  elFiltroCartera.value = sigueExistiendo ? seleccionActual : VALOR_CARTERA_YO;
}

if (elFiltroCartera) elFiltroCartera.addEventListener('change', () => dibujarPresentaciones());

// Clientes con responsable_id NULL (los que no tenían un match exacto en el
// backfill, ver schema.sql sección 15.1): no se les puede atribuir a nadie
// en particular, así que solo aparecen en "Todos" -- ni en la vista "Yo" de
// quien sea que esté logueado, ni en la de ningún perfil puntual.
function filtrarClientesPorCartera(clientes) {
  const seleccion = elFiltroCartera?.value || VALOR_CARTERA_YO;

  if (seleccion === VALOR_CARTERA_TODOS) return clientes;

  if (seleccion === VALOR_CARTERA_YO) {
    if (!usuarioActualId) return [];
    return clientes.filter((c) => c.responsable_id === usuarioActualId);
  }

  // Un perfil puntual elegido del selector (value = uuid del perfil).
  return clientes.filter((c) => c.responsable_id === seleccion);
}

// --- Cargar y mostrar ----------------------------------------------------

async function cargarPresentaciones() {
  if (!supabasePresentaciones) return;

  try {
    await Promise.all([cargarCatalogoObligaciones(), cargarUsuarioActual(), cargarPerfiles()]);
    poblarFiltroCartera();
    poblarFiltroObligacion();
    await asegurarPresentacionesDelPeriodoVigente();
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
  try {
    const idsObligacionesPermitidas = new Set(obligacionesCache.map((o) => o.id));
    // Selector manual de una sola obligación: '' (opción "Todas") vuelve al
    // comportamiento automático de columnas; con un id puntual, la tabla se
    // acota a esa única obligación.
    const obligacionSeleccionadaId = elFiltroObligacion?.value ? Number(elFiltroObligacion.value) : null;

    const [
      { data: clientes, error: errorClientes },
      { data: clienteObligaciones, error: errorClienteObligaciones },
      { data: presentados, error: errorPresentados },
      { data: feriados, error: errorFeriados },
    ] = await Promise.all([
      supabasePresentaciones
        .from('clientes')
        .select('id, razon_social, ruc, clave_marangatu, terminacion_ruc, cierre_fiscal_mes, responsable_id'),
      supabasePresentaciones
        .from('cliente_obligaciones')
        .select('cliente_id, obligacion_id, obligaciones(id, codigo, nombre, periodicidad)'),
      supabasePresentaciones
        .from('presentaciones')
        .select('cliente_id, obligacion_id, periodo')
        .eq('estado', 'presentado'),
      supabasePresentaciones.from('feriados').select('fecha'),
    ]);

    if (errorClientes) throw errorClientes;
    if (errorClienteObligaciones) throw errorClienteObligaciones;
    if (errorPresentados) throw errorPresentados;
    if (errorFeriados) throw errorFeriados;

    const feriadosSet = new Set((feriados || []).map((f) => f.fecha));
    const presentadosSet = new Set(
      (presentados || []).map((p) => `${p.cliente_id}-${p.obligacion_id}-${p.periodo}`)
    );

    const clientesFiltrados = filtrarClientesPorCartera(clientes || []);
    const clientesPorId = new Map(clientesFiltrados.map((c) => [c.id, c]));

    // Por cliente, el conjunto de obligaciones "relevantes ahora": todas
    // las que tenga asignadas en cliente_obligaciones, no sean "manual"
    // (IDU) y pasen el filtro del panel RG 90 -- mensuales y anuales por
    // igual. Para las anuales, obtenerPeriodoVigente(cierreFiscalMes) (ver
    // más abajo, donde se calcula el período de cada celda) siempre
    // devuelve el ejercicio que ya cerró más recientemente para ESE
    // cliente -- nunca uno futuro, y el ancla pasa de un ejercicio al
    // siguiente exactamente el mes posterior a cierreFiscalMes -- así que
    // "estar asignada" ya alcanza para que la columna sea relevante los 12
    // meses del año, sin un chequeo de mes aparte y sin hardcodear enero:
    // con cierre en diciembre da "relevante todo el año" (el ejemplo del
    // usuario, que arrancaba en enero), con cierre en junio da el mismo
    // resultado corriendo el año fiscal, todo calculado por esa función.
    // Si hay una obligación puntual elegida en el selector manual, se
    // descarta cualquier otra.
    const obligacionesAsignadasPorCliente = new Map();
    for (const fila of clienteObligaciones || []) {
      const cliente = clientesPorId.get(fila.cliente_id);
      const obligacion = fila.obligaciones;

      if (!cliente || !obligacion) continue;
      if (!idsObligacionesPermitidas.has(obligacion.id)) continue;
      if (obligacionSeleccionadaId !== null && obligacion.id !== obligacionSeleccionadaId) continue;

      if (!obligacionesAsignadasPorCliente.has(cliente.id)) {
        obligacionesAsignadasPorCliente.set(cliente.id, new Set());
      }
      obligacionesAsignadasPorCliente.get(cliente.id).add(obligacion.id);
    }

    // Columnas = unión de las obligaciones relevantes de todos los clientes
    // que se van a mostrar, en el mismo orden que el catálogo (obligacionesCache
    // ya viene ordenado por id).
    const idsColumnas = new Set();
    for (const asignadas of obligacionesAsignadasPorCliente.values()) {
      for (const id of asignadas) idsColumnas.add(id);
    }
    const columnas = obligacionesCache.filter((o) => idsColumnas.has(o.id));

    // Una fila por cliente (con terminación de RUC cargada y al menos una
    // obligación relevante); para cada columna, la celda queda en `null`
    // si esa obligación puntual no está asignada a este cliente (celda
    // "no aplica").
    const filas = [];
    for (const cliente of clientesFiltrados) {
      if (cliente.terminacion_ruc === null || cliente.terminacion_ruc === undefined) continue;

      const asignadas = obligacionesAsignadasPorCliente.get(cliente.id);
      if (!asignadas || asignadas.size === 0) continue;

      const cierreFiscalMes = cliente.cierre_fiscal_mes ?? 12;
      const celdas = new Map();

      for (const obligacion of columnas) {
        if (!asignadas.has(obligacion.id)) {
          celdas.set(obligacion.id, null);
          continue;
        }

        const periodoAncla = obtenerPeriodoVigente(obligacion.periodicidad, cierreFiscalMes);
        const periodoISO = formatearFechaISO(periodoAncla);
        const fechaVencimiento = calcularFechaVencimiento({
          codigoObligacion: obligacion.codigo,
          periodicidad: obligacion.periodicidad,
          terminacionRuc: cliente.terminacion_ruc,
          periodoAncla,
          feriadosSet,
          cierreFiscalMes,
        });

        if (!fechaVencimiento) {
          celdas.set(obligacion.id, null);
          continue;
        }

        const clave = `${cliente.id}-${obligacion.id}-${periodoISO}`;
        celdas.set(obligacion.id, {
          periodo: periodoISO,
          fechaVencimiento,
          presentado: presentadosSet.has(clave),
        });
      }

      filas.push({ cliente, celdas });
    }

    dibujarGrupos(filas, columnas);
    // La carga salió bien: si había quedado pegado un cartel de error de
    // un intento anterior (por ejemplo, el primero antes de loguearse),
    // lo ocultamos.
    if (elPresentacionesMensaje) elPresentacionesMensaje.classList.add('oculto');
  } catch (error) {
    console.error('Error al mostrar presentaciones:', error);
    if (elPresentacionesMensaje) {
      elPresentacionesMensaje.textContent = 'No se pudieron cargar las presentaciones.';
      elPresentacionesMensaje.classList.remove('oculto');
    }
  }
}

// Agrupa por terminación de RUC (como la planilla de control: "VENCIMIENTO
// N - FECHA D") y dibuja, dentro de cada grupo, una tabla con una fila por
// cliente y una columna por obligación (compartidas por todo el grupo), en
// orden alfabético; la numeración es correlativa sin cortes entre grupos.
function dibujarGrupos(filas, columnas) {
  elGrupos.innerHTML = '';

  if (filas.length === 0 || columnas.length === 0) {
    elSinPresentaciones.classList.remove('oculto');
    return;
  }
  elSinPresentaciones.classList.add('oculto');

  const porTerminacion = new Map();
  for (const fila of filas) {
    const terminacion = fila.cliente.terminacion_ruc;
    if (!porTerminacion.has(terminacion)) porTerminacion.set(terminacion, []);
    porTerminacion.get(terminacion).push(fila);
  }

  const terminacionesOrdenadas = [...porTerminacion.keys()].sort((a, b) => a - b);
  let numero = 0;

  for (const terminacion of terminacionesOrdenadas) {
    const filasDelGrupo = porTerminacion.get(terminacion)
      .sort((a, b) => a.cliente.razon_social.localeCompare(b.cliente.razon_social));

    const grupo = document.createElement('div');
    grupo.className = 'grupo-vencimiento';

    const encabezado = document.createElement('h3');
    encabezado.className = 'grupo-vencimiento-titulo';
    encabezado.textContent = `VENCIMIENTO ${terminacion} - FECHA ${DIA_POR_TERMINACION_RUC[terminacion]}`;
    grupo.appendChild(encabezado);

    const tabla = document.createElement('table');
    tabla.className = 'tabla-clientes tabla-presentaciones';
    tabla.innerHTML = `
      <thead>
        <tr>
          <th>#</th>
          <th>Cliente</th>
          <th>RUC</th>
          <th>Clave</th>
          ${columnas.map((o) => `<th>${escaparHtmlPresentaciones(o.nombre)}</th>`).join('')}
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = tabla.querySelector('tbody');

    for (const fila of filasDelGrupo) {
      numero += 1;
      tbody.appendChild(construirFilaCliente(numero, fila, columnas));
    }

    grupo.appendChild(tabla);

    // Envuelta en .tabla-scroll (mismo contenedor que usa Honorarios) para
    // que, con varias columnas de obligación, la tabla scrollee
    // horizontalmente en vez de desbordar la tarjeta en ventanas angostas.
    const contenedorScroll = document.createElement('div');
    contenedorScroll.className = 'tabla-scroll';
    contenedorScroll.appendChild(tabla);
    grupo.appendChild(contenedorScroll);

    elGrupos.appendChild(grupo);
  }
}

// Una fila de la tabla: datos del cliente + una celda por columna de
// obligación (checkbox editable si está asignada, "—" si no aplica).
function construirFilaCliente(numero, { cliente, celdas }, columnas) {
  const tr = document.createElement('tr');

  const celdasHtml = columnas.map((obligacion) => {
    const info = celdas.get(obligacion.id);
    if (!info) return '<td class="celda-obligacion-na">—</td>';
    return construirCeldaObligacionHtml({
      clienteId: cliente.id,
      obligacionId: obligacion.id,
      periodo: info.periodo,
      presentado: info.presentado,
      fechaVencimiento: info.fechaVencimiento,
    });
  }).join('');

  tr.innerHTML = `
    <td>${numero}</td>
    <td><button class="boton-link" data-editar-cliente="${cliente.id}">${escaparHtmlPresentaciones(cliente.razon_social)}</button></td>
    <td>${escaparHtmlPresentaciones(cliente.ruc)}</td>
    <td>${escaparHtmlPresentaciones(cliente.clave_marangatu)}</td>
    ${celdasHtml}
  `;

  return tr;
}

// Celda editable de una obligación: todo el área de la celda es un <label>
// que envuelve el checkbox de "presentado" (mismo patrón que ya usa la
// grilla de Historial, celda-historial-toggle/-presentado/-pendiente),
// mostrando siempre la fecha de vencimiento del período vigente -- tanto
// si todavía está pendiente como si ya se presentó.
function construirCeldaObligacionHtml({ clienteId, obligacionId, periodo, presentado, fechaVencimiento }) {
  const estadoClase = presentado ? 'celda-historial-presentado' : 'celda-historial-pendiente';
  const fechaTexto = formatearFechaVisiblePresentaciones(fechaVencimiento);
  const titulo = presentado ? `Presentado (venció ${fechaTexto})` : `Pendiente, vence ${fechaTexto}`;
  return `
    <td class="celda-historial ${estadoClase}">
      <label class="celda-historial-toggle" title="${escaparHtmlPresentaciones(titulo)}">
        <input
          type="checkbox"
          data-cliente-id="${clienteId}"
          data-obligacion-id="${obligacionId}"
          data-periodo="${periodo}"
          ${presentado ? 'checked' : ''}
        />
        <span>${fechaTexto}</span>
      </label>
    </td>
  `;
}

function formatearFechaVisiblePresentaciones(fecha) {
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

// Usamos "upsert" (misma constraint única cliente_id+obligacion_id+periodo
// que ya usa asegurarPresentacionesDelPeriodoVigente/Historial) en vez de
// "update por id": el checkbox ya no conoce el id de la fila de
// `presentaciones` (dejó de pedirse en la consulta), y esto además cubre
// el caso borde de una fila que por algún motivo no se haya generado
// todavía.
elGrupos.addEventListener('change', async (evento) => {
  const checkbox = evento.target.closest('input[type="checkbox"][data-cliente-id]');
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
    const { error } = await supabasePresentaciones
      .from('presentaciones')
      .upsert(
        [{ cliente_id: clienteId, obligacion_id: obligacionId, periodo, ...cambios }],
        { onConflict: 'cliente_id,obligacion_id,periodo' }
      );

    if (error) throw error;
    // La fila/celda del cliente sigue en pantalla tanto si se tildó como
    // si se destildó (a diferencia del diseño anterior, acá nada
    // desaparece) -- repintamos para reflejar el nuevo estado (checkbox +
    // color de fondo de la celda).
    await dibujarPresentaciones();
  } catch (error) {
    console.error('Error al actualizar presentación:', error);
    checkbox.checked = !marcarComoPresentado; // revertimos el check visualmente
    checkbox.disabled = false;
    if (elPresentacionesMensaje) {
      elPresentacionesMensaje.textContent = 'No se pudo guardar el cambio. Intentá de nuevo.';
      elPresentacionesMensaje.classList.remove('oculto');
    }
  }
});

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarPresentaciones = cargarPresentaciones;

cargarPresentaciones();

})();
