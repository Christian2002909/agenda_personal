// js/presentaciones.js
// -----------------------------------------------------------------------
// Pantalla principal de la app. Reemplaza también a la antigua pestaña
// Calendario (eliminada): para cada cliente se muestra, en una TABLA
// compacta, el estado del período VIGENTE de las obligaciones de UN grupo
// elegido en el selector "Obligación" -- una fila por cliente, una columna
// por obligación del grupo.
//
// El selector "Obligación" NO ofrece una obligación por opción ni una
// opción "Todas": son 5 GRUPOS fijos (confirmado explícitamente por el
// usuario, ver GRUPOS_OBLIGACION más abajo), cada uno con su propia lista
// de columnas -- porque en la práctica varias obligaciones se presentan
// siempre juntas para el mismo cliente:
//   - IVA         -> IVA + RG 90 Mensual
//   - IRE Simple  -> IRE Simple sola
//   - IRE General -> IRE General + Estado Financiero + IDU
//   - IRP-RSP     -> IRP-RSP + RG 90 Anual
//   - IRP-RGC     -> IRP-RGC sola (los clientes de este régimen siempre
//                    tienen IVA también, así que RG 90 Anual no les
//                    correspondería nunca, ver regla siguiente)
// RG 90 Anual es un caso especial: un cliente que tiene IVA asignado NUNCA
// la ve (en su lugar ya tiene RG 90 Mensual en el grupo IVA) -- la columna
// se calcula por cliente, no por grupo entero, aunque esté en la lista de
// columnas de IRP-RSP.
//
// IDU (periodicidad "manual" en el catálogo) es distinto al resto: nunca
// tiene una fecha de vencimiento calculable (no hay regla de "N meses
// después del cierre" para ella) ni se pre-genera sola -- se confirma a
// mano cuando el contador determina que corresponde. Su celda muestra un
// checkbox sin fecha ("según corresponda") en vez de una fecha calculada.
//
// El selector arranca en IVA (primer grupo) y no recuerda haber mostrado
// "todo junto" -- cada grupo que tiene algo anual (o IDU) muestra, al lado
// de su nombre en el selector, la cantidad de pendientes entre paréntesis
// (ej. "IRE General (4)"), para que sin entrar se sepa cuánto falta
// confirmar; el número no aparece si está en cero.
//
// Los clientes se agrupan por terminación de RUC ("VENCIMIENTO N - FECHA
// D", el día fijo por terminación -- no cambia entre obligaciones) igual
// que la planilla de control que usaba el estudio antes de esta app. Un
// cliente solo aparece si tiene asignada al menos una obligación del grupo
// elegido.
//
// El selector "Ver cartera de" (Yo / cada perfil / Todos) filtra los
// clientes mostrados por `clientes.responsable_id`; es solo un filtro de
// visualización, no de acceso (cualquiera puede ver y marcar presentado
// clientes de cualquier responsable). Se aplica primero, y sobre esos
// clientes se arma la tabla y se cuentan los pendientes de cada grupo.
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

// Los 5 grupos fijos del selector "Obligación" -- ver comentario de
// cabecera. `codigos` son los `obligaciones.codigo` (catálogo) que arma
// las columnas de ese grupo, en el orden en que se muestran.
const GRUPOS_OBLIGACION = [
  { id: 'IVA', label: 'IVA', codigos: ['IVA', 'RG90_MENSUAL'] },
  { id: 'IRE_SIMPLE', label: 'IRE Simple', codigos: ['IRE_SIMPLE'] },
  { id: 'IRE_GENERAL', label: 'IRE General', codigos: ['IRE_GENERAL', 'ESTADO_FINANCIERO', 'IDU'] },
  { id: 'IRP_RSP', label: 'IRP-RSP', codigos: ['IRP_RSP', 'RG90_ANUAL'] },
  { id: 'IRP_RGC', label: 'IRP-RGC', codigos: ['IRP_RGC'] },
];

// Catálogo completo de obligaciones (incluye IDU, a diferencia del diseño
// anterior -- acá sí hace falta para armar la columna de IDU dentro del
// grupo IRE General), ya filtrado según el panel RG 90 de Configuración
// (saca RG90_MENSUAL/RG90_ANUAL del catálogo si el panel está apagado, lo
// que automáticamente las saca también de las columnas de los grupos que
// las usan).
let obligacionesCache = [];
// Perfiles (tabla `perfiles`), para armar las opciones del selector de cartera.
let perfilesCache = [];
// uuid del usuario logueado (auth.users.id vía supabase.auth.getSession()),
// usado para la opción "Yo". null si no se pudo determinar.
let usuarioActualId = null;

