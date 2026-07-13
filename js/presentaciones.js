// js/presentaciones.js
// -----------------------------------------------------------------------
// Pantalla principal de la app. Reemplaza también a la antigua pestaña
// Calendario (eliminada): para cada cliente se muestran, juntas, TODAS las
// obligaciones que tiene asignadas (tabla cliente_obligaciones) que estén
// vigentes y todavía NO presentadas -- mensuales y anuales por igual, cada
// una con su fecha real de vencimiento (una anual sigue apareciendo como
// pendiente desde que arranca su ejercicio en enero hasta que se marca
// presentada, aunque su vencimiento real sea marzo/abril).
//
// Los clientes se agrupan por terminación de RUC ("VENCIMIENTO N - FECHA
// D", el día fijo por terminación -- no cambia entre obligaciones) igual
// que la planilla de control que usaba el estudio antes de esta app.
// Dentro de cada grupo, un bloque por cliente (Nombre/RUC/Clave una sola
// vez) con la lista de sus obligaciones pendientes debajo, cada una con su
// nombre + fecha de vencimiento y su propio checkbox de "Presentado".
//
// El selector "Ver cartera de" (Yo / cada perfil / Todos) filtra los
// clientes mostrados por `clientes.responsable_id`; es solo un filtro de
// visualización, no de acceso (cualquiera puede ver y marcar presentado
// clientes de cualquier responsable).
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
const elGrupos = document.getElementById('presentaciones-grupos');
const elSinPresentaciones = document.getElementById('sin-presentaciones');
const elPresentacionesMensaje = document.getElementById('presentaciones-mensaje');

// Valores especiales del selector "Ver cartera de" (los perfiles puntuales
// usan directamente su uuid como value).
const VALOR_CARTERA_YO = 'yo';
const VALOR_CARTERA_TODOS = 'todos';

// Catálogo de obligaciones automáticas (todas menos "manual" = IDU), ya
// filtrado según el panel RG 90 de Configuración.
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
// corre para TODAS las obligaciones de cada cliente, no depende de ningún
// filtro de esta pantalla.
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

// --- Catálogo de obligaciones (para calcular vencimientos, ya no hay filtro) --

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

    // Arma, por cliente, la lista de sus obligaciones pendientes (vigentes
    // y todavía no presentadas), con nombre y fecha real de vencimiento de
    // cada una -- puede haber obligaciones mensuales y anuales mezcladas,
    // cada una con su propia fecha.
    const pendientesPorCliente = new Map();

    for (const fila of clienteObligaciones || []) {
      const cliente = clientesPorId.get(fila.cliente_id);
      const obligacion = fila.obligaciones;

      if (!cliente || !obligacion) continue;
      if (!idsObligacionesPermitidas.has(obligacion.id)) continue;
      // Sin terminación de RUC no podemos calcular el día de vencimiento.
      if (cliente.terminacion_ruc === null || cliente.terminacion_ruc === undefined) continue;

      const cierreFiscalMes = cliente.cierre_fiscal_mes ?? 12;
      const periodoAncla = obtenerPeriodoVigente(obligacion.periodicidad, cierreFiscalMes);
      const periodoISO = formatearFechaISO(periodoAncla);

      const clave = `${cliente.id}-${obligacion.id}-${periodoISO}`;
      if (presentadosSet.has(clave)) continue; // ya presentado: no se muestra

      const fechaVencimiento = calcularFechaVencimiento({
        codigoObligacion: obligacion.codigo,
        periodicidad: obligacion.periodicidad,
        terminacionRuc: cliente.terminacion_ruc,
        periodoAncla,
        feriadosSet,
        cierreFiscalMes,
      });
      if (!fechaVencimiento) continue;

      if (!pendientesPorCliente.has(cliente.id)) {
        pendientesPorCliente.set(cliente.id, { cliente, obligaciones: [] });
      }
      pendientesPorCliente.get(cliente.id).obligaciones.push({
        obligacionId: obligacion.id,
        nombre: obligacion.nombre,
        periodo: periodoISO,
        fechaVencimiento,
      });
    }

    // Dentro de cada bloque de cliente, la obligación con vencimiento más
    // próximo aparece primero.
    for (const entrada of pendientesPorCliente.values()) {
      entrada.obligaciones.sort((a, b) => a.fechaVencimiento - b.fechaVencimiento);
    }

    dibujarGrupos([...pendientesPorCliente.values()]);
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
// N - FECHA D") y dibuja un bloque por cliente dentro de cada grupo, en
// orden alfabético; la numeración es correlativa sin cortes entre grupos.
function dibujarGrupos(entradas) {
  elGrupos.innerHTML = '';

  if (entradas.length === 0) {
    elSinPresentaciones.classList.remove('oculto');
    return;
  }
  elSinPresentaciones.classList.add('oculto');

  const porTerminacion = new Map();
  for (const entrada of entradas) {
    const terminacion = entrada.cliente.terminacion_ruc;
    if (terminacion === null || terminacion === undefined) continue;
    if (!porTerminacion.has(terminacion)) porTerminacion.set(terminacion, []);
    porTerminacion.get(terminacion).push(entrada);
  }

  const terminacionesOrdenadas = [...porTerminacion.keys()].sort((a, b) => a - b);
  let numero = 0;

  for (const terminacion of terminacionesOrdenadas) {
    const entradasDelGrupo = porTerminacion.get(terminacion)
      .sort((a, b) => a.cliente.razon_social.localeCompare(b.cliente.razon_social));

    const grupo = document.createElement('div');
    grupo.className = 'grupo-vencimiento';

    const encabezado = document.createElement('h3');
    encabezado.className = 'grupo-vencimiento-titulo';
    encabezado.textContent = `VENCIMIENTO ${terminacion} - FECHA ${DIA_POR_TERMINACION_RUC[terminacion]}`;
    grupo.appendChild(encabezado);

    const lista = document.createElement('div');
    lista.className = 'lista-clientes-presentaciones';

    for (const entrada of entradasDelGrupo) {
      numero += 1;
      lista.appendChild(construirBloqueCliente(numero, entrada));
    }

    grupo.appendChild(lista);
    elGrupos.appendChild(grupo);
  }
}

