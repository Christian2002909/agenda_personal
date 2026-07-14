// js/honorarios.js
// -----------------------------------------------------------------------
// Pantalla de Honorarios. Muestra el estado de cada cliente (Al día/Debe),
// permite registrar y corregir pagos, editar la cuota pactada, ver el
// detalle de pagos de un cliente y generar la ficha de pago descargable
// (PDF vía window.print()).
//
// "Al día" / "Debe" acumula TODA la deuda desde que se configuró el
// honorario de ese cliente (honorarios.created_at), por separado para la
// cuota mensual y la anual (un cliente puede tener las dos a la vez):
// cuenta cuántos períodos pasaron hasta el período vigente inclusive,
// multiplica por el monto pactado de esa cuota, y le resta la suma de los
// pagos históricos de esa misma cuota (tipo_honorario). El estado general
// es "Debe" si cualquiera de las dos cuotas tiene saldo pendiente.
//
// "Congelar deuda" (tabla deudas_congeladas_honorarios): permite diferir
// -sin perdonar- una deuda vieja de un cliente+tipo para que dicho estado
// corriente deje de mostrar "Debe" apenas el cliente vuelve a pagar
// puntual. Mientras un cliente+tipo tenga una deuda congelada pendiente
// (pagada = false), calcularSaldoPorTipo arranca a contar períodos desde
// el momento en que se congeló (created_at de esa fila) en vez de desde
// honorarios.created_at -- "como si el honorario arrancara de cero" para
// el cálculo corriente, sin tocar el created_at real. El monto congelado
// en sí no se resta de nada: se muestra aparte, con un badge distinto al
// de "Debe", hasta que se marca "pagada" (no genera un pago en
// pagos_honorarios, ver comentario en schema.sql).
//
// "Otros gastos" (tabla otros_gastos_honorarios): cargos sueltos por vez
// (un trámite puntual, un gasto adelantado, etc.), completamente
// INDEPENDIENTES de la cuota mensual/anual -- a propósito NO participan de
// calcularSaldoPorTipo/calcularEstadoHonorario, tienen su propio badge
// aparte ("Otros gastos pendientes: Gs. X") y su propio botón/panel. Se
// cargan con descripción + monto + fecha del cargo, y se marcan pagados
// con su propio mini-formulario (fecha de pago, forma de pago, N° de
// recibo opcional -- mismos campos que pagos_honorarios, reusando ese
// patrón).
//
// Esta pantalla es 100% manual: no tiene ningún botón de Excel (importar,
// exportar ni plantillas). El Excel de Clientes (js/clientes.js) es el
// único lugar con Excel de esta app -- su Hoja 2 "Honorarios" permite
// cargar cuota mensual/anual, deuda congelada y un otro gasto por cliente
// en una carga masiva inicial; a partir de ahí todo se gestiona acá, a
// mano.
//
// Registrar un pago, editar la cuota pactada y ver el detalle de un
// cliente se hacen todos expandiendo una fila-formulario debajo de la fila
// del cliente en la tabla principal (mismo espíritu que el checkbox
// "Presentado" de Presentaciones/Calendario, pero acá el check despliega
// un mini-formulario en vez de guardar directo). Un pago ya cargado
// también se puede corregir desde la tabla de Historial de Pagos (o desde
// el detalle de un cliente), reemplazando esa fila por el mismo
// mini-formulario, precargado, que guarda con UPDATE en vez de INSERT.
//
// El selector "Ver cartera de" (Yo / cada perfil / Todos) filtra los
// clientes de la tabla principal y de la sección de cuota anual por
// `clientes.responsable_id` -- mismo patrón que ya usa
// js/presentaciones.js. Se aplica ANTES que la búsqueda por nombre/RUC (el
// buscador filtra sobre el resultado de la cartera elegida, no al revés);
// es solo un filtro de visualización, no de acceso.
// -----------------------------------------------------------------------

