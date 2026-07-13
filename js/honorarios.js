// js/honorarios.js
// -----------------------------------------------------------------------
// Pantalla de Honorarios. Configurar la cuota de un cliente (mensual y/o
// anual) se hace desde la pantalla de Clientes, no acá -- esta pantalla
// solo muestra el resultado, busca clientes, registra pagos, y genera la
// ficha de pago descargable (PDF vía diálogo de impresión).
//
// "Al día" / "Debe" acumula TODA la deuda desde que se configuró el
// honorario de ese cliente (honorarios.created_at), por separado para la
// cuota mensual y la anual (un cliente puede tener las dos a la vez):
// cuenta cuántos períodos pasaron hasta el período vigente inclusive,
// multiplica por el monto pactado de esa cuota, y le resta la suma de los
// pagos históricos de esa misma cuota (tipo_honorario). El estado general
// es "Debe" si cualquiera de las dos cuotas tiene saldo pendiente.
// -----------------------------------------------------------------------

(function () {

const supabaseHonorarios = require('./js/supabaseClient.js');
const { formatearFechaISO, obtenerPeriodoVigente } = require('./js/calendario-logica.js');

const elHonorariosMensaje = document.getElementById('honorarios-mensaje');
const elHonorariosBuscar = document.getElementById('honorarios-buscar');

const elTablaHonorariosBody = document.getElementById('tabla-honorarios-body');
const elSinHonorarios = document.getElementById('sin-honorarios');

const elFormPago = document.getElementById('form-pago');
const elPagoCliente = document.getElementById('pago-cliente');
const elPagoTipo = document.getElementById('pago-tipo');
const elPagoMonto = document.getElementById('pago-monto');
const elPagoForma = document.getElementById('pago-forma');
const elPagoRecibo = document.getElementById('pago-recibo');
const elPagoFecha = document.getElementById('pago-fecha');
const elPagoPeriodo = document.getElementById('pago-periodo');

const elTablaPagosBody = document.getElementById('tabla-pagos-body');
const elSinPagos = document.getElementById('sin-pagos');

const elFichaImprimir = document.getElementById('ficha-pago-imprimir');

const NOMBRES_MES_COMPLETOS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const ETIQUETAS_FORMA_PAGO = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
};

// Guardamos en memoria lo último cargado, para no volver a pedirlo cada
// vez que se busca un cliente o se calcula un estado.
let clientesCacheHonorarios = [];
let honorariosCache = [];
let pagosCache = [];
let configuracionEstudio = null;

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

function formatearFormaPago(formaPago) {
  return ETIQUETAS_FORMA_PAGO[formaPago] || formaPago;
}

function escaparHtmlHonorarios(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// --- Carga inicial -------------------------------------------------------

async function cargarHonorarios() {
  if (!supabaseHonorarios) return;

  try {
    const [
      { data: clientes, error: errorClientes },
      { data: honorarios, error: errorHonorarios },
      { data: pagos, error: errorPagos },
      { data: configuracion, error: errorConfiguracion },
    ] = await Promise.all([
      supabaseHonorarios
        .from('clientes')
        .select('id, razon_social, ruc, cierre_fiscal_mes, membrete_nombre, membrete_direccion, membrete_telefono')
        .order('razon_social'),
      supabaseHonorarios.from('honorarios').select('*'),
      supabaseHonorarios.from('pagos_honorarios').select('*').order('fecha_pago', { ascending: false }),
      supabaseHonorarios.from('configuracion_estudio').select('*').eq('id', 1).maybeSingle(),
    ]);

    if (errorClientes) throw errorClientes;
    if (errorHonorarios) throw errorHonorarios;
    if (errorPagos) throw errorPagos;
    if (errorConfiguracion) throw errorConfiguracion;

    clientesCacheHonorarios = clientes || [];
    honorariosCache = honorarios || [];
    pagosCache = pagos || [];
    configuracionEstudio = configuracion || null;

    dibujarTablaHonorarios();
    dibujarTablaPagos();
    poblarSelectClientesPago();
  } catch (error) {
    console.error('Error al cargar honorarios:', error);
    mostrarMensajeHonorarios('No se pudieron cargar los honorarios.', 'error');
  }
}

// --- Tabla de honorarios por cliente -------------------------------------

// Cuenta cuántos períodos (meses o años) hay que pagar desde que se
// configuró el honorario (created_at) hasta el período vigente, ambos
// inclusive. Nunca da menos de 1.
function contarPeriodosAdeudables(fechaCreacion, periodicidad, cierreFiscalMes) {
  if (periodicidad === 'mensual') {
    const inicio = new Date(fechaCreacion.getFullYear(), fechaCreacion.getMonth(), 1);
    const vigente = obtenerPeriodoVigente('mensual');
    const meses = (vigente.getFullYear() - inicio.getFullYear()) * 12 + (vigente.getMonth() - inicio.getMonth()) + 1;
    return Math.max(meses, 1);
  }

  const mesCreacion = fechaCreacion.getMonth() + 1;
  const anioEjercicioInicio = mesCreacion > cierreFiscalMes ? fechaCreacion.getFullYear() : fechaCreacion.getFullYear() - 1;
  const vigente = obtenerPeriodoVigente('anual', cierreFiscalMes);
  const anios = vigente.getFullYear() - anioEjercicioInicio + 1;
  return Math.max(anios, 1);
}

// Saldo pendiente de UNA de las dos cuotas (mensual o anual). Devuelve
// null si el cliente no tiene esa cuota configurada.
function calcularSaldoPorTipo(honorario, cliente, tipoHonorario) {
  const monto = tipoHonorario === 'mensual' ? honorario.monto_mensual : honorario.monto_anual;
  if (monto === null || monto === undefined) return null;

  const cierreFiscalMes = cliente?.cierre_fiscal_mes ?? 12;
  const periodos = contarPeriodosAdeudables(new Date(honorario.created_at), tipoHonorario, cierreFiscalMes);

  const totalPagado = pagosCache
    .filter((pago) => pago.cliente_id === honorario.cliente_id && pago.tipo_honorario === tipoHonorario)
    .reduce((total, pago) => total + Number(pago.monto_pagado), 0);

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

function dibujarTablaHonorarios() {
  elTablaHonorariosBody.innerHTML = '';

  const busqueda = elHonorariosBuscar.value.trim().toLowerCase();
  const clientesFiltrados = clientesCacheHonorarios.filter((cliente) => {
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

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escaparHtmlHonorarios(cliente.razon_social)}</td>
      <td>${honorario?.monto_mensual ? formatearGuaranies(honorario.monto_mensual) : '—'}</td>
      <td>${honorario?.monto_anual ? formatearGuaranies(honorario.monto_anual) : '—'}</td>
      <td>${dibujarBadgeEstado(resultado)}</td>
      <td><button class="boton boton-chico" data-ficha-cliente-id="${cliente.id}" ${honorario ? '' : 'disabled'}>Ficha</button></td>
    `;
    elTablaHonorariosBody.appendChild(tr);
  }
}

elHonorariosBuscar.addEventListener('input', dibujarTablaHonorarios);

elTablaHonorariosBody.addEventListener('click', (evento) => {
  const boton = evento.target.closest('button[data-ficha-cliente-id]');
  if (!boton) return;

  const clienteId = Number(boton.dataset.fichaClienteId);
  const cliente = clientesCacheHonorarios.find((c) => c.id === clienteId);
  const honorario = honorariosCache.find((h) => h.cliente_id === clienteId);
  if (!cliente || !honorario) return;

  generarFichaPago(cliente, honorario);
});

// --- Formulario de registrar pago ----------------------------------------

function poblarSelectClientesPago() {
  const seleccionActual = elPagoCliente.value;
  elPagoCliente.innerHTML = '<option value="">Seleccioná un cliente</option>';

  for (const cliente of clientesCacheHonorarios) {
    const opcion = document.createElement('option');
    opcion.value = cliente.id;
    opcion.textContent = cliente.razon_social;
    elPagoCliente.appendChild(opcion);
  }

  if (seleccionActual) elPagoCliente.value = seleccionActual;
}

// Al elegir un cliente o cambiar a qué cuota corresponde, sugerimos el
// período vigente y el monto pactado de esa cuota. El contador puede
// corregir ambos si el pago es de un período anterior o un monto distinto.
function actualizarSugerenciaPago() {
  const clienteId = Number(elPagoCliente.value);
  const cliente = clientesCacheHonorarios.find((c) => c.id === clienteId);
  const honorario = honorariosCache.find((h) => h.cliente_id === clienteId);
  const tipo = elPagoTipo.value;
  const cierreFiscalMes = cliente?.cierre_fiscal_mes ?? 12;

  elPagoPeriodo.value = formatearFechaISO(obtenerPeriodoVigente(tipo, cierreFiscalMes));

  const monto = honorario ? (tipo === 'mensual' ? honorario.monto_mensual : honorario.monto_anual) : null;
  if (monto) elPagoMonto.value = monto;
}

elPagoCliente.addEventListener('change', actualizarSugerenciaPago);
elPagoTipo.addEventListener('change', actualizarSugerenciaPago);

elFormPago.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  if (!elPagoCliente.value) {
    mostrarMensajeHonorarios('Elegí un cliente antes de registrar el pago.', 'error');
    return;
  }

  const datosPago = {
    cliente_id: Number(elPagoCliente.value),
    tipo_honorario: elPagoTipo.value,
    monto_pagado: Number(elPagoMonto.value),
    forma_pago: elPagoForma.value,
    numero_recibo: elPagoRecibo.value.trim() || null,
    fecha_pago: elPagoFecha.value || formatearFechaISO(new Date()),
    periodo: elPagoPeriodo.value,
  };

  try {
    const { error } = await supabaseHonorarios.from('pagos_honorarios').insert(datosPago);
    if (error) throw error;

    mostrarMensajeHonorarios('Pago registrado correctamente.');
    elFormPago.reset();
    // form.reset() vacía la fecha de vuelta (no tiene un valor "value" fijo
    // en el HTML): la volvemos a completar con la de hoy, igual que al
    // arrancar la pantalla.
    if (elPagoFecha) elPagoFecha.value = formatearFechaISO(new Date());
    await cargarHonorarios();
  } catch (error) {
    console.error('Error al registrar pago:', error);
    mostrarMensajeHonorarios('No se pudo registrar el pago.', 'error');
  }
});

// --- Tabla de historial de pagos ------------------------------------------

function dibujarTablaPagos() {
  elTablaPagosBody.innerHTML = '';

  if (pagosCache.length === 0) {
    elSinPagos.classList.remove('oculto');
    return;
  }
  elSinPagos.classList.add('oculto');

  for (const pago of pagosCache) {
    const cliente = clientesCacheHonorarios.find((c) => c.id === pago.cliente_id);
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${escaparHtmlHonorarios(cliente ? cliente.razon_social : 'Cliente eliminado')}</td>
      <td>${pago.tipo_honorario === 'mensual' ? 'Cuota Mensual' : 'Cuota Anual'}</td>
      <td>${formatearGuaranies(pago.monto_pagado)}</td>
      <td>${formatearFormaPago(pago.forma_pago)}</td>
      <td>${pago.numero_recibo ? escaparHtmlHonorarios(pago.numero_recibo) : '—'}</td>
      <td>${formatearFechaVisibleHonorarios(pago.fecha_pago)}</td>
      <td>${formatearFechaVisibleHonorarios(pago.periodo)}</td>
    `;
    elTablaPagosBody.appendChild(tr);
  }
}

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
// configuracion_estudio.
function generarFichaPago(cliente, honorario) {
  const anioActual = new Date().getFullYear();
  const nombreEstudio = cliente.membrete_nombre || configuracionEstudio?.nombre_estudio || 'Estudio Contable';
  const direccion = cliente.membrete_direccion || configuracionEstudio?.direccion || '';
  const telefono = cliente.membrete_telefono || configuracionEstudio?.telefono || '';
  const notaVencimiento = configuracionEstudio?.nota_vencimiento || '';

  let html = `
    <div class="ficha-membrete">
      <div>
        <h1>${escaparHtmlHonorarios(nombreEstudio)}</h1>
        ${direccion ? `<p>${escaparHtmlHonorarios(direccion)}</p>` : ''}
        ${telefono ? `<p>Tel: ${escaparHtmlHonorarios(telefono)}</p>` : ''}
      </div>
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

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarHonorarios = cargarHonorarios;

// El campo de fecha de pago arranca con la fecha de hoy ya cargada (el
// usuario la puede cambiar libremente); se completa una sola vez al
// arrancar la pantalla, no cada vez que se recarga la tabla, para no
// pisar una fecha que el contador ya haya empezado a cambiar.
if (elPagoFecha) elPagoFecha.value = formatearFechaISO(new Date());

cargarHonorarios();

})();