// Un solo bloque por cliente: Nombre/RUC/Clave una sola vez arriba, y
// debajo la lista de sus obligaciones pendientes, cada una con su nombre +
// fecha de vencimiento y su propio checkbox de "Presentado".
function construirBloqueCliente(numero, { cliente, obligaciones }) {
  const bloque = document.createElement('article');
  bloque.className = 'cliente-presentacion';

  const encabezado = document.createElement('div');
  encabezado.className = 'cliente-presentacion-encabezado';
  encabezado.innerHTML = `
    <span class="cliente-presentacion-numero">${numero}</span>
    <div class="cliente-presentacion-datos">
      <button class="boton-link" data-editar-cliente="${cliente.id}">${escaparHtmlPresentaciones(cliente.razon_social)}</button>
      <span class="cliente-presentacion-detalle">RUC: ${escaparHtmlPresentaciones(cliente.ruc)} &middot; Clave: ${escaparHtmlPresentaciones(cliente.clave_marangatu)}</span>
    </div>
  `;
  bloque.appendChild(encabezado);

  const lista = document.createElement('ul');
  lista.className = 'lista-obligaciones-pendientes';

  for (const obligacion of obligaciones) {
    const li = document.createElement('li');
    li.className = 'obligacion-pendiente';
    li.innerHTML = `
      <div class="obligacion-pendiente-info">
        <span class="obligacion-pendiente-nombre">${escaparHtmlPresentaciones(obligacion.nombre)}</span>
        <span class="obligacion-pendiente-fecha">Vence ${formatearFechaVisiblePresentaciones(obligacion.fechaVencimiento)}</span>
      </div>
      <label class="obligacion-pendiente-check">
        <input
          type="checkbox"
          data-cliente-id="${cliente.id}"
          data-obligacion-id="${obligacion.obligacionId}"
          data-periodo="${obligacion.periodo}"
        />
        Presentado
      </label>
    `;
    lista.appendChild(li);
  }

  bloque.appendChild(lista);
  return bloque;
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
    // Al marcar presentada, la obligación deja de ser "pendiente" y
    // desaparece del bloque del cliente -- repintamos toda la lista.
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
