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
const { leerFilasDeArchivoExcel, descargarComoExcel, celdaTexto, celdaNumero, ErrorLibreriaExcelNoDisponible } = require('./js/excel-utils.js');
const { formatearConPuntos, quitarPuntos } = require('./js/formato-numeros.js');

const elHonorariosMensaje = document.getElementById('honorarios-mensaje');
const elHonorariosBuscar = document.getElementById('honorarios-buscar');
const elFiltroCartera = document.getElementById('honorarios-filtro-cartera');

const elBtnImportarPagos = document.getElementById('btn-importar-pagos-excel');
const elInputImportarPagos = document.getElementById('input-importar-pagos-excel');
const elBtnExportarHonorarios = document.getElementById('btn-exportar-honorarios-excel');
const elImportarResumenHonorarios = document.getElementById('honorarios-importar-resumen');
const elImportarResumenHonorariosTitulo = document.getElementById('honorarios-importar-resumen-titulo');
const elImportarResumenHonorariosTexto = document.getElementById('honorarios-importar-resumen-texto');
const elImportarResumenHonorariosDetalle = document.getElementById('honorarios-importar-resumen-detalle');

const elTablaHonorariosBody = document.getElementById('tabla-honorarios-body');
const elSinHonorarios = document.getElementById('sin-honorarios');

const elSeccionHonorariosAnual = document.getElementById('seccion-honorarios-anual');
const elTablaHonorariosAnualBody = document.getElementById('tabla-honorarios-anual-body');

const elPagosFiltroAnio = document.getElementById('pagos-filtro-anio');
const elPagosFiltroMes = document.getElementById('pagos-filtro-mes');
const elTablaPagosBody = document.getElementById('tabla-pagos-body');
const elSinPagos = document.getElementById('sin-pagos');

const elFichaImprimir = document.getElementById('ficha-pago-imprimir');

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