// Crea (si todavía no existe) el registro "pendiente" del período vigente
// para cada obligación que el contador le asignó a cada cliente (tabla
// cliente_obligaciones, configurada desde la pantalla de Clientes). IDU
// (periodicidad "manual") queda afuera a propósito -- no se pre-genera,
// se crea recién cuando se tilda su checkbox por primera vez (ver el
// listener de "change" más abajo, que hace upsert genérico para cualquier
// obligación). Si el registro ya existe -sea pendiente o ya presentado-,
// no lo toca.
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

// --- Catálogo de obligaciones (columnas de cada grupo) --------------------

async function cargarCatalogoObligaciones() {
  const [{ data, error }, { data: configuracion, error: errorConfiguracion }] = await Promise.all([
    supabasePresentaciones.from('obligaciones').select('*').order('id'),
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

// Arma las 5 opciones fijas del selector "Obligación" una sola vez (no
// dependen del catálogo cargado: siempre están las 5, lo que varía según
// el panel RG 90 son las columnas/conteos de cada una). Si ya estaban
// pobladas (se volvió a esta pestaña), no las vuelve a crear -- así no se
// pierde la selección actual.
function poblarFiltroObligacion() {
  if (!elFiltroObligacion) return;
  if (elFiltroObligacion.options.length > 0) return;

  for (const grupo of GRUPOS_OBLIGACION) {
    const opcion = document.createElement('option');
    opcion.value = grupo.id;
    opcion.textContent = grupo.label;
    elFiltroObligacion.appendChild(opcion);
  }
  elFiltroObligacion.value = GRUPOS_OBLIGACION[0].id;
}

// Actualiza el texto de cada opción del selector con la cantidad de
// pendientes de ese grupo entre paréntesis (solo si es mayor a cero), sin
// tocar cuál está seleccionada.
function actualizarContadoresFiltroObligacion(conteosPendientesPorGrupo) {
  if (!elFiltroObligacion) return;
  for (const opcion of elFiltroObligacion.options) {
    const grupo = GRUPOS_OBLIGACION.find((g) => g.id === opcion.value);
    if (!grupo) continue;
    const pendientes = conteosPendientesPorGrupo.get(grupo.id) || 0;
    opcion.textContent = pendientes > 0 ? `${grupo.label} (${pendientes})` : grupo.label;
  }
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
// La opción "Yo" muestra el nombre real del usuario logueado (si ya tiene
// perfil) en vez del texto literal "Yo", y ese mismo perfil se excluye del
// resto de la lista para no mostrarlo dos veces (una como "Yo" y otra con
// su propio nombre).
function poblarFiltroCartera() {
  if (!elFiltroCartera) return;

  const seleccionActual = elFiltroCartera.value;
  elFiltroCartera.innerHTML = '';

  const perfilPropio = perfilesCache.find((perfil) => perfil.id === usuarioActualId);

  const opcionYo = document.createElement('option');
  opcionYo.value = VALOR_CARTERA_YO;
  opcionYo.textContent = perfilPropio ? perfilPropio.nombre : 'Yo';
  elFiltroCartera.appendChild(opcionYo);

  for (const perfil of perfilesCache) {
    if (perfil.id === usuarioActualId) continue;
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

// Calcula la celda de UNA obligación puntual para UN cliente: null si no
// aplica (no asignada, o -caso especial RG 90 Anual- el cliente tiene IVA
// asignado y por lo tanto ya se le muestra RG 90 Mensual en el grupo IVA
// en su lugar). Para IDU (periodicidad "manual") no hay fecha de
// vencimiento calculable -- queda en null a propósito, la celda lo
// resuelve mostrando "según corresponda" en vez de una fecha.
function calcularCeldaParaCliente(cliente, obligacion, codigosAsignados, feriadosSet, presentadosSet) {
  if (!codigosAsignados.has(obligacion.codigo)) return null;
  if (obligacion.codigo === 'RG90_ANUAL' && codigosAsignados.has('IVA')) return null;

  const cierreFiscalMes = cliente.cierre_fiscal_mes ?? 12;
  const periodicidadParaAncla = obligacion.periodicidad === 'manual' ? 'anual' : obligacion.periodicidad;
  const periodoAncla = obtenerPeriodoVigente(periodicidadParaAncla, cierreFiscalMes);
  const periodoISO = formatearFechaISO(periodoAncla);

  let fechaVencimiento = null;
  if (obligacion.periodicidad !== 'manual') {
    fechaVencimiento = calcularFechaVencimiento({
      codigoObligacion: obligacion.codigo,
      periodicidad: obligacion.periodicidad,
      terminacionRuc: cliente.terminacion_ruc,
      periodoAncla,
      feriadosSet,
      cierreFiscalMes,
    });
    if (!fechaVencimiento) return null;
  }

  const clave = `${cliente.id}-${obligacion.id}-${periodoISO}`;
  return {
    periodo: periodoISO,
    fechaVencimiento,
    presentado: presentadosSet.has(clave),
  };
}

async function dibujarPresentaciones() {
  try {
    const grupoSeleccionadoId = elFiltroObligacion?.value || GRUPOS_OBLIGACION[0].id;
    const grupoSeleccionado = GRUPOS_OBLIGACION.find((g) => g.id === grupoSeleccionadoId) || GRUPOS_OBLIGACION[0];

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
    const obligacionesPorCodigo = new Map(obligacionesCache.map((o) => [o.codigo, o]));

    // Por cliente, el conjunto de CÓDIGOS de obligación que tiene asignados
    // en cliente_obligaciones (todas, sin filtrar por grupo ni por panel
    // RG 90 acá -- esos filtros ya los aplica obligacionesPorCodigo al
    // armar las columnas de cada grupo, y la regla especial de RG 90 Anual
    // necesita saber si el cliente tiene IVA sin importar en qué grupo se
    // esté mostrando la tabla).
    const codigosAsignadosPorCliente = new Map();
    for (const fila of clienteObligaciones || []) {
      const cliente = clientesPorId.get(fila.cliente_id);
      const obligacion = fila.obligaciones;
      if (!cliente || !obligacion) continue;

      if (!codigosAsignadosPorCliente.has(cliente.id)) {
        codigosAsignadosPorCliente.set(cliente.id, new Set());
      }
      codigosAsignadosPorCliente.get(cliente.id).add(obligacion.codigo);
    }

    // Conteo de pendientes por grupo, para los contadores del selector --
    // solo para los grupos que tienen algún componente anual o manual
    // (IDU): las mensuales puras (IVA) no llevan aviso, ya se ven siempre.
    const conteosPendientesPorGrupo = new Map();
    for (const grupo of GRUPOS_OBLIGACION) {
      const columnasDelGrupo = grupo.codigos.map((c) => obligacionesPorCodigo.get(c)).filter(Boolean);
      const tieneComponenteAnualOManual = columnasDelGrupo.some((o) => o.periodicidad !== 'mensual');
      if (!tieneComponenteAnualOManual) continue;

      let pendientes = 0;
      for (const cliente of clientesFiltrados) {
        if (cliente.terminacion_ruc === null || cliente.terminacion_ruc === undefined) continue;
        const codigosAsignados = codigosAsignadosPorCliente.get(cliente.id);
        if (!codigosAsignados) continue;

        for (const obligacion of columnasDelGrupo) {
          const info = calcularCeldaParaCliente(cliente, obligacion, codigosAsignados, feriadosSet, presentadosSet);
          if (info && !info.presentado) pendientes += 1;
        }
      }
      conteosPendientesPorGrupo.set(grupo.id, pendientes);
    }
    actualizarContadoresFiltroObligacion(conteosPendientesPorGrupo);

    // Filas de la tabla: solo las columnas del grupo elegido.
    const columnas = grupoSeleccionado.codigos.map((c) => obligacionesPorCodigo.get(c)).filter(Boolean);

    const filas = [];
    for (const cliente of clientesFiltrados) {
      if (cliente.terminacion_ruc === null || cliente.terminacion_ruc === undefined) continue;
      const codigosAsignados = codigosAsignadosPorCliente.get(cliente.id);
      if (!codigosAsignados || codigosAsignados.size === 0) continue;

      const celdas = new Map();
      for (const obligacion of columnas) {
        const info = calcularCeldaParaCliente(cliente, obligacion, codigosAsignados, feriadosSet, presentadosSet);
        if (info) celdas.set(obligacion.id, info);
      }

      if (celdas.size === 0) continue;
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
// cliente y las columnas del grupo de obligación elegido (compartidas por
// toda la pantalla), en orden alfabético; la numeración es correlativa sin
// cortes entre grupos.
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
// mostrando la fecha de vencimiento del período vigente -- tanto si
// todavía está pendiente como si ya se presentó. IDU no tiene fecha
// calculable (fechaVencimiento llega en null): se muestra "según
// corresponda" en vez de una fecha, ya que se confirma a mano.
function construirCeldaObligacionHtml({ clienteId, obligacionId, periodo, presentado, fechaVencimiento }) {
  const estadoClase = presentado ? 'celda-historial-presentado' : 'celda-historial-pendiente';
  const fechaTexto = fechaVencimiento ? formatearFechaVisiblePresentaciones(fechaVencimiento) : 'según corresponda';
  const titulo = presentado
    ? `Presentado${fechaVencimiento ? ` (venció ${fechaTexto})` : ''}`
    : `Pendiente${fechaVencimiento ? `, vence ${fechaTexto}` : ' de confirmar'}`;
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
// todavía -- incluida la primera vez que se tilda un IDU, que nunca se
// pre-genera (ver asegurarPresentacionesDelPeriodoVigente).
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
    // color de fondo de la celda + contador del selector).
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