(function () {

const supabaseHonorarios = require('./js/supabaseClient.js');
const { formatearFechaISO, obtenerPeriodoVigente } = require('./js/calendario-logica.js');
const { formatearConPuntos, quitarPuntos } = require('./js/formato-numeros.js');

const elHonorariosMensaje = document.getElementById('honorarios-mensaje');
const elHonorariosBuscar = document.getElementById('honorarios-buscar');
const elFiltroCartera = document.getElementById('honorarios-filtro-cartera');

const elTablaHonorariosBody = document.getElementById('tabla-honorarios-body');
const elSinHonorarios = document.getElementById('sin-honorarios');

const elSeccionHonorariosAnual = document.getElementById('seccion-honorarios-anual');
const elTablaHonorariosAnualBody = document.getElementById('tabla-honorarios-anual-body');

const elPagosFiltroAnio = document.getElementById('pagos-filtro-anio');
const elPagosFiltroMes = document.getElementById('pagos-filtro-mes');
const elTablaPagosBody = document.getElementById('tabla-pagos-body');
const elSinPagos = document.getElementById('sin-pagos');

const elFichaImprimir = document.getElementById('ficha-pago-imprimir');
const elFichaContenido = document.getElementById('ficha-pago-contenido');
const elBtnFichaImprimir = document.getElementById('btn-ficha-imprimir');
const elBtnFichaCerrar = document.getElementById('btn-ficha-cerrar');

// Cantidad de columnas de cualquier tabla que muestre filas de pago
// (Historial de Pagos y el detalle de un cliente comparten exactamente las
// mismas columnas -- ver construirFilaPagoHtml), usada para el colspan del
// formulario de edición en línea.
const PAGO_COLSPAN = 8;

const NOMBRES_MES_COMPLETOS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Versión abreviada, usada en el badge de "Deuda congelada" (ej. "dic.
// 2026") para que no ocupe tanto espacio como la fecha completa dd/mm/aaaa.
const MESES_ABREVIADOS = [
  'ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.',
  'jul.', 'ago.', 'set.', 'oct.', 'nov.', 'dic.',
];

const ETIQUETAS_FORMA_PAGO = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
};

// Valores especiales del selector "Ver cartera de" (los perfiles puntuales
// usan directamente su uuid como value) -- mismas constantes que ya usa
// js/presentaciones.js para el mismo selector.
const VALOR_CARTERA_YO = 'yo';
const VALOR_CARTERA_TODOS = 'todos';

// Guardamos en memoria lo último cargado, para no volver a pedirlo cada
// vez que se busca un cliente o se calcula un estado.
let clientesCacheHonorarios = [];
let honorariosCache = [];
let pagosCache = [];
// Deudas congeladas (tabla deudas_congeladas_honorarios): deuda vieja de
// un cliente+tipo, diferida sin perdonarse -- ver contarPeriodosAdeudables
// y dibujarBadgesDeudaCongelada más abajo.
let deudasCongeladasCache = [];
// Otros gastos (tabla otros_gastos_honorarios): cargos sueltos por vez,
// independientes de la cuota -- ver dibujarBadgeOtrosGastos más abajo.
let otrosGastosCache = [];
let configuracionEstudio = null;
// Perfiles (tabla `perfiles`), para armar las opciones del selector de cartera.
let perfilesCache = [];
// uuid del usuario logueado (auth.users.id vía supabase.auth.getSession()),
// usado para la opción "Yo". null si no se pudo determinar.
let usuarioActualId = null;

function mostrarMensajeHonorarios(texto, tipo = 'exito') {
  if (!elHonorariosMensaje) return;
  elHonorariosMensaje.textContent = texto;
  elHonorariosMensaje.className = `mensaje mensaje-${tipo}`;
  elHonorariosMensaje.classList.remove('oculto');
  setTimeout(() => elHonorariosMensaje.classList.add('oculto'), 4000);
}

function formatearGuaranies(monto) {
  return `Gs. ${Number(monto).toLocaleString('es-PY')}`;
}

function formatearFechaVisibleHonorarios(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}/${anio}`;
}

// "dic. 2026" -- usado en el badge de "Deuda congelada" para la fecha de
// acuerdo (fecha_acuerdo es un date "yyyy-mm-dd", sin hora).
function formatearMesAnioCorto(fechaISO) {
  const [anio, mes] = fechaISO.split('-');
  return `${MESES_ABREVIADOS[Number(mes) - 1]} ${anio}`;
}

function formatearFormaPago(formaPago) {
  return ETIQUETAS_FORMA_PAGO[formaPago] || formaPago;
}

function escaparHtmlHonorarios(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// Reformatea un input de dinero (campo-pago-monto, campo-cuota-mensual,
// campo-cuota-anual) con el punto separador de miles EN VIVO mientras se
// escribe, tratando de mantener el cursor en una posición razonable (se
// cuentan los dígitos antes del cursor y se lo recoloca después de esa
// misma cantidad de dígitos en el texto ya formateado -- no hace falta que
// sea perfecto, solo que no sea molesto de usar). El valor "real" (sin
// puntos) se recupera con quitarPuntos() recién al guardar.
function formatearInputDineroEnVivo(elInput) {
  const posicionCursor = elInput.selectionStart ?? elInput.value.length;
  const digitosAntesDelCursor = quitarPuntos(elInput.value.slice(0, posicionCursor)).length;

  elInput.value = formatearConPuntos(elInput.value);

  let digitosVistos = 0;
  let nuevaPosicion = elInput.value.length;
  for (let i = 0; i < elInput.value.length; i += 1) {
    if (/\d/.test(elInput.value[i])) digitosVistos += 1;
    if (digitosVistos === digitosAntesDelCursor) {
      nuevaPosicion = i + 1;
      break;
    }
  }
  if (digitosAntesDelCursor === 0) nuevaPosicion = 0;
  elInput.setSelectionRange(nuevaPosicion, nuevaPosicion);
}

// Enero es el único mes en que la cuota ANUAL todavía no cuenta como
// adeudada (regla confirmada por el usuario, ver contarPeriodosAdeudables)
// y en que la sección de cuota anual permanece oculta -- mismo criterio en
// los dos lugares, para no mostrar como pendiente algo que todavía no
// corresponde reclamar.
function esEnero() {
  return new Date().getMonth() === 0;
}

// --- Usuario logueado y catálogo de perfiles, para "Ver cartera de" -------

async function cargarUsuarioActual() {
  try {
    const { data, error } = await supabaseHonorarios.auth.getSession();
    if (error) throw error;
    usuarioActualId = data?.session?.user?.id ?? null;
  } catch (error) {
    console.error('Error al obtener el usuario logueado:', error);
    usuarioActualId = null;
  }
}

// A diferencia de las cargas imprescindibles de cargarHonorarios() (ver
// comentario grande ahí), esta NO relanza el error hacia arriba: el
// catálogo de perfiles solo se usa para sumar más opciones al selector
// "Ver cartera de" ("Yo" y "Todos" no dependen de esto), así que si esta
// consulta puntual falla (por ejemplo, un hiccup de red), el resto de la
// pantalla igual tiene que poder cargar -- mismo criterio defensivo que ya
// usa js/clientes.js con su propia cargarPerfiles().
async function cargarPerfiles() {
  try {
    const { data, error } = await supabaseHonorarios.from('perfiles').select('id, nombre').order('nombre');
    if (error) throw error;
    perfilesCache = (data || []).filter((perfil) => perfil.nombre);
  } catch (error) {
    console.error('Error al cargar la lista de perfiles para "Ver cartera de":', error);
    perfilesCache = [];
  }
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

if (elFiltroCartera) {
  elFiltroCartera.addEventListener('change', () => {
    dibujarTablaHonorarios();
    dibujarSeccionHonorariosAnual();
  });
}

// Clientes con responsable_id NULL (los que no tenían un match exacto en el
// backfill, ver schema.sql sección 15.1): no se les puede atribuir a nadie
// en particular, así que solo aparecen en "Todos" -- mismo criterio que
// js/presentaciones.js.
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

// --- Carga inicial -------------------------------------------------------

// Carga "segura" de una de las tres tablas complementarias (deuda
// congelada, otros gastos, configuración del estudio): si esta consulta
// puntual falla -- por ejemplo, porque todavía no se volvió a pegar
// schema.sql en Supabase después de agregar esa tabla/feature (ver
// CLAUDE.md, "Database") -- NO debe tumbar el resto de la pantalla. Antes,
// un solo error acá (aunque no tuviera nada que ver con la tabla principal
// de Honorarios) hacía que cargarHonorarios() entero cayera al catch antes
// de llegar a poblarFiltroCartera()/dibujarTablaHonorarios(), dejando
// TANTO la tabla principal COMO el selector "Ver cartera de" -- ni
// siquiera la opción "Yo" -- completamente en blanco, con el único aviso
// siendo un cartel que además se auto-oculta a los 4 segundos (ver
// mostrarMensajeHonorarios). Cae a un valor seguro y anota una advertencia
// legible en vez de relanzar el error -- mismo espíritu defensivo que ya
// usa excel-utils.js con el require() de exceljs.
async function cargarTablaComplementariaSegura(tabla, etiqueta, construirQuery, advertencias) {
  try {
    const { data, error } = await construirQuery(supabaseHonorarios.from(tabla));
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`Error al cargar "${etiqueta}":`, error);
    advertencias.push(etiqueta);
    return null;
  }
}

async function cargarHonorarios() {
  if (!supabaseHonorarios) return;

  try {
    // Datos imprescindibles: sin esto la pantalla no tiene nada que
    // mostrar, así que acá un error sigue siendo fatal para toda la carga
    // (ver el catch de abajo).
    const [
      { data: clientes, error: errorClientes },
      { data: honorarios, error: errorHonorarios },
      { data: pagos, error: errorPagos },
    ] = await Promise.all([
      supabaseHonorarios
        .from('clientes')
        .select('id, razon_social, ruc, cierre_fiscal_mes, membrete_nombre, membrete_direccion, membrete_telefono, responsable_id')
        .order('razon_social'),
      supabaseHonorarios.from('honorarios').select('*'),
      supabaseHonorarios.from('pagos_honorarios').select('*').order('fecha_pago', { ascending: false }),
    ]);

    if (errorClientes) throw errorClientes;
    if (errorHonorarios) throw errorHonorarios;
    if (errorPagos) throw errorPagos;

    clientesCacheHonorarios = clientes || [];
    honorariosCache = honorarios || [];
    pagosCache = pagos || [];

    // Datos complementarios (ver cargarTablaComplementariaSegura arriba):
    // cada uno cae a un valor seguro por separado si falla, en vez de
    // tumbar toda la pantalla.
    const advertencias = [];
    const [deudasCongeladas, otrosGastos, configuracion] = await Promise.all([
      cargarTablaComplementariaSegura(
        'deudas_congeladas_honorarios',
        'Deuda congelada',
        (query) => query.select('*'),
        advertencias
      ),
      cargarTablaComplementariaSegura(
        'otros_gastos_honorarios',
        'Otros Gastos',
        (query) => query.select('*').order('fecha_cargo', { ascending: false }),
        advertencias
      ),
      cargarTablaComplementariaSegura(
        'configuracion_estudio',
        'Configuración del estudio',
        (query) => query.select('*').eq('id', 1).maybeSingle(),
        advertencias
      ),
    ]);
    deudasCongeladasCache = deudasCongeladas || [];
    otrosGastosCache = otrosGastos || [];
    configuracionEstudio = configuracion || null;

    await Promise.all([cargarUsuarioActual(), cargarPerfiles()]);
    poblarFiltroCartera();

    dibujarTablaHonorarios();
    dibujarSeccionHonorariosAnual();
    poblarFiltroAnioPagos();
    dibujarTablaPagos();

    if (advertencias.length > 0) {
      // Se ve el resto de la pantalla igual (tabla principal, selector de
      // cartera, historial de pagos); solo avisamos qué NO se pudo cargar.
      mostrarMensajeHonorarios(
        `Los honorarios se cargaron, pero no se pudo traer: ${advertencias.join(', ')}. Puede que falte volver a correr schema.sql en Supabase (ver CLAUDE.md).`,
        'error'
      );
    } else if (elHonorariosMensaje) {
      // La carga salió bien: si había quedado pegado un cartel de error de
      // un intento anterior (por ejemplo, el primero antes de loguearse), lo
      // ocultamos.
      elHonorariosMensaje.classList.add('oculto');
    }
  } catch (error) {
    console.error('Error al cargar honorarios:', error);
    mostrarMensajeHonorarios('No se pudieron cargar los honorarios.', 'error');
  }
}

// --- Tabla de honorarios por cliente -------------------------------------

// Fecha "ancla" del período en el que cae `fecha`: el primer día del mes
// (mensual) o el 1º de enero del año en que arrancó el ejercicio fiscal
// vigente en esa fecha (anual, misma convención que
// obtenerPeriodoVigente()/pagos_honorarios.periodo, que siempre guarda el
// 1º de enero del año de inicio de ejercicio, no el año de cierre). Se usa
// tanto para contar cuántos períodos pasaron (contarPeriodosAdeudables)
// como para decidir qué pagos entran en el cálculo corriente cuando hay
// una deuda congelada (ver calcularSaldoPorTipo).
function calcularAnclaPeriodo(fecha, periodicidad, cierreFiscalMes) {
  if (periodicidad === 'mensual') {
    return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
  }
  const mes = fecha.getMonth() + 1;
  const anioEjercicioInicio = mes > cierreFiscalMes ? fecha.getFullYear() : fecha.getFullYear() - 1;
  return new Date(anioEjercicioInicio, 0, 1);
}

// Cuenta cuántos meses hay que pagar desde `fechaInicio` (honorarios.created_at,
// o el created_at de la deuda congelada pendiente más reciente si el cliente
// tiene una -- ver calcularSaldoPorTipo) hasta el período vigente, ambos
// inclusive. Nunca da menos de 1. Solo se usa para la cuota MENSUAL: la
// anual dejó de contarse por períodos transcurridos (ver calcularSaldoPorTipo
// y el comentario de `anual_habilitado_desde` en schema.sql) -- se activa a
// mano y se debe un monto único, no periodos × monto.
function contarPeriodosAdeudables(fechaInicio, cierreFiscalMes) {
  const inicio = calcularAnclaPeriodo(fechaInicio, 'mensual', cierreFiscalMes);
  const vigente = obtenerPeriodoVigente('mensual');
  const meses = (vigente.getFullYear() - inicio.getFullYear()) * 12 + (vigente.getMonth() - inicio.getMonth()) + 1;
  return Math.max(meses, 1);
}

// --- Deudas congeladas (diferidas sin condonar) ---------------------------

// Todas las deudas congeladas TODAVÍA pendientes (pagada = false) de un
// cliente, sin importar el tipo -- para el badge y el panel de gestión.
function deudasCongeladasPendientesDeCliente(clienteId) {
  return deudasCongeladasCache.filter((deuda) => deuda.cliente_id === clienteId && !deuda.pagada);
}

// La deuda congelada pendiente MÁS RECIENTE (por created_at) de un
// cliente+tipo puntual, o null si no tiene ninguna. Es la que determina el
// nuevo punto de partida del cálculo corriente (ver calcularSaldoPorTipo).
function deudaCongeladaPendienteMasReciente(clienteId, tipoHonorario) {
  const pendientes = deudasCongeladasPendientesDeCliente(clienteId).filter(
    (deuda) => deuda.tipo_honorario === tipoHonorario
  );
  if (pendientes.length === 0) return null;

  return pendientes.reduce((masReciente, actual) =>
    new Date(actual.created_at) > new Date(masReciente.created_at) ? actual : masReciente
  );
}

// Saldo pendiente de UNA de las dos cuotas (mensual o anual). Devuelve
// null si el cliente no tiene esa cuota configurada.
//
// La anual es un caso especial (confirmado por el usuario): a diferencia de
// la mensual, NO suma sola con el paso del tiempo -- mientras
// honorario.anual_habilitado_desde sea null, esta función devuelve 0 para
// 'anual' sin importar cuánto hace que se configuró. El contador la activa
// a mano (botón "Activar cobro anual", ver dibujarSeccionHonorariosAnual) el
// día que corresponde cobrarla, y desde ahí se debe el monto_anual completo
// de una sola vez (no multiplicado por períodos como la mensual), descontado
// por los pagos anuales registrados DESDE esa activación -- nunca por pagos
// de un ciclo anterior ya saldado (si no, reactivar el cobro el año que
// viene contaría el pago del año pasado como si fuera de este año y nunca
// mostraría "Debe").
function calcularSaldoPorTipo(honorario, cliente, tipoHonorario) {
  const monto = tipoHonorario === 'mensual' ? honorario.monto_mensual : honorario.monto_anual;
  if (monto === null || monto === undefined) return null;

  const cierreFiscalMes = cliente?.cierre_fiscal_mes ?? 12;
  // Si hay una deuda vieja congelada pendiente para este cliente+tipo, el
  // cálculo corriente arranca de cero desde que se congeló (created_at de
  // la más reciente) en vez de arrancar desde el punto de partida normal --
  // sin tocar ese punto de partida real, que sigue existiendo por si se usa
  // en otro lado.
  const deudaCongelada = deudaCongeladaPendienteMasReciente(honorario.cliente_id, tipoHonorario);

  if (tipoHonorario === 'anual') {
    if (!honorario.anual_habilitado_desde) return 0;

    const fechaInicio = deudaCongelada ? new Date(deudaCongelada.created_at) : new Date(honorario.anual_habilitado_desde);
    const anclaPeriodoIso = formatearFechaISO(calcularAnclaPeriodo(fechaInicio, 'anual', cierreFiscalMes));
    const totalPagado = pagosCache
      .filter((pago) => pago.cliente_id === honorario.cliente_id && pago.tipo_honorario === 'anual' && pago.periodo >= anclaPeriodoIso)
      .reduce((total, pago) => total + Number(pago.monto_pagado), 0);

    return Math.max(Number(monto) - totalPagado, 0);
  }

  const fechaInicio = deudaCongelada ? new Date(deudaCongelada.created_at) : new Date(honorario.created_at);
  let pagosDelTipo = pagosCache.filter(
    (pago) => pago.cliente_id === honorario.cliente_id && pago.tipo_honorario === 'mensual'
  );

  // Si el punto de partida se movió por una deuda congelada, los pagos de
  // períodos ANTERIORES a ese punto ya quedaron reflejados en el monto que
  // se congeló (lo tipeó quien la congeló) -- no se vuelven a restar acá,
  // porque si se restaran de nuevo un pago viejo contaría dos veces (una
  // en el monto congelado, otra acá) y el saldo corriente daría de menos.
  if (deudaCongelada) {
    const anclaPeriodoIso = formatearFechaISO(calcularAnclaPeriodo(fechaInicio, 'mensual', cierreFiscalMes));
    pagosDelTipo = pagosDelTipo.filter((pago) => pago.periodo >= anclaPeriodoIso);
  }

  const totalPagado = pagosDelTipo.reduce((total, pago) => total + Number(pago.monto_pagado), 0);
  const periodos = contarPeriodosAdeudables(fechaInicio, cierreFiscalMes);
  return Math.max(Number(monto) * periodos - totalPagado, 0);
}

// Devuelve { estado: 'al_dia' | 'debe', saldoPendiente } sumando el saldo
// de la cuota mensual y de la anual (las que el cliente tenga configuradas).
function calcularEstadoHonorario(honorario, cliente) {
  if (!honorario) return null;

  const saldoMensual = calcularSaldoPorTipo(honorario, cliente, 'mensual') ?? 0;
  const saldoAnual = calcularSaldoPorTipo(honorario, cliente, 'anual') ?? 0;
  const saldoPendiente = saldoMensual + saldoAnual;

  return { estado: saldoPendiente > 0 ? 'debe' : 'al_dia', saldoPendiente };
}

function dibujarBadgeEstado(resultado) {
  if (!resultado) return '<span class="texto-ayuda">Sin configurar</span>';
  if (resultado.estado === 'al_dia') return '<span class="badge badge-verde">Al día</span>';
  return `<span class="badge badge-rojo">Debe ${formatearGuaranies(resultado.saldoPendiente)}</span>`;
}

// Badge(s) secundario(s) de "Deuda congelada", aparte del badge principal
// "Al día"/"Debe" -- con estilo neutro (ni verde ni rojo) a propósito, para
// que no se lea como un mensaje urgente: es una deuda vieja que se sigue
// debiendo, pero cuyo cobro quedó diferido a `fecha_acuerdo` y ya no cuenta
// para el estado corriente. `tipoFiltro` ('mensual'/'anual'), si se pasa,
// limita a las deudas de ese tipo y omite la etiqueta de tipo en el texto
// (se usa desde la sección de Cuota Anual, donde el tipo ya es obvio por
// contexto); sin filtro (tabla principal, que mezcla los dos tipos en una
// sola fila) el texto aclara a cuál corresponde cada una.
function dibujarBadgesDeudaCongelada(clienteId, tipoFiltro = null) {
  const pendientes = deudasCongeladasPendientesDeCliente(clienteId).filter(
    (deuda) => !tipoFiltro || deuda.tipo_honorario === tipoFiltro
  );
  if (pendientes.length === 0) return '';

  return pendientes
    .map((deuda) => {
      const prefijoTipo = tipoFiltro ? '' : `${deuda.tipo_honorario === 'mensual' ? 'Mensual' : 'Anual'}: `;
      return `<span class="badge badge-neutro" title="Deuda vieja congelada: se sigue debiendo, pero no cuenta para el estado corriente hasta la fecha de acuerdo">Deuda congelada -- ${prefijoTipo}${formatearGuaranies(deuda.monto)} (${formatearMesAnioCorto(deuda.fecha_acuerdo)})</span>`;
    })
    .join(' ');
}

// --- Otros gastos (cargos sueltos, independientes de la cuota) -----------

// Todos los "otros gastos" TODAVÍA pendientes (pagado = false) de un
// cliente -- para el badge y el panel de gestión.
function otrosGastosPendientesDeCliente(clienteId) {
  return otrosGastosCache.filter((gasto) => gasto.cliente_id === clienteId && !gasto.pagado);
}

function totalOtrosGastosPendientes(clienteId) {
  return otrosGastosPendientesDeCliente(clienteId).reduce((total, gasto) => total + Number(gasto.monto), 0);
}

// Badge secundario "Otros gastos pendientes: Gs. X" -- mismo estilo neutro
// (badge-neutro) que "Deuda congelada", a propósito: los tres indicadores
// de esta pantalla (Al día/Debe, Deuda congelada, Otros gastos) tienen que
// leerse como parte del mismo sistema visual, no como cosas sueltas. NO
// suma nada al saldo de calcularSaldoPorTipo/calcularEstadoHonorario --
// es intencionalmente un número aparte.
function dibujarBadgeOtrosGastos(clienteId) {
  const total = totalOtrosGastosPendientes(clienteId);
  if (total <= 0) return '';
  return `<span class="badge badge-neutro" title="Cargos sueltos (no la cuota mensual/anual) todavía no pagados por este cliente">Otros gastos pendientes: ${formatearGuaranies(total)}</span>`;
}

function dibujarTablaHonorarios() {
  elTablaHonorariosBody.innerHTML = '';

  // Primero se filtra por cartera y, sobre ese resultado, por la búsqueda
  // de nombre/RUC -- las dos se combinan, no se reemplazan entre sí.
  const clientesDeLaCartera = filtrarClientesPorCartera(clientesCacheHonorarios);
  const busqueda = elHonorariosBuscar.value.trim().toLowerCase();
  const clientesFiltrados = clientesDeLaCartera.filter((cliente) => {
    if (!busqueda) return true;
    return (
      cliente.razon_social.toLowerCase().includes(busqueda) ||
      (cliente.ruc ?? '').toLowerCase().includes(busqueda)
    );
  });

  if (clientesFiltrados.length === 0) {
    elSinHonorarios.classList.remove('oculto');
    return;
  }
  elSinHonorarios.classList.add('oculto');

  for (const cliente of clientesFiltrados) {
    const honorario = honorariosCache.find((h) => h.cliente_id === cliente.id);
    const resultado = calcularEstadoHonorario(honorario, cliente);
    const badgesDeudaCongelada = dibujarBadgesDeudaCongelada(cliente.id);
    const badgeOtrosGastos = dibujarBadgeOtrosGastos(cliente.id);

    const filaCliente = document.createElement('tr');
    filaCliente.innerHTML = `
      <td>${escaparHtmlHonorarios(cliente.razon_social)}</td>
      <td>${honorario?.monto_mensual ? formatearGuaranies(honorario.monto_mensual) : '—'}</td>
      <td>${honorario?.monto_anual ? formatearGuaranies(honorario.monto_anual) : '—'}</td>
      <td>${dibujarBadgeEstado(resultado)}${badgesDeudaCongelada ? `<br />${badgesDeudaCongelada}` : ''}${badgeOtrosGastos ? `<br />${badgeOtrosGastos}` : ''}</td>
      <td class="celda-checkbox"><input type="checkbox" data-pagar-cliente="${cliente.id}" ${honorario ? '' : 'disabled'} /></td>
      <td class="celda-acciones-honorarios">
        <button type="button" class="boton boton-chico" data-ficha-cliente-id="${cliente.id}" ${honorario ? '' : 'disabled'}>Ficha</button>
        <select class="selector-acciones-honorarios" data-acciones-cliente-id="${cliente.id}">
          <option value="" selected>Acciones ▾</option>
          <option value="editar-cuota">Editar cuota</option>
          <option value="detalle">Detalle</option>
          <option value="deuda-congelada" ${honorario ? '' : 'disabled'}>Deuda congelada</option>
          <option value="otros-gastos">Otros Gastos</option>
        </select>
      </td>
    `;
    elTablaHonorariosBody.appendChild(filaCliente);

    const filaExpandible = document.createElement('tr');
    filaExpandible.className = 'fila-expandible oculto';
    filaExpandible.dataset.expandibleId = cliente.id;
    filaExpandible.innerHTML = `<td colspan="6"></td>`;
    elTablaHonorariosBody.appendChild(filaExpandible);
  }
}

elHonorariosBuscar.addEventListener('input', dibujarTablaHonorarios);

// --- Cuota Anual: sección aparte, solo desde febrero ----------------------

// Solo se muestra si estamos en febrero o después (misma regla de gracia
// que contarPeriodosAdeudables) Y si el panel "panel_honorarios_cuota_anual"
// de Configuración > Paneles está activado (se lee configuracion_estudio
// al cargar la pantalla).
function dibujarSeccionHonorariosAnual() {
  if (!elSeccionHonorariosAnual || !elTablaHonorariosAnualBody) return;

  const panelActivo = configuracionEstudio?.panel_honorarios_cuota_anual ?? true;

  if (esEnero() || !panelActivo) {
    elSeccionHonorariosAnual.classList.add('oculto');
    return;
  }

  elSeccionHonorariosAnual.classList.remove('oculto');
  elTablaHonorariosAnualBody.innerHTML = '';

  // Misma cartera elegida arriba para la tabla principal -- esta sección no
  // tiene su propio buscador, solo hereda el filtro de cartera.
  const clientesConCuotaAnual = filtrarClientesPorCartera(clientesCacheHonorarios).filter((cliente) => {
    const honorario = honorariosCache.find((h) => h.cliente_id === cliente.id);
    return honorario?.monto_anual !== null && honorario?.monto_anual !== undefined;
  });

  if (clientesConCuotaAnual.length === 0) {
    elTablaHonorariosAnualBody.innerHTML = `<tr><td colspan="4" class="sin-datos">No hay clientes con cuota anual configurada.</td></tr>`;
    return;
  }

  for (const cliente of clientesConCuotaAnual) {
    const honorario = honorariosCache.find((h) => h.cliente_id === cliente.id);
    const saldoAnual = calcularSaldoPorTipo(honorario, cliente, 'anual') ?? 0;
    const estadoAnual = { estado: saldoAnual > 0 ? 'debe' : 'al_dia', saldoPendiente: saldoAnual };
    const badgesDeudaCongeladaAnual = dibujarBadgesDeudaCongelada(cliente.id, 'anual');
    // Mientras no se active, el botón invita a activarlo; una vez activado
    // (ya sea "Debe" o ya se pagó y quedó "Al día"), se puede desactivar
    // para el año que viene -- ver el listener de "click" más abajo.
    const botonActivar = honorario.anual_habilitado_desde
      ? `<button type="button" class="boton boton-chico" data-desactivar-anual-id="${cliente.id}">Desactivar cobro anual</button>`
      : `<button type="button" class="boton boton-chico" data-activar-anual-id="${cliente.id}">Activar cobro anual</button>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escaparHtmlHonorarios(cliente.razon_social)}</td>
      <td>${formatearGuaranies(honorario.monto_anual)}</td>
      <td>${dibujarBadgeEstado(estadoAnual)}${badgesDeudaCongeladaAnual ? `<br />${badgesDeudaCongeladaAnual}` : ''}</td>
      <td>${botonActivar}</td>
    `;
    elTablaHonorariosAnualBody.appendChild(tr);
  }
}

// Activa/desactiva el cobro de la cuota anual de un cliente (ver
// `anual_habilitado_desde` en schema.sql y calcularSaldoPorTipo). Al
// activar guarda el momento exacto (ancla para no contar de nuevo pagos de
// un ciclo anterior); al desactivar vuelve a null. Actualiza
// honorariosCache en memoria antes de repintar para no tener que volver a
// pedir toda la tabla de honorarios de nuevo.
async function cambiarAnualHabilitado(clienteId, activar) {
  const nuevoValor = activar ? new Date().toISOString() : null;

  try {
    const { error } = await supabaseHonorarios
      .from('honorarios')
      .update({ anual_habilitado_desde: nuevoValor })
      .eq('cliente_id', clienteId);

    if (error) throw error;

    const honorario = honorariosCache.find((h) => h.cliente_id === clienteId);
    if (honorario) honorario.anual_habilitado_desde = nuevoValor;

    dibujarTablaHonorarios();
    dibujarSeccionHonorariosAnual();
  } catch (error) {
    console.error('Error al cambiar el cobro de la cuota anual:', error);
    mostrarMensajeHonorarios('No se pudo guardar el cambio. Intentá de nuevo.', 'error');
  }
}

if (elTablaHonorariosAnualBody) {
  elTablaHonorariosAnualBody.addEventListener('click', (evento) => {
    const botonActivar = evento.target.closest('button[data-activar-anual-id]');
    if (botonActivar) {
      cambiarAnualHabilitado(Number(botonActivar.dataset.activarAnualId), true);
      return;
    }

    const botonDesactivar = evento.target.closest('button[data-desactivar-anual-id]');
    if (botonDesactivar) {
      cambiarAnualHabilitado(Number(botonDesactivar.dataset.desactivarAnualId), false);
    }
  });
}

// --- Filas expandibles de la tabla principal (pago / editar cuota / detalle) --

function cerrarTodasLasFilasExpandibles() {
  elTablaHonorariosBody.querySelectorAll('tr.fila-expandible').forEach((fila) => {
    fila.classList.add('oculto');
    fila.querySelector('td').innerHTML = '';
  });
  elTablaHonorariosBody.querySelectorAll('input[data-pagar-cliente]').forEach((casilla) => {
    casilla.checked = false;
  });
}

function cerrarFilaExpandible(clienteId) {
  const fila = elTablaHonorariosBody.querySelector(`tr.fila-expandible[data-expandible-id="${clienteId}"]`);
  if (fila) {
    fila.classList.add('oculto');
    fila.querySelector('td').innerHTML = '';
  }
  const casilla = elTablaHonorariosBody.querySelector(`input[data-pagar-cliente="${clienteId}"]`);
  if (casilla) casilla.checked = false;
}

// Abre la fila expandible del cliente con el HTML dado, cerrando primero
// cualquier otra fila que hubiera quedado abierta (una sola a la vez).
function abrirFilaExpandible(clienteId, html) {
  cerrarTodasLasFilasExpandibles();
  const fila = elTablaHonorariosBody.querySelector(`tr.fila-expandible[data-expandible-id="${clienteId}"]`);
  if (!fila) return;
  fila.querySelector('td').innerHTML = html;
  fila.classList.remove('oculto');
}

// --- Período (mes+año o solo año) para el formulario de pago -------------

function generarOpcionesAnioSelect(anioSeleccionado) {
  const anioActual = new Date().getFullYear();
  let html = '';
  for (let anio = anioActual - 5; anio <= anioActual + 1; anio += 1) {
    html += `<option value="${anio}" ${anio === anioSeleccionado ? 'selected' : ''}>${anio}</option>`;
  }
  return html;
}

function generarOpcionesMesSelect(mesSeleccionado) {
  return NOMBRES_MES_COMPLETOS
    .map((nombre, indice) => `<option value="${indice + 1}" ${indice + 1 === mesSeleccionado ? 'selected' : ''}>${nombre}</option>`)
    .join('');
}

// Devuelve el HTML de los campos de período según el tipo de cuota: mes+año
// para la mensual, solo año para la anual. `fechaPeriodo` es un Date que
// marca qué mes/año sugerir por defecto (editable para cargar pagos
// atrasados).
function construirCamposPeriodoHtml(tipo, fechaPeriodo) {
  const anioSeleccionado = fechaPeriodo.getFullYear();

  if (tipo === 'mensual') {
    const mesSeleccionado = fechaPeriodo.getMonth() + 1;
    return `
      <label>Período</label>
      <div class="grupo-periodo-mensual">
        <select class="campo-periodo-mes">${generarOpcionesMesSelect(mesSeleccionado)}</select>
        <select class="campo-periodo-anio">${generarOpcionesAnioSelect(anioSeleccionado)}</select>
      </div>
    `;
  }

  return `
    <label>Año</label>
    <select class="campo-periodo-anio">${generarOpcionesAnioSelect(anioSeleccionado)}</select>
  `;
}

// --- Formulario de pago (registrar nuevo o editar uno existente) ---------

// Arma el mini-formulario de pago. Si `pagoExistente` es null, es para
// registrar un pago nuevo (sugiere el período vigente y el monto pactado);
// si viene un pago, es para corregirlo (precarga sus valores actuales y
// guarda con UPDATE en vez de INSERT -- ver guardarPagoInline).
function construirFormularioPagoHtml(cliente, honorario, pagoExistente = null) {
  const cierreFiscalMes = cliente?.cierre_fiscal_mes ?? 12;
  const tieneMensual = honorario.monto_mensual !== null && honorario.monto_mensual !== undefined;
  const tieneAnual = honorario.monto_anual !== null && honorario.monto_anual !== undefined;
  const tipoInicial = pagoExistente?.tipo_honorario || (tieneMensual ? 'mensual' : 'anual');

  const selectorTipoHtml = (tieneMensual && tieneAnual)
    ? `
      <div class="fila-form">
        <label>Corresponde a</label>
        <select class="campo-pago-tipo">
          <option value="mensual" ${tipoInicial === 'mensual' ? 'selected' : ''}>Cuota Mensual</option>
          <option value="anual" ${tipoInicial === 'anual' ? 'selected' : ''}>Cuota Anual</option>
        </select>
      </div>`
    : `<input type="hidden" class="campo-pago-tipo" value="${tipoInicial}" />`;

  const montoInicial = pagoExistente
    ? pagoExistente.monto_pagado
    : ((tipoInicial === 'mensual' ? honorario.monto_mensual : honorario.monto_anual) || '');

  const fechaInicial = pagoExistente ? pagoExistente.fecha_pago : formatearFechaISO(new Date());
  const reciboInicial = pagoExistente?.numero_recibo || '';
  const formaInicial = pagoExistente?.forma_pago || 'efectivo';

  const periodoFecha = pagoExistente
    ? new Date(`${pagoExistente.periodo}T00:00:00`)
    : obtenerPeriodoVigente(tipoInicial, cierreFiscalMes);

  return `
    <form class="form-pago-inline" data-cliente-id="${cliente.id}" ${pagoExistente ? `data-pago-id="${pagoExistente.id}"` : ''}>
      <h3 class="fila-form-titulo">${pagoExistente ? 'Editar Pago' : 'Registrar Pago'} — ${escaparHtmlHonorarios(cliente.razon_social)}</h3>
      <div class="grilla-form-inline">
        ${selectorTipoHtml}
        <div class="fila-form">
          <label>Monto Pagado (Gs.)</label>
          <input type="text" inputmode="numeric" class="campo-pago-monto" required value="${formatearConPuntos(String(montoInicial))}" />
        </div>
        <div class="fila-form">
          <label>Forma de Pago</label>
          <select class="campo-pago-forma">
            <option value="efectivo" ${formaInicial === 'efectivo' ? 'selected' : ''}>Efectivo</option>
            <option value="transferencia" ${formaInicial === 'transferencia' ? 'selected' : ''}>Transferencia</option>
            <option value="cheque" ${formaInicial === 'cheque' ? 'selected' : ''}>Cheque</option>
          </select>
        </div>
        <div class="fila-form">
          <label>N° de Recibo</label>
          <input type="text" class="campo-pago-recibo" placeholder="Ej: 0231" spellcheck="true" value="${escaparHtmlHonorarios(reciboInicial)}" />
        </div>
        <div class="fila-form">
          <label>Fecha de Pago</label>
          <input type="date" class="campo-pago-fecha" value="${fechaInicial}" />
        </div>
        <div class="fila-form campo-pago-periodo-contenedor">
          ${construirCamposPeriodoHtml(tipoInicial, periodoFecha)}
        </div>
      </div>
      <div class="acciones-form">
        <button type="submit" class="boton boton-primario boton-chico">Guardar Pago</button>
        <button type="button" class="boton boton-secundario boton-chico" data-cancelar-inline>Cancelar</button>
      </div>
    </form>
  `;
}

function abrirFormularioPago(clienteId) {
  const cliente = clientesCacheHonorarios.find((c) => c.id === clienteId);
  const honorario = honorariosCache.find((h) => h.cliente_id === clienteId);
  if (!cliente || !honorario) return;
  abrirFilaExpandible(clienteId, construirFormularioPagoHtml(cliente, honorario));
}

// Al cambiar el tipo de cuota en el formulario (solo posible si el cliente
// tiene las dos), actualizamos el monto sugerido y los campos de período.
function actualizarCamposSegunTipoInline(selectTipo) {
  const form = selectTipo.closest('form.form-pago-inline');
  if (!form) return;

  const clienteId = Number(form.dataset.clienteId);
  const cliente = clientesCacheHonorarios.find((c) => c.id === clienteId);
  const honorario = honorariosCache.find((h) => h.cliente_id === clienteId);
  const tipo = selectTipo.value;
  const cierreFiscalMes = cliente?.cierre_fiscal_mes ?? 12;

  const montoInput = form.querySelector('.campo-pago-monto');
  const montoSugerido = tipo === 'mensual' ? honorario?.monto_mensual : honorario?.monto_anual;
  if (montoInput && montoSugerido) montoInput.value = formatearConPuntos(String(montoSugerido));

  const contenedorPeriodo = form.querySelector('.campo-pago-periodo-contenedor');
  if (contenedorPeriodo) {
    contenedorPeriodo.innerHTML = construirCamposPeriodoHtml(tipo, obtenerPeriodoVigente(tipo, cierreFiscalMes));
  }
}

async function guardarPagoInline(form) {
  const clienteId = Number(form.dataset.clienteId);
  const pagoId = form.dataset.pagoId ? Number(form.dataset.pagoId) : null;

  const tipo = form.querySelector('.campo-pago-tipo').value;
  const monto = Number(quitarPuntos(form.querySelector('.campo-pago-monto').value));
  const forma = form.querySelector('.campo-pago-forma').value;
  const recibo = form.querySelector('.campo-pago-recibo').value.trim() || null;
  const fecha = form.querySelector('.campo-pago-fecha').value || formatearFechaISO(new Date());
  const selectMes = form.querySelector('.campo-periodo-mes');
  const selectAnio = form.querySelector('.campo-periodo-anio');
  const anio = Number(selectAnio.value);

  const periodo = tipo === 'mensual'
    ? formatearFechaISO(new Date(anio, Number(selectMes.value) - 1, 1))
    : formatearFechaISO(new Date(anio, 0, 1));

  const datosPago = {
    cliente_id: clienteId,
    tipo_honorario: tipo,
    monto_pagado: monto,
    forma_pago: forma,
    numero_recibo: recibo,
    fecha_pago: fecha,
    periodo,
  };

  try {
    const { error } = pagoId
      ? await supabaseHonorarios.from('pagos_honorarios').update(datosPago).eq('id', pagoId)
      : await supabaseHonorarios.from('pagos_honorarios').insert(datosPago);

    if (error) throw error;

    mostrarMensajeHonorarios(pagoId ? 'Pago actualizado correctamente.' : 'Pago registrado correctamente.');
    await cargarHonorarios();
  } catch (error) {
    console.error('Error al guardar el pago:', error);
    mostrarMensajeHonorarios('No se pudo guardar el pago.', 'error');
  }
}

// --- Editar la cuota pactada de un cliente (sin ir a Clientes) ------------

function construirFormularioEditarCuotaHtml(cliente, honorario) {
  return `
    <form class="form-editar-cuota-inline" data-cliente-id="${cliente.id}">
      <h3 class="fila-form-titulo">Editar Cuota — ${escaparHtmlHonorarios(cliente.razon_social)}</h3>
      <div class="grilla-form-inline">
        <div class="fila-form">
          <label>Cuota Mensual (Gs.)</label>
          <input type="text" inputmode="numeric" class="campo-cuota-mensual" value="${formatearConPuntos(String(honorario?.monto_mensual ?? ''))}" />
        </div>
        <div class="fila-form">
          <label>Cuota Anual (Gs.)</label>
          <input type="text" inputmode="numeric" class="campo-cuota-anual" value="${formatearConPuntos(String(honorario?.monto_anual ?? ''))}" />
        </div>
      </div>
      <div class="acciones-form">
        <button type="submit" class="boton boton-primario boton-chico">Guardar Cuota</button>
        <button type="button" class="boton boton-secundario boton-chico" data-cancelar-inline>Cancelar</button>
      </div>
    </form>
  `;
}

function abrirFormularioEditarCuota(clienteId) {
  const cliente = clientesCacheHonorarios.find((c) => c.id === clienteId);
  if (!cliente) return;
  const honorario = honorariosCache.find((h) => h.cliente_id === clienteId);
  abrirFilaExpandible(clienteId, construirFormularioEditarCuotaHtml(cliente, honorario));
}

async function guardarCuotaInline(form) {
  const clienteId = Number(form.dataset.clienteId);
  const montoMensualTexto = quitarPuntos(form.querySelector('.campo-cuota-mensual').value);
  const montoAnualTexto = quitarPuntos(form.querySelector('.campo-cuota-anual').value);
  const montoMensual = montoMensualTexto ? Number(montoMensualTexto) : null;
  const montoAnual = montoAnualTexto ? Number(montoAnualTexto) : null;

  if (montoMensual === null && montoAnual === null) {
    mostrarMensajeHonorarios('Cargá al menos una cuota (mensual o anual).', 'error');
    return;
  }

  try {
    // "upsert" sobre cliente_id (unique constraint honorarios_cliente_unique):
    // actualiza la fila si ya existía honorario configurado para este
    // cliente, o la crea si todavía no tenía ninguno.
    const { error } = await supabaseHonorarios
      .from('honorarios')
      .upsert(
        { cliente_id: clienteId, monto_mensual: montoMensual, monto_anual: montoAnual },
        { onConflict: 'cliente_id' }
      );

    if (error) throw error;

    mostrarMensajeHonorarios('Cuota actualizada correctamente.');
    await cargarHonorarios();
  } catch (error) {
    console.error('Error al guardar la cuota:', error);
    mostrarMensajeHonorarios('No se pudo guardar la cuota.', 'error');
  }
}

// --- Congelar deuda vieja (diferir el cobro sin condonarla) ---------------
//
// Mismo espíritu de fila-expandible que el resto de esta pantalla: un
// panel que junto muestra las deudas congeladas pendientes del cliente
// (con botón "Marcar cobrada" cada una) y un mini-formulario para congelar
// una deuda nueva (monto + fecha de acuerdo). Ver comentario largo al
// principio del archivo y en schema.sql (tabla deudas_congeladas_honorarios)
// para el diseño completo.

function construirFormularioCongelarDeudaHtml(cliente, honorario) {
  const tieneMensual = honorario.monto_mensual !== null && honorario.monto_mensual !== undefined;
  const tieneAnual = honorario.monto_anual !== null && honorario.monto_anual !== undefined;
  const tipoInicial = tieneMensual ? 'mensual' : 'anual';

  const selectorTipoHtml = (tieneMensual && tieneAnual)
    ? `
      <div class="fila-form">
        <label>Corresponde a</label>
        <select class="campo-deuda-tipo">
          <option value="mensual">Cuota Mensual</option>
          <option value="anual">Cuota Anual</option>
        </select>
      </div>`
    : `<input type="hidden" class="campo-deuda-tipo" value="${tipoInicial}" />`;

  const pendientes = deudasCongeladasPendientesDeCliente(cliente.id);
  const listaPendientesHtml = pendientes.length
    ? `
      <ul class="lista-resumen-importacion">
        ${pendientes
          .map((deuda) => `
            <li>
              ${deuda.tipo_honorario === 'mensual' ? 'Cuota Mensual' : 'Cuota Anual'}:
              ${formatearGuaranies(deuda.monto)} -- se espera cobrar el ${formatearFechaVisibleHonorarios(deuda.fecha_acuerdo)}
              <button type="button" class="boton boton-chico" data-marcar-deuda-pagada-id="${deuda.id}">Marcar cobrada</button>
            </li>
          `)
          .join('')}
      </ul>`
    : '<p class="sin-datos">Este cliente no tiene deuda congelada pendiente.</p>';

  return `
    <div class="detalle-cliente-inline">
      <h3 class="fila-form-titulo">Deuda Congelada — ${escaparHtmlHonorarios(cliente.razon_social)}</h3>
      ${listaPendientesHtml}
      <form class="form-congelar-deuda-inline" data-cliente-id="${cliente.id}">
        <h3 class="fila-form-titulo">Congelar deuda nueva</h3>
        <div class="grilla-form-inline">
          ${selectorTipoHtml}
          <div class="fila-form">
            <label>Monto Congelado (Gs.)</label>
            <input type="text" inputmode="numeric" class="campo-deuda-monto" required />
          </div>
          <div class="fila-form">
            <label>Fecha de Acuerdo (se espera cobrar)</label>
            <input type="date" class="campo-deuda-fecha-acuerdo" required />
          </div>
        </div>
        <div class="acciones-form">
          <button type="submit" class="boton boton-primario boton-chico">Congelar Deuda</button>
          <button type="button" class="boton boton-secundario boton-chico" data-cancelar-inline>Cerrar</button>
        </div>
      </form>
    </div>
  `;
}

function abrirFormularioCongelarDeuda(clienteId) {
  const cliente = clientesCacheHonorarios.find((c) => c.id === clienteId);
  const honorario = honorariosCache.find((h) => h.cliente_id === clienteId);
  if (!cliente || !honorario) return;
  abrirFilaExpandible(clienteId, construirFormularioCongelarDeudaHtml(cliente, honorario));
}

async function guardarDeudaCongeladaInline(form) {
  const clienteId = Number(form.dataset.clienteId);
  const tipo = form.querySelector('.campo-deuda-tipo').value;
  const monto = Number(quitarPuntos(form.querySelector('.campo-deuda-monto').value));
  const fechaAcuerdo = form.querySelector('.campo-deuda-fecha-acuerdo').value;

  if (!monto || monto <= 0) {
    mostrarMensajeHonorarios('Cargá un monto congelado válido.', 'error');
    return;
  }
  if (!fechaAcuerdo) {
    mostrarMensajeHonorarios('Cargá la fecha en la que se espera cobrar la deuda.', 'error');
    return;
  }

  try {
    const { error } = await supabaseHonorarios.from('deudas_congeladas_honorarios').insert({
      cliente_id: clienteId,
      tipo_honorario: tipo,
      monto,
      fecha_acuerdo: fechaAcuerdo,
    });
    if (error) throw error;

    mostrarMensajeHonorarios('Deuda congelada correctamente: ya no cuenta para el estado corriente.');
    await cargarHonorarios();
  } catch (error) {
    console.error('Error al congelar la deuda:', error);
    mostrarMensajeHonorarios('No se pudo congelar la deuda.', 'error');
  }
}

// Se marca "pagada" cuando finalmente se cobra la deuda vieja. A propósito
// NO genera un pago en pagos_honorarios (ver comentario en schema.sql):
// este monto no corresponde a un período puntual, sino a la suma de
// varios períodos viejos, así que mezclarlo en pagos_honorarios rompería
// la reconciliación período-por-período que hace la ficha de pago
// imprimible. Queda resuelta acá mismo, aparte.
async function marcarDeudaCongeladaPagada(deudaId) {
  try {
    const { error } = await supabaseHonorarios
      .from('deudas_congeladas_honorarios')
      .update({ pagada: true, fecha_pago: formatearFechaISO(new Date()) })
      .eq('id', deudaId);
    if (error) throw error;

    mostrarMensajeHonorarios('Deuda congelada marcada como cobrada.');
    await cargarHonorarios();
  } catch (error) {
    console.error('Error al marcar la deuda congelada como cobrada:', error);
    mostrarMensajeHonorarios('No se pudo marcar la deuda como cobrada.', 'error');
  }
}

// --- Otros gastos (cargos sueltos, independientes de la cuota) -----------
//
// Mismo espíritu de fila-expandible que el resto de esta pantalla: un
// panel que junta la lista de "otros gastos" TODAVÍA pendientes del
// cliente (con botón "Marcar pagado" cada uno, que despliega un
// mini-formulario propio con fecha de pago/forma de pago/N° de recibo -- a
// diferencia de "Marcar cobrada" de Deuda Congelada, acá SÍ hace falta un
// formulario porque el pedido pide poder cargar esos tres datos) y un
// mini-formulario para cargar un gasto nuevo (descripción + monto + fecha
// del cargo). Los gastos ya pagados no aparecen en esta lista -- se ven en
// el "Detalle" del cliente (construirDetalleClienteHtml más abajo), que
// lista TODOS (pagados y pendientes).

function construirListaOtrosGastosPendientesHtml(clienteId) {
  const pendientes = otrosGastosPendientesDeCliente(clienteId);
  if (pendientes.length === 0) {
    return '<p class="sin-datos">Este cliente no tiene otros gastos pendientes.</p>';
  }

  return `
    <ul class="lista-resumen-importacion">
      ${pendientes
        .map((gasto) => `
          <li data-fila-gasto-id="${gasto.id}">
            ${escaparHtmlHonorarios(gasto.descripcion)}: ${formatearGuaranies(gasto.monto)}
            -- cargado el ${formatearFechaVisibleHonorarios(gasto.fecha_cargo)}
            <button type="button" class="boton boton-chico" data-marcar-gasto-pagado-id="${gasto.id}">Marcar pagado</button>
          </li>
        `)
        .join('')}
    </ul>`;
}

// Mini-formulario que reemplaza, en el lugar, el <li> de un gasto pendiente
// cuando se hace clic en "Marcar pagado" -- mismos campos que
// pagos_honorarios (fecha de pago, forma de pago, N° de recibo opcional).
function construirSubformularioMarcarGastoPagadoHtml(gasto) {
  return `
    <form class="form-marcar-gasto-pagado-inline" data-gasto-id="${gasto.id}">
      <p>${escaparHtmlHonorarios(gasto.descripcion)}: ${formatearGuaranies(gasto.monto)}</p>
      <div class="grilla-form-inline">
        <div class="fila-form">
          <label>Fecha de Pago</label>
          <input type="date" class="campo-gasto-fecha-pago" value="${formatearFechaISO(new Date())}" />
        </div>
        <div class="fila-form">
          <label>Forma de Pago</label>
          <select class="campo-gasto-forma-pago">
            <option value="efectivo" selected>Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        <div class="fila-form">
          <label>N° de Recibo</label>
          <input type="text" class="campo-gasto-recibo" placeholder="Ej: 0231" spellcheck="true" />
        </div>
      </div>
      <div class="acciones-form">
        <button type="submit" class="boton boton-primario boton-chico">Marcar Pagado</button>
        <button type="button" class="boton boton-secundario boton-chico" data-cancelar-marcar-gasto>Cancelar</button>
      </div>
    </form>
  `;
}

function construirFormularioOtrosGastosHtml(cliente) {
  return `
    <div class="detalle-cliente-inline">
      <h3 class="fila-form-titulo">Otros Gastos — ${escaparHtmlHonorarios(cliente.razon_social)}</h3>
      ${construirListaOtrosGastosPendientesHtml(cliente.id)}
      <form class="form-nuevo-gasto-inline" data-cliente-id="${cliente.id}">
        <h3 class="fila-form-titulo">Cargar gasto nuevo</h3>
        <div class="grilla-form-inline">
          <div class="fila-form">
            <label>Descripción</label>
            <input type="text" class="campo-gasto-descripcion" required spellcheck="true" placeholder="Ej: Trámite de habilitación municipal" />
          </div>
          <div class="fila-form">
            <label>Monto (Gs.)</label>
            <input type="text" inputmode="numeric" class="campo-gasto-monto" required />
          </div>
          <div class="fila-form">
            <label>Fecha del Cargo</label>
            <input type="date" class="campo-gasto-fecha-cargo" value="${formatearFechaISO(new Date())}" />
          </div>
        </div>
        <div class="acciones-form">
          <button type="submit" class="boton boton-primario boton-chico">Cargar Gasto</button>
          <button type="button" class="boton boton-secundario boton-chico" data-cancelar-inline>Cerrar</button>
        </div>
      </form>
    </div>
  `;
}

function abrirFormularioOtrosGastos(clienteId) {
  const cliente = clientesCacheHonorarios.find((c) => c.id === clienteId);
  if (!cliente) return;
  abrirFilaExpandible(clienteId, construirFormularioOtrosGastosHtml(cliente));
}

async function guardarGastoNuevoInline(form) {
  const clienteId = Number(form.dataset.clienteId);
  const descripcion = form.querySelector('.campo-gasto-descripcion').value.trim();
  const monto = Number(quitarPuntos(form.querySelector('.campo-gasto-monto').value));
  const fechaCargo = form.querySelector('.campo-gasto-fecha-cargo').value || formatearFechaISO(new Date());

  if (!descripcion) {
    mostrarMensajeHonorarios('Cargá una descripción para el gasto.', 'error');
    return;
  }
  if (!monto || monto <= 0) {
    mostrarMensajeHonorarios('Cargá un monto válido.', 'error');
    return;
  }

  try {
    const { error } = await supabaseHonorarios.from('otros_gastos_honorarios').insert({
      cliente_id: clienteId,
      descripcion,
      monto,
      fecha_cargo: fechaCargo,
    });
    if (error) throw error;

    mostrarMensajeHonorarios('Gasto cargado correctamente.');
    await cargarHonorarios();
  } catch (error) {
    console.error('Error al cargar el gasto:', error);
    mostrarMensajeHonorarios('No se pudo cargar el gasto.', 'error');
  }
}

async function guardarGastoPagadoInline(form) {
  const gastoId = Number(form.dataset.gastoId);
  const fechaPago = form.querySelector('.campo-gasto-fecha-pago').value || formatearFechaISO(new Date());
  const formaPago = form.querySelector('.campo-gasto-forma-pago').value;
  const numeroRecibo = form.querySelector('.campo-gasto-recibo').value.trim() || null;

  try {
    const { error } = await supabaseHonorarios
      .from('otros_gastos_honorarios')
      .update({ pagado: true, fecha_pago: fechaPago, forma_pago: formaPago, numero_recibo: numeroRecibo })
      .eq('id', gastoId);
    if (error) throw error;

    mostrarMensajeHonorarios('Gasto marcado como pagado.');
    await cargarHonorarios();
  } catch (error) {
    console.error('Error al marcar el gasto como pagado:', error);
    mostrarMensajeHonorarios('No se pudo marcar el gasto como pagado.', 'error');
  }
}

// --- Detalle de pagos de un cliente ---------------------------------------

// Fila de una tabla de pagos (Historial de Pagos o el detalle de un
// cliente comparten exactamente el mismo formato de fila, con botón
// "Editar" -- así se reutiliza el mismo mini-formulario de pago para
// corregir un pago desde cualquiera de los dos lugares).
function construirFilaPagoHtml(pago, cliente) {
  return `
    <tr data-fila-pago-id="${pago.id}">
      <td>${escaparHtmlHonorarios(cliente ? cliente.razon_social : 'Cliente eliminado')}</td>
      <td>${pago.tipo_honorario === 'mensual' ? 'Cuota Mensual' : 'Cuota Anual'}</td>
      <td>${formatearGuaranies(pago.monto_pagado)}</td>
      <td>${formatearFormaPago(pago.forma_pago)}</td>
      <td>${pago.numero_recibo ? escaparHtmlHonorarios(pago.numero_recibo) : '—'}</td>
      <td>${formatearFechaVisibleHonorarios(pago.fecha_pago)}</td>
      <td>${formatearFechaVisibleHonorarios(pago.periodo)}</td>
      <td><button type="button" class="boton boton-chico" data-editar-pago-id="${pago.id}">Editar</button></td>
    </tr>
  `;
}

// Lista COMPLETA (pagados y pendientes) de "otros gastos" de un cliente,
// para el Detalle -- a diferencia de construirListaOtrosGastosPendientesHtml
// (usada en el panel de "Otros Gastos", que solo lista los pendientes
// porque ahí lo que importa es poder marcarlos pagados), acá es de solo
// lectura, sin botones de acción.
function construirListaOtrosGastosDetalleHtml(clienteId) {
  const gastos = otrosGastosCache
    .filter((gasto) => gasto.cliente_id === clienteId)
    .sort((a, b) => (a.fecha_cargo < b.fecha_cargo ? 1 : -1));

  if (gastos.length === 0) {
    return '<p class="sin-datos">Este cliente no tiene otros gastos cargados.</p>';
  }

  return `
    <ul class="lista-resumen-importacion">
      ${gastos
        .map((gasto) => {
          const detallePago = gasto.pagado
            ? ` -- pagado el ${formatearFechaVisibleHonorarios(gasto.fecha_pago)} (${formatearFormaPago(gasto.forma_pago)}${gasto.numero_recibo ? `, recibo ${escaparHtmlHonorarios(gasto.numero_recibo)}` : ''})`
            : ' -- <strong>pendiente</strong>';
          return `<li>${escaparHtmlHonorarios(gasto.descripcion)}: ${formatearGuaranies(gasto.monto)} -- cargado el ${formatearFechaVisibleHonorarios(gasto.fecha_cargo)}${detallePago}</li>`;
        })
        .join('')}
    </ul>`;
}

function construirDetalleClienteHtml(cliente) {
  const honorario = honorariosCache.find((h) => h.cliente_id === cliente.id);
  const resultado = calcularEstadoHonorario(honorario, cliente);

  const pagosCliente = pagosCache
    .filter((pago) => pago.cliente_id === cliente.id)
    .sort((a, b) => (a.fecha_pago < b.fecha_pago ? 1 : -1));

  const filasHtml = pagosCliente.length
    ? pagosCliente.map((pago) => construirFilaPagoHtml(pago, cliente)).join('')
    : `<tr><td colspan="${PAGO_COLSPAN}" class="sin-datos">Todavía no se registró ningún pago.</td></tr>`;

  const badgesDeudaCongelada = dibujarBadgesDeudaCongelada(cliente.id);
  const badgeOtrosGastos = dibujarBadgeOtrosGastos(cliente.id);

  return `
    <div class="detalle-cliente-inline">
      <h3 class="fila-form-titulo">Historial de Pagos — ${escaparHtmlHonorarios(cliente.razon_social)}</h3>
      <p>Saldo pendiente: ${dibujarBadgeEstado(resultado)}</p>
      ${badgesDeudaCongelada ? `<p>${badgesDeudaCongelada}</p>` : ''}
      ${badgeOtrosGastos ? `<p>${badgeOtrosGastos}</p>` : ''}
      <div class="tabla-scroll">
        <table class="tabla-clientes">
          <thead>
            <tr>
              <th>Cliente</th><th>Corresponde a</th><th>Monto</th><th>Forma de Pago</th>
              <th>N° Recibo</th><th>Fecha de Pago</th><th>Período</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>${filasHtml}</tbody>
        </table>
      </div>
      <h3 class="fila-form-titulo">Otros Gastos — ${escaparHtmlHonorarios(cliente.razon_social)}</h3>
      ${construirListaOtrosGastosDetalleHtml(cliente.id)}
      <div class="acciones-form">
        <button type="button" class="boton boton-secundario boton-chico" data-cancelar-inline>Cerrar</button>
      </div>
    </div>
  `;
}

function abrirDetalleCliente(clienteId) {
  const cliente = clientesCacheHonorarios.find((c) => c.id === clienteId);
  if (!cliente) return;
  abrirFilaExpandible(clienteId, construirDetalleClienteHtml(cliente));
}

// Reemplaza, en el lugar, la fila de un pago por el mini-formulario de
// edición precargado con sus valores actuales. Funciona tanto para una
// fila de #tabla-pagos-body como para una fila dentro del detalle de un
// cliente (ambas comparten data-fila-pago-id y el mismo formato).
function abrirEdicionPagoEnFila(fila, pagoId) {
  const pago = pagosCache.find((p) => p.id === pagoId);
  if (!pago) return;
  const cliente = clientesCacheHonorarios.find((c) => c.id === pago.cliente_id);
  const honorario = honorariosCache.find((h) => h.cliente_id === pago.cliente_id);
  if (!cliente || !honorario) return;

  fila.innerHTML = `<td colspan="${PAGO_COLSPAN}">${construirFormularioPagoHtml(cliente, honorario, pago)}</td>`;
}

// --- Manejo de eventos: tabla de Honorarios (fila del cliente) -----------

elTablaHonorariosBody.addEventListener('change', (evento) => {
  const casillaPagar = evento.target.closest('input[data-pagar-cliente]');
  if (casillaPagar) {
    const clienteId = Number(casillaPagar.dataset.pagarCliente);
    if (casillaPagar.checked) {
      abrirFormularioPago(clienteId);
    } else {
      cerrarFilaExpandible(clienteId);
    }
    return;
  }

  const selectTipo = evento.target.closest('.campo-pago-tipo');
  if (selectTipo && selectTipo.tagName === 'SELECT') {
    actualizarCamposSegunTipoInline(selectTipo);
    return;
  }

  // Desplegable "Acciones" de la columna de la tabla (reemplaza a los 4
  // botones sueltos "Editar cuota"/"Detalle"/"Deuda congelada"/"Otros
  // Gastos" que tenía antes, para que la columna quede más limpia). Cada
  // elección dispara la misma función que disparaba su botón equivalente,
  // y el selector vuelve solo al placeholder "Acciones ▾" después.
  const selectorAcciones = evento.target.closest('select[data-acciones-cliente-id]');
  if (selectorAcciones) {
    const clienteId = Number(selectorAcciones.dataset.accionesClienteId);
    const accion = selectorAcciones.value;
    selectorAcciones.value = '';

    if (accion === 'editar-cuota') abrirFormularioEditarCuota(clienteId);
    else if (accion === 'detalle') abrirDetalleCliente(clienteId);
    else if (accion === 'deuda-congelada') abrirFormularioCongelarDeuda(clienteId);
    else if (accion === 'otros-gastos') abrirFormularioOtrosGastos(clienteId);
  }
});

// Formato de miles en vivo para los inputs de dinero de los mini-formularios
// (pago, editar cuota y congelar deuda), armados dinámicamente dentro de
// esta tabla.
elTablaHonorariosBody.addEventListener('input', (evento) => {
  const campoDinero = evento.target.closest('.campo-pago-monto, .campo-cuota-mensual, .campo-cuota-anual, .campo-deuda-monto, .campo-gasto-monto');
  if (campoDinero) formatearInputDineroEnVivo(campoDinero);
});

elTablaHonorariosBody.addEventListener('click', (evento) => {
  const botonFicha = evento.target.closest('button[data-ficha-cliente-id]');
  if (botonFicha) {
    const clienteId = Number(botonFicha.dataset.fichaClienteId);
    const cliente = clientesCacheHonorarios.find((c) => c.id === clienteId);
    const honorario = honorariosCache.find((h) => h.cliente_id === clienteId);
    if (cliente && honorario) generarFichaPago(cliente, honorario);
    return;
  }

  const botonMarcarDeudaPagada = evento.target.closest('button[data-marcar-deuda-pagada-id]');
  if (botonMarcarDeudaPagada) {
    marcarDeudaCongeladaPagada(Number(botonMarcarDeudaPagada.dataset.marcarDeudaPagadaId));
    return;
  }

  const botonMarcarGastoPagado = evento.target.closest('button[data-marcar-gasto-pagado-id]');
  if (botonMarcarGastoPagado) {
    const gastoId = Number(botonMarcarGastoPagado.dataset.marcarGastoPagadoId);
    const gasto = otrosGastosCache.find((g) => g.id === gastoId);
    const filaGasto = evento.target.closest('li[data-fila-gasto-id]');
    if (gasto && filaGasto) filaGasto.innerHTML = construirSubformularioMarcarGastoPagadoHtml(gasto);
    return;
  }

  const botonCancelarMarcarGasto = evento.target.closest('[data-cancelar-marcar-gasto]');
  if (botonCancelarMarcarGasto) {
    const filaExpandible = evento.target.closest('tr.fila-expandible');
    if (filaExpandible) abrirFormularioOtrosGastos(Number(filaExpandible.dataset.expandibleId));
    return;
  }

  const botonEditarPago = evento.target.closest('button[data-editar-pago-id]');
  if (botonEditarPago) {
    const filaPago = evento.target.closest('tr[data-fila-pago-id]');
    if (filaPago) abrirEdicionPagoEnFila(filaPago, Number(botonEditarPago.dataset.editarPagoId));
    return;
  }

  const botonCancelar = evento.target.closest('[data-cancelar-inline]');
  if (botonCancelar) {
    const filaPago = evento.target.closest('tr[data-fila-pago-id]');
    const filaExpandible = evento.target.closest('tr.fila-expandible');
    if (filaPago && filaExpandible) {
      // Estábamos corrigiendo un pago dentro del detalle de un cliente:
      // volvemos a pintar el detalle completo (sin volver a pedir datos).
      abrirDetalleCliente(Number(filaExpandible.dataset.expandibleId));
      return;
    }
    if (filaExpandible) cerrarFilaExpandible(Number(filaExpandible.dataset.expandibleId));
  }
});

elTablaHonorariosBody.addEventListener('submit', async (evento) => {
  const formPago = evento.target.closest('form.form-pago-inline');
  if (formPago) {
    evento.preventDefault();
    await guardarPagoInline(formPago);
    return;
  }

  const formCuota = evento.target.closest('form.form-editar-cuota-inline');
  if (formCuota) {
    evento.preventDefault();
    await guardarCuotaInline(formCuota);
    return;
  }

  const formDeuda = evento.target.closest('form.form-congelar-deuda-inline');
  if (formDeuda) {
    evento.preventDefault();
    await guardarDeudaCongeladaInline(formDeuda);
    return;
  }

  const formNuevoGasto = evento.target.closest('form.form-nuevo-gasto-inline');
  if (formNuevoGasto) {
    evento.preventDefault();
    await guardarGastoNuevoInline(formNuevoGasto);
    return;
  }

  const formMarcarGastoPagado = evento.target.closest('form.form-marcar-gasto-pagado-inline');
  if (formMarcarGastoPagado) {
    evento.preventDefault();
    await guardarGastoPagadoInline(formMarcarGastoPagado);
  }
});

// --- Historial de pagos: filtro por período y edición en línea -----------

// Puebla el filtro de año con los años que realmente tienen pagos
// registrados (según pagos_honorarios.periodo), para no mostrar años
// vacíos en el desplegable.
function poblarFiltroAnioPagos() {
  if (!elPagosFiltroAnio) return;

  const seleccionActual = elPagosFiltroAnio.value;
  const aniosDisponibles = [...new Set(pagosCache.map((pago) => pago.periodo.split('-')[0]))].sort((a, b) => b - a);

  elPagosFiltroAnio.innerHTML = '<option value="">Todos</option>'
    + aniosDisponibles.map((anio) => `<option value="${anio}">${anio}</option>`).join('');

  if (aniosDisponibles.includes(seleccionActual)) elPagosFiltroAnio.value = seleccionActual;
}

// Filtra por período (año, y opcionalmente mes) -- para la cuota anual el
// período siempre cae en enero (1° de enero del ejercicio), así que un
// filtro de mes distinto de "Todos"/Enero naturalmente no muestra pagos
// anuales, lo cual es esperable.
function filtrarPagosParaTabla() {
  const anio = elPagosFiltroAnio ? elPagosFiltroAnio.value : '';
  const mes = elPagosFiltroMes ? elPagosFiltroMes.value : '';

  return pagosCache.filter((pago) => {
    const [anioPago, mesPago] = pago.periodo.split('-');
    if (anio && anioPago !== anio) return false;
    if (mes && Number(mesPago) !== Number(mes)) return false;
    return true;
  });
}

if (elPagosFiltroAnio) elPagosFiltroAnio.addEventListener('change', dibujarTablaPagos);
if (elPagosFiltroMes) elPagosFiltroMes.addEventListener('change', dibujarTablaPagos);

function dibujarTablaPagos() {
  elTablaPagosBody.innerHTML = '';

  const pagosFiltrados = filtrarPagosParaTabla();

  if (pagosFiltrados.length === 0) {
    elSinPagos.classList.remove('oculto');
    return;
  }
  elSinPagos.classList.add('oculto');

  for (const pago of pagosFiltrados) {
    const cliente = clientesCacheHonorarios.find((c) => c.id === pago.cliente_id);
    elTablaPagosBody.insertAdjacentHTML('beforeend', construirFilaPagoHtml(pago, cliente));
  }
}

elTablaPagosBody.addEventListener('click', (evento) => {
  const botonEditarPago = evento.target.closest('button[data-editar-pago-id]');
  if (botonEditarPago) {
    const filaPago = evento.target.closest('tr[data-fila-pago-id]');
    if (filaPago) abrirEdicionPagoEnFila(filaPago, Number(botonEditarPago.dataset.editarPagoId));
    return;
  }

  const botonCancelar = evento.target.closest('[data-cancelar-inline]');
  if (botonCancelar) {
    // Simplemente volvemos a dibujar la tabla desde la caché (sin pedir
    // datos de nuevo): descarta la edición en curso y restaura la fila.
    dibujarTablaPagos();
  }
});

elTablaPagosBody.addEventListener('submit', async (evento) => {
  const formPago = evento.target.closest('form.form-pago-inline');
  if (!formPago) return;
  evento.preventDefault();
  await guardarPagoInline(formPago);
});

// --- Ficha de pago descargable (PDF vía diálogo de impresión) -------------

function construirTablaMensualFicha(cliente, honorario, anio) {
  let totalPagado = 0;
  let filas = '';

  for (let mes = 1; mes <= 12; mes += 1) {
    const periodoISO = formatearFechaISO(new Date(anio, mes - 1, 1));
    const pago = pagosCache.find(
      (p) => p.cliente_id === cliente.id && p.tipo_honorario === 'mensual' && p.periodo === periodoISO
    );
    if (pago) totalPagado += Number(pago.monto_pagado);

    filas += `
      <tr>
        <td>${NOMBRES_MES_COMPLETOS[mes - 1]}</td>
        <td>${anio}</td>
        <td class="num">${Number(honorario.monto_mensual).toLocaleString('es-PY')}</td>
        <td>${pago ? formatearFormaPago(pago.forma_pago) : ''}</td>
        <td>${pago?.numero_recibo ? escaparHtmlHonorarios(pago.numero_recibo) : ''}</td>
        <td>${pago ? formatearFechaVisibleHonorarios(pago.fecha_pago) : ''}</td>
        <td></td>
      </tr>
    `;
  }

  const totalPactado = Number(honorario.monto_mensual) * 12;
  const debe = Math.max(totalPactado - totalPagado, 0);

  return `
    <table class="ficha-tabla">
      <thead>
        <tr>
          <th>Mes</th><th>Año</th><th>Monto Gs.</th><th>Forma de Pago</th>
          <th>Recibo N°</th><th>Fecha de Pago</th><th>Firma</th>
        </tr>
      </thead>
      <tbody>
        ${filas}
        <tr class="ficha-balance">
          <td colspan="2">Balance Anual</td>
          <td class="num">${totalPactado.toLocaleString('es-PY')}</td>
          <td colspan="4">Pagado: Gs. ${totalPagado.toLocaleString('es-PY')} · Debe: Gs. ${debe.toLocaleString('es-PY')}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function construirTablaAnualFicha(cliente, honorario, anio) {
  const periodoISO = formatearFechaISO(new Date(anio, 0, 1));
  const pagosDelAnio = pagosCache.filter(
    (p) => p.cliente_id === cliente.id && p.tipo_honorario === 'anual' && p.periodo === periodoISO
  );
  const totalPagado = pagosDelAnio.reduce((total, p) => total + Number(p.monto_pagado), 0);
  const ultimoPago = pagosDelAnio[0];
  const debe = Math.max(Number(honorario.monto_anual) - totalPagado, 0);

  return `
    <p class="ficha-seccion-titulo">Obligaciones IVA e IRE (anual)</p>
    <table class="ficha-tabla">
      <thead>
        <tr>
          <th>Obligación</th><th>Año</th><th>Monto Gs.</th><th>Forma de Pago</th>
          <th>Recibo N°</th><th>Fecha de Pago</th><th>Firma</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>IVA / IRE</td>
          <td>${anio}</td>
          <td class="num">${Number(honorario.monto_anual).toLocaleString('es-PY')}</td>
          <td>${ultimoPago ? formatearFormaPago(ultimoPago.forma_pago) : ''}</td>
          <td>${ultimoPago?.numero_recibo ? escaparHtmlHonorarios(ultimoPago.numero_recibo) : ''}</td>
          <td>${ultimoPago ? formatearFechaVisibleHonorarios(ultimoPago.fecha_pago) : ''}</td>
          <td></td>
        </tr>
        <tr class="ficha-balance">
          <td colspan="2">Balance Anual</td>
          <td class="num">${Number(honorario.monto_anual).toLocaleString('es-PY')}</td>
          <td colspan="4">Pagado: Gs. ${totalPagado.toLocaleString('es-PY')} · Debe: Gs. ${debe.toLocaleString('es-PY')}</td>
        </tr>
      </tbody>
    </table>
  `;
}

// Arma la ficha de pago del cliente en #ficha-pago-contenido y la muestra
// en pantalla como previsualización (ya no llama a window.print() directo
// -- eso queda para cuando se toca "Imprimir / Guardar PDF" en la barra de
// acciones, ver el listener más abajo). El membrete usa los datos propios
// del cliente si los tiene cargados (clientes.membrete_*), y si no, el
// membrete general de configuracion_estudio -- incluyendo el logo
// (configuracion_estudio.logo_base64) si hay uno cargado; si no hay logo,
// la ficha se ve igual que siempre.
function generarFichaPago(cliente, honorario) {
  const anioActual = new Date().getFullYear();
  const nombreEstudio = cliente.membrete_nombre || configuracionEstudio?.nombre_estudio || 'Estudio Contable';
  const direccion = cliente.membrete_direccion || configuracionEstudio?.direccion || '';
  const telefono = cliente.membrete_telefono || configuracionEstudio?.telefono || '';
  const notaVencimiento = configuracionEstudio?.nota_vencimiento || '';
  const logoHtml = configuracionEstudio?.logo_base64
    ? `<img src="${configuracionEstudio.logo_base64}" alt="Logo del estudio" class="ficha-logo" />`
    : '';

  let html = `
    <div class="ficha-membrete">
      <div>
        <h1>${escaparHtmlHonorarios(nombreEstudio)}</h1>
        ${direccion ? `<p>${escaparHtmlHonorarios(direccion)}</p>` : ''}
        ${telefono ? `<p>Tel: ${escaparHtmlHonorarios(telefono)}</p>` : ''}
      </div>
      ${logoHtml}
    </div>
    ${notaVencimiento ? `<p class="ficha-nota-vencimiento">${escaparHtmlHonorarios(notaVencimiento)}</p>` : ''}
    <div class="ficha-cliente-banner">${escaparHtmlHonorarios(cliente.razon_social)}</div>
  `;

  if (honorario.monto_mensual) {
    html += construirTablaMensualFicha(cliente, honorario, anioActual);
  }
  if (honorario.monto_anual) {
    html += construirTablaAnualFicha(cliente, honorario, anioActual);
  }

  elFichaContenido.innerHTML = html;
  elFichaImprimir.classList.remove('oculto');
}

if (elBtnFichaImprimir) {
  elBtnFichaImprimir.addEventListener('click', () => window.print());
}

if (elBtnFichaCerrar) {
  elBtnFichaCerrar.addEventListener('click', () => elFichaImprimir.classList.add('oculto'));
}

// Tocar el fondo (fuera de la tarjeta de la ficha) cierra la previsualización,
// mismo criterio que un modal común -- clickear la ficha en sí no la cierra.
elFichaImprimir.addEventListener('click', (evento) => {
  if (evento.target === elFichaImprimir) elFichaImprimir.classList.add('oculto');
});

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarHonorarios = cargarHonorarios;

cargarHonorarios();

})();