async function cargarPerfiles() {
  const { data, error } = await supabaseHonorarios.from('perfiles').select('id, nombre').order('nombre');
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

async function cargarHonorarios() {
  if (!supabaseHonorarios) return;

  try {
    const [
      { data: clientes, error: errorClientes },
      { data: honorarios, error: errorHonorarios },
      { data: pagos, error: errorPagos },
      { data: deudasCongeladas, error: errorDeudasCongeladas },
      { data: configuracion, error: errorConfiguracion },
    ] = await Promise.all([
      supabaseHonorarios
        .from('clientes')
        .select('id, razon_social, ruc, cierre_fiscal_mes, membrete_nombre, membrete_direccion, membrete_telefono, responsable_id')
        .order('razon_social'),
      supabaseHonorarios.from('honorarios').select('*'),
      supabaseHonorarios.from('pagos_honorarios').select('*').order('fecha_pago', { ascending: false }),
      supabaseHonorarios.from('deudas_congeladas_honorarios').select('*'),
      supabaseHonorarios.from('configuracion_estudio').select('*').eq('id', 1).maybeSingle(),
    ]);

    if (errorClientes) throw errorClientes;
    if (errorHonorarios) throw errorHonorarios;
    if (errorPagos) throw errorPagos;
    if (errorDeudasCongeladas) throw errorDeudasCongeladas;
    if (errorConfiguracion) throw errorConfiguracion;

    clientesCacheHonorarios = clientes || [];
    honorariosCache = honorarios || [];
    pagosCache = pagos || [];
    deudasCongeladasCache = deudasCongeladas || [];
    configuracionEstudio = configuracion || null;

    await Promise.all([cargarUsuarioActual(), cargarPerfiles()]);
    poblarFiltroCartera();

    dibujarTablaHonorarios();
    dibujarSeccionHonorariosAnual();
    poblarFiltroAnioPagos();
    dibujarTablaPagos();
    // La carga salió bien: si había quedado pegado un cartel de error de
    // un intento anterior (por ejemplo, el primero antes de loguearse), lo
    // ocultamos.
    if (elHonorariosMensaje) elHonorariosMensaje.classList.add('oculto');
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

// Cuenta cuántos períodos (meses o años) hay que pagar desde `fechaInicio`
// (honorarios.created_at, o el created_at de la deuda congelada pendiente
// más reciente si el cliente+tipo tiene una -- ver calcularSaldoPorTipo)
// hasta el período vigente, ambos inclusive. Nunca da menos de 1 para la
// cuota mensual.
function contarPeriodosAdeudables(fechaInicio, periodicidad, cierreFiscalMes) {
  const inicio = calcularAnclaPeriodo(fechaInicio, periodicidad, cierreFiscalMes);

  if (periodicidad === 'mensual') {
    const vigente = obtenerPeriodoVigente('mensual');
    const meses = (vigente.getFullYear() - inicio.getFullYear()) * 12 + (vigente.getMonth() - inicio.getMonth()) + 1;
    return Math.max(meses, 1);
  }

  const vigente = obtenerPeriodoVigente('anual', cierreFiscalMes);
  let anios = Math.max(vigente.getFullYear() - inicio.getFullYear() + 1, 1);

  // Regla de febrero (confirmada por el usuario): la cuota anual del
  // período vigente no cuenta como adeudada hasta febrero de cada año, sin
  // importar hace cuánto se configuró el honorario de ese cliente. Los
  // ejercicios anteriores (ya cerrados hace rato) siguen contando igual
  // que antes -- solo se descuenta el período vigente, y nunca por debajo
  // de cero.
  if (esEnero()) {
    anios = Math.max(anios - 1, 0);
  }

  return anios;
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
function calcularSaldoPorTipo(honorario, cliente, tipoHonorario) {
  const monto = tipoHonorario === 'mensual' ? honorario.monto_mensual : honorario.monto_anual;
  if (monto === null || monto === undefined) return null;

  const cierreFiscalMes = cliente?.cierre_fiscal_mes ?? 12;

  // Si hay una deuda vieja congelada pendiente para este cliente+tipo, el
  // cálculo corriente arranca de cero desde que se congeló (created_at de
  // la más reciente) en vez de arrancar desde honorarios.created_at -- sin
  // tocar ese created_at real, que sigue siendo la fecha de configuración
  // real del honorario por si se usa en otro lado.
  const deudaCongelada = deudaCongeladaPendienteMasReciente(honorario.cliente_id, tipoHonorario);
  const fechaInicio = deudaCongelada ? new Date(deudaCongelada.created_at) : new Date(honorario.created_at);

  const periodos = contarPeriodosAdeudables(fechaInicio, tipoHonorario, cierreFiscalMes);

  let pagosDelTipo = pagosCache.filter(
    (pago) => pago.cliente_id === honorario.cliente_id && pago.tipo_honorario === tipoHonorario
  );

  // Si el punto de partida se movió por una deuda congelada, los pagos de
  // períodos ANTERIORES a ese punto ya quedaron reflejados en el monto que
  // se congeló (lo tipeó quien la congeló) -- no se vuelven a restar acá,
  // porque si se restaran de nuevo un pago viejo contaría dos veces (una
  // en el monto congelado, otra acá) y el saldo corriente daría de menos.
  if (deudaCongelada) {
    const anclaPeriodoIso = formatearFechaISO(calcularAnclaPeriodo(fechaInicio, tipoHonorario, cierreFiscalMes));
    pagosDelTipo = pagosDelTipo.filter((pago) => pago.periodo >= anclaPeriodoIso);
  }

  const totalPagado = pagosDelTipo.reduce((total, pago) => total + Number(pago.monto_pagado), 0);

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

    const filaCliente = document.createElement('tr');
    filaCliente.innerHTML = `
      <td>${escaparHtmlHonorarios(cliente.razon_social)}</td>
      <td>${honorario?.monto_mensual ? formatearGuaranies(honorario.monto_mensual) : '—'}</td>
      <td>${honorario?.monto_anual ? formatearGuaranies(honorario.monto_anual) : '—'}</td>
      <td>${dibujarBadgeEstado(resultado)}${badgesDeudaCongelada ? `<br />${badgesDeudaCongelada}` : ''}</td>
      <td class="celda-checkbox"><input type="checkbox" data-pagar-cliente="${cliente.id}" ${honorario ? '' : 'disabled'} /></td>
      <td>
        <button type="button" class="boton boton-chico" data-ficha-cliente-id="${cliente.id}" ${honorario ? '' : 'disabled'}>Ficha</button>
        <button type="button" class="boton boton-chico" data-editar-cuota-id="${cliente.id}">Editar cuota</button>
        <button type="button" class="boton boton-chico" data-detalle-cliente-id="${cliente.id}">Detalle</button>
        <button type="button" class="boton boton-chico" data-congelar-deuda-id="${cliente.id}" ${honorario ? '' : 'disabled'}>Deuda congelada</button>
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
    elTablaHonorariosAnualBody.innerHTML = `<tr><td colspan="3" class="sin-datos">No hay clientes con cuota anual configurada.</td></tr>`;
    return;
  }

  for (const cliente of clientesConCuotaAnual) {
    const honorario = honorariosCache.find((h) => h.cliente_id === cliente.id);
    const saldoAnual = calcularSaldoPorTipo(honorario, cliente, 'anual') ?? 0;
    const estadoAnual = { estado: saldoAnual > 0 ? 'debe' : 'al_dia', saldoPendiente: saldoAnual };
    const badgesDeudaCongeladaAnual = dibujarBadgesDeudaCongelada(cliente.id, 'anual');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escaparHtmlHonorarios(cliente.razon_social)}</td>
      <td>${formatearGuaranies(honorario.monto_anual)}</td>
      <td>${dibujarBadgeEstado(estadoAnual)}${badgesDeudaCongeladaAnual ? `<br />${badgesDeudaCongeladaAnual}` : ''}</td>
    `;
    elTablaHonorariosAnualBody.appendChild(tr);
  }
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

  return `
    <div class="detalle-cliente-inline">
      <h3 class="fila-form-titulo">Historial de Pagos — ${escaparHtmlHonorarios(cliente.razon_social)}</h3>
      <p>Saldo pendiente: ${dibujarBadgeEstado(resultado)}</p>
      ${badgesDeudaCongelada ? `<p>${badgesDeudaCongelada}</p>` : ''}
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
  }
});

// Formato de miles en vivo para los inputs de dinero de los mini-formularios
// (pago, editar cuota y congelar deuda), armados dinámicamente dentro de
// esta tabla.
elTablaHonorariosBody.addEventListener('input', (evento) => {
  const campoDinero = evento.target.closest('.campo-pago-monto, .campo-cuota-mensual, .campo-cuota-anual, .campo-deuda-monto');
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

  const botonEditarCuota = evento.target.closest('button[data-editar-cuota-id]');
  if (botonEditarCuota) {
    abrirFormularioEditarCuota(Number(botonEditarCuota.dataset.editarCuotaId));
    return;
  }

  const botonDetalle = evento.target.closest('button[data-detalle-cliente-id]');
  if (botonDetalle) {
    abrirDetalleCliente(Number(botonDetalle.dataset.detalleClienteId));
    return;
  }

  const botonCongelarDeuda = evento.target.closest('button[data-congelar-deuda-id]');
  if (botonCongelarDeuda) {
    abrirFormularioCongelarDeuda(Number(botonCongelarDeuda.dataset.congelarDeudaId));
    return;
  }

  const botonMarcarDeudaPagada = evento.target.closest('button[data-marcar-deuda-pagada-id]');
  if (botonMarcarDeudaPagada) {
    marcarDeudaCongeladaPagada(Number(botonMarcarDeudaPagada.dataset.marcarDeudaPagadaId));
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

// Arma la ficha de pago del cliente en #ficha-pago-imprimir y dispara el
// diálogo de impresión de Electron (desde ahí se puede elegir "Guardar
// como PDF"). El membrete usa los datos propios del cliente si los tiene
// cargados (clientes.membrete_*), y si no, el membrete general de
// configuracion_estudio -- incluyendo el logo (configuracion_estudio.logo_base64)
// si hay uno cargado; si no hay logo, la ficha se ve igual que siempre.
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

  elFichaImprimir.innerHTML = html;
  window.print();
}

// --- Importar / Exportar Excel --------------------------------------------
//
// La cuota mensual/anual pactada YA NO se importa desde acá -- se sacó el
// botón "Importar Cuotas desde Excel" que existía antes: ahora esas dos
// columnas se cargan junto con el resto de los datos del cliente en el
// importador de Clientes (ver importarClientesDesdeExcel en js/clientes.js).
// Acá solo queda el importador del historial de pagos, más un exportador
// único con dos hojas (Honorarios + Historial de Pagos, ver
// exportarHonorariosAExcel). El bloque de resumen
// (#honorarios-importar-resumen) sigue existiendo por si en el futuro se
// suma otro importador a esta pantalla.

function mostrarResumenImportacionHonorarios(titulo, resumenTexto, filasSalteadas) {
  elImportarResumenHonorariosTitulo.textContent = titulo;
  elImportarResumenHonorariosTexto.textContent =
    resumenTexto + (filasSalteadas.length > 0 ? ` ${filasSalteadas.length} fila(s) salteada(s) (detalle abajo).` : '');
  elImportarResumenHonorariosDetalle.innerHTML = filasSalteadas
    .map((item) => `<li>Fila ${item.fila}: ${escaparHtmlHonorarios(item.motivo)}</li>`)
    .join('');
  elImportarResumenHonorarios.classList.remove('oculto');
}

// Acepta una celda de fecha ya convertida a Date por SheetJS (cellDates:
// true, ver excel-utils.js) o texto en "yyyy-mm-dd"/"dd/mm/yyyy". Devuelve
// la fecha en formato ISO (yyyy-mm-dd) o null si no se pudo interpretar.
function parsearFechaDeCeldaHonorarios(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return formatearFechaISO(valor);
  }

  const texto = celdaTexto(valor);
  if (!texto) return null;

  let coincidencia = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (coincidencia) {
    const [, anio, mes, dia] = coincidencia;
    return formatearFechaISO(new Date(Number(anio), Number(mes) - 1, Number(dia)));
  }

  coincidencia = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (coincidencia) {
    const [, dia, mes, anio] = coincidencia;
    return formatearFechaISO(new Date(Number(anio), Number(mes) - 1, Number(dia)));
  }

  return null;
}

// --- Importar Historial de Pagos -------------------------------------------
//
// Columnas esperadas: "RUC", "Corresponde a" (Mensual/Anual), "Monto",
// "Período - Mes" (1-12, solo obligatorio si Corresponde a = Mensual),
// "Período - Año", "Forma de Pago" (Efectivo/Transferencia/Cheque), "N°
// de Recibo" (opcional) y "Fecha de Pago". Cada fila válida hace un
// INSERT en `pagos_honorarios` -- son pagos históricos, no se intenta
// detectar duplicados (confirmado: reimportar el mismo archivo duplica
// los pagos, aceptable para una carga inicial). Si el RUC no existe en
// `clientes`, la fila se saltea con "cliente no encontrado".
async function importarPagosDesdeExcel(archivo) {
  if (!supabaseHonorarios) return;

  elBtnImportarPagos.disabled = true;
  elImportarResumenHonorarios.classList.add('oculto');

  try {
    const filas = await leerFilasDeArchivoExcel(archivo);

    const { data: clientes, error: errorClientes } = await supabaseHonorarios.from('clientes').select('id, ruc');
    if (errorClientes) throw errorClientes;

    const idPorRuc = new Map((clientes || []).map((c) => [c.ruc.trim(), c.id]));

    let insertados = 0;
    const filasSalteadas = [];

    for (let i = 0; i < filas.length; i += 1) {
      const numeroFila = i + 2;
      const fila = filas[i];

      try {
        const ruc = celdaTexto(fila['RUC']);
        if (!ruc) throw new Error('RUC vacío.');

        const clienteId = idPorRuc.get(ruc);
        if (!clienteId) throw new Error('cliente no encontrado');

        const correspondeA = celdaTexto(fila['Corresponde a']).toLowerCase();
        const tipo = correspondeA.startsWith('mensual') ? 'mensual' : correspondeA.startsWith('anual') ? 'anual' : null;
        if (!tipo) throw new Error('"Corresponde a" debe ser "Mensual" o "Anual".');

        const monto = celdaNumero(fila['Monto']);
        if (monto === null || monto <= 0) throw new Error('Monto inválido.');

        const anio = celdaNumero(fila['Período - Año']);
        if (anio === null) throw new Error('Período - Año es obligatorio.');

        let periodoIso;
        if (tipo === 'mensual') {
          const mes = celdaNumero(fila['Período - Mes']);
          if (mes === null || mes < 1 || mes > 12) {
            throw new Error('Período - Mes debe estar entre 1 y 12 para la cuota mensual.');
          }
          periodoIso = formatearFechaISO(new Date(anio, mes - 1, 1));
        } else {
          periodoIso = formatearFechaISO(new Date(anio, 0, 1));
        }

        const formaPagoTexto = celdaTexto(fila['Forma de Pago']).toLowerCase();
        const formaPago = ['efectivo', 'transferencia', 'cheque'].includes(formaPagoTexto) ? formaPagoTexto : null;
        if (!formaPago) throw new Error('Forma de Pago debe ser Efectivo, Transferencia o Cheque.');

        const numeroRecibo = celdaTexto(fila['N° de Recibo']) || null;

        const fechaPago = parsearFechaDeCeldaHonorarios(fila['Fecha de Pago']);
        if (!fechaPago) throw new Error('Fecha de Pago inválida (se espera dd/mm/aaaa o una fecha de Excel).');

        const { error } = await supabaseHonorarios.from('pagos_honorarios').insert({
          cliente_id: clienteId,
          tipo_honorario: tipo,
          monto_pagado: monto,
          forma_pago: formaPago,
          numero_recibo: numeroRecibo,
          fecha_pago: fechaPago,
          periodo: periodoIso,
        });
        if (error) throw error;

        insertados += 1;
      } catch (errorFila) {
        console.error(`Error al importar la fila ${numeroFila} del Excel de pagos:`, errorFila);
        filasSalteadas.push({ fila: numeroFila, motivo: errorFila.message || 'Error desconocido.' });
      }
    }

    mostrarResumenImportacionHonorarios(
      'Importar Historial de Pagos',
      `Importación de Historial de Pagos terminada: ${insertados} pago(s) registrado(s).`,
      filasSalteadas
    );

    if (insertados > 0) await cargarHonorarios();
  } catch (error) {
    console.error('Error al importar pagos desde Excel:', error);
    if (error instanceof ErrorLibreriaExcelNoDisponible) {
      mostrarMensajeHonorarios(error.message, 'error');
    } else {
      mostrarMensajeHonorarios('No se pudo leer el archivo. Verificá que sea un .xlsx con el formato esperado.', 'error');
    }
  } finally {
    elBtnImportarPagos.disabled = false;
    elInputImportarPagos.value = '';
  }
}

if (elBtnImportarPagos && elInputImportarPagos) {
  elBtnImportarPagos.addEventListener('click', () => elInputImportarPagos.click());
  elInputImportarPagos.addEventListener('change', () => {
    const archivo = elInputImportarPagos.files[0];
    if (archivo) importarPagosDesdeExcel(archivo);
  });
}

// --- Exportar Honorarios a Excel --------------------------------------------
//
// Descarga TODOS los clientes (sin aplicar el filtro de cartera ni el
// buscador de esta pantalla, mismo criterio que la exportación de
// Clientes) en dos hojas: "Honorarios" (RUC, Razón Social, Cuota Mensual,
// Cuota Anual, Estado) e "Historial de Pagos" (mismas columnas que espera
// importarPagosDesdeExcel, más RUC/Razón Social) -- de forma que el
// archivo exportado sirva de respaldo completo y de plantilla para
// reimportar. Reutiliza clientesCacheHonorarios/honorariosCache/pagosCache
// ya cargados por cargarHonorarios(), sin pedir datos nuevos.
async function exportarHonorariosAExcel() {
  if (!supabaseHonorarios) return;

  elBtnExportarHonorarios.disabled = true;
  try {
    const filasHonorarios = clientesCacheHonorarios.map((cliente) => {
      const honorario = honorariosCache.find((h) => h.cliente_id === cliente.id);
      const resultado = calcularEstadoHonorario(honorario, cliente);
      return {
        'RUC': cliente.ruc,
        'Razón Social': cliente.razon_social,
        'Cuota Mensual': honorario?.monto_mensual ?? '',
        'Cuota Anual': honorario?.monto_anual ?? '',
        'Estado': resultado ? (resultado.estado === 'al_dia' ? 'Al día' : 'Debe') : 'Sin configurar',
      };
    });

    const filasPagos = pagosCache.map((pago) => {
      const cliente = clientesCacheHonorarios.find((c) => c.id === pago.cliente_id);
      const [anioPeriodo, mesPeriodo] = pago.periodo.split('-');
      return {
        'RUC': cliente?.ruc ?? '',
        'Razón Social': cliente?.razon_social ?? 'Cliente eliminado',
        'Corresponde a': pago.tipo_honorario === 'mensual' ? 'Mensual' : 'Anual',
        'Monto': Number(pago.monto_pagado),
        'Período - Mes': pago.tipo_honorario === 'mensual' ? Number(mesPeriodo) : '',
        'Período - Año': Number(anioPeriodo),
        'Forma de Pago': formatearFormaPago(pago.forma_pago),
        'N° de Recibo': pago.numero_recibo ?? '',
        'Fecha de Pago': pago.fecha_pago,
      };
    });

    await descargarComoExcel(`honorarios_${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { nombre: 'Honorarios', filas: filasHonorarios },
      { nombre: 'Historial de Pagos', filas: filasPagos },
    ]);
  } catch (error) {
    console.error('Error al exportar honorarios a Excel:', error);
    if (error instanceof ErrorLibreriaExcelNoDisponible) {
      mostrarMensajeHonorarios(error.message, 'error');
    } else {
      mostrarMensajeHonorarios('No se pudo exportar el Excel de honorarios.', 'error');
    }
  } finally {
    elBtnExportarHonorarios.disabled = false;
  }
}

if (elBtnExportarHonorarios) elBtnExportarHonorarios.addEventListener('click', exportarHonorariosAExcel);

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarHonorarios = cargarHonorarios;

cargarHonorarios();

})();
