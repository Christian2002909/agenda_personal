// js/honorarios.js
// -----------------------------------------------------------------------
// Pantalla de Honorarios. Tiene tres partes:
//   1. Honorario pactado por cliente (monto + si es mensual o anual), con
//      un estado "Al día" / "Debe" calculado en el momento (nunca se
//      guarda como columna, para que no se desincronice de los pagos
//      reales -- ver decisión de diseño en schema.sql).
//   2. Formulario para registrar un pago.
//   3. Historial de todos los pagos, del más reciente al más antiguo.
//
// "Al día" / "Debe" acumula TODA la deuda desde que se configuró el
// honorario de ese cliente: cuenta cuántos períodos (meses o años, según
// periodicidad) pasaron desde `honorarios.created_at` hasta el período
// vigente (inclusive), multiplica por el monto pactado, y le resta la
// suma de TODOS los pagos históricos del cliente (no solo los del período
// vigente). Si el cliente tiene cierre fiscal distinto a diciembre, se
// usa ese mes para determinar el período vigente (igual que el Calendario).
// -----------------------------------------------------------------------

(function () {

const supabaseHonorarios = require('./js/supabaseClient.js');
const { formatearFechaISO, obtenerPeriodoVigente } = require('./js/calendario-logica.js');

const elHonorariosMensaje = document.getElementById('honorarios-mensaje');

const elTablaHonorariosBody = document.getElementById('tabla-honorarios-body');
const elSinHonorarios = document.getElementById('sin-honorarios');

const elFormHonorarioContenedor = document.getElementById('form-honorario-contenedor');
const elFormHonorarioTitulo = document.getElementById('form-honorario-titulo');
const elFormHonorario = document.getElementById('form-honorario');
const elHonorarioClienteId = document.getElementById('honorario-cliente-id');
const elHonorarioClienteNombre = document.getElementById('honorario-cliente-nombre');
const elHonorarioMonto = document.getElementById('honorario-monto');
const elHonorarioPeriodicidad = document.getElementById('honorario-periodicidad');
const elBtnCancelarHonorario = document.getElementById('btn-cancelar-honorario');

const elFormPago = document.getElementById('form-pago');
const elPagoCliente = document.getElementById('pago-cliente');
const elPagoMonto = document.getElementById('pago-monto');
const elPagoFecha = document.getElementById('pago-fecha');
const elPagoPeriodo = document.getElementById('pago-periodo');

const elTablaPagosBody = document.getElementById('tabla-pagos-body');
const elSinPagos = document.getElementById('sin-pagos');

// Guardamos en memoria lo último cargado, para no volver a pedirlo cada
// vez que se abre un formulario o se calcula un estado.
let clientesCacheHonorarios = [];
let honorariosCache = [];
let pagosCache = [];

function mostrarMensajeHonorarios(texto, tipo = 'exito') {
  if (!elHonorariosMensaje) return;
  elHonorariosMensaje.textContent = texto;
  elHonorariosMensaje.className = `mensaje mensaje-${tipo}`;
  elHonorariosMensaje.classList.remove('oculto');
  setTimeout(() => elHonorariosMensaje.classList.add('oculto'), 4000);
}

// --- Carga inicial -------------------------------------------------------

async function cargarHonorarios() {
  if (!supabaseHonorarios) return;

  try {
    const [
      { data: clientes, error: errorClientes },
      { data: honorarios, error: errorHonorarios },
      { data: pagos, error: errorPagos },
    ] = await Promise.all([
      supabaseHonorarios.from('clientes').select('id, razon_social, cierre_fiscal_mes').order('razon_social'),
      supabaseHonorarios.from('honorarios').select('*'),
      supabaseHonorarios.from('pagos_honorarios').select('*').order('fecha_pago', { ascending: false }),
    ]);

    if (errorClientes) throw errorClientes;
    if (errorHonorarios) throw errorHonorarios;
    if (errorPagos) throw errorPagos;

    clientesCacheHonorarios = clientes || [];
    honorariosCache = honorarios || [];
    pagosCache = pagos || [];

    dibujarTablaHonorarios();
    dibujarTablaPagos();
    poblarSelectClientesPago();
  } catch (error) {
    console.error('Error al cargar honorarios:', error);
    mostrarMensajeHonorarios('No se pudieron cargar los honorarios.', 'error');
  }
}

// --- Tabla de honorarios por cliente -------------------------------------

// Cuenta cuántos períodos (meses o años, según periodicidad) hay que
// pagar desde que se configuró el honorario (created_at) hasta el período
// vigente, ambos inclusive. Nunca da menos de 1.
function contarPeriodosAdeudables(honorario, cierreFiscalMes) {
  const fechaCreacion = new Date(honorario.created_at);

  if (honorario.periodicidad === 'mensual') {
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

// Devuelve { estado: 'al_dia' | 'debe', saldoPendiente } comparando toda
// la deuda acumulada (monto x períodos adeudables) contra TODOS los pagos
// históricos del cliente, sin importar a qué período se hayan imputado.
function calcularEstadoHonorario(honorario, cliente) {
  if (!honorario) return null;

  const cierreFiscalMes = cliente?.cierre_fiscal_mes ?? 12;
  const periodosAdeudables = contarPeriodosAdeudables(honorario, cierreFiscalMes);

  const totalPagado = pagosCache
    .filter((pago) => pago.cliente_id === honorario.cliente_id)
    .reduce((total, pago) => total + Number(pago.monto_pagado), 0);

  const totalAdeudado = Number(honorario.monto) * periodosAdeudables;
  const saldoPendiente = Math.max(totalAdeudado - totalPagado, 0);

  return { estado: saldoPendiente > 0 ? 'debe' : 'al_dia', saldoPendiente };
}

function formatearGuaranies(monto) {
  return `Gs. ${Number(monto).toLocaleString('es-PY')}`;
}

function dibujarTablaHonorarios() {
  elTablaHonorariosBody.innerHTML = '';

  if (clientesCacheHonorarios.length === 0) {
    elSinHonorarios.classList.remove('oculto');
    return;
  }
  elSinHonorarios.classList.add('oculto');

  for (const cliente of clientesCacheHonorarios) {
    const honorario = honorariosCache.find((h) => h.cliente_id === cliente.id);
    const resultado = calcularEstadoHonorario(honorario, cliente);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escaparHtmlHonorarios(cliente.razon_social)}</td>
      <td>${honorario ? formatearGuaranies(honorario.monto) : '—'}</td>
      <td>${honorario ? (honorario.periodicidad === 'mensual' ? 'Mensual' : 'Anual') : '—'}</td>
      <td>${dibujarBadgeEstado(resultado)}</td>
      <td><button class="boton boton-chico" data-cliente-id="${cliente.id}">${honorario ? 'Editar' : 'Configurar'}</button></td>
    `;
    elTablaHonorariosBody.appendChild(tr);
  }
}

function dibujarBadgeEstado(resultado) {
  if (!resultado) return '<span class="texto-ayuda">Sin configurar</span>';
  if (resultado.estado === 'al_dia') return '<span class="badge badge-verde">Al día</span>';
  return `<span class="badge badge-rojo">Debe ${formatearGuaranies(resultado.saldoPendiente)}</span>`;
}

function escaparHtmlHonorarios(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

elTablaHonorariosBody.addEventListener('click', (evento) => {
  const boton = evento.target.closest('button[data-cliente-id]');
  if (!boton) return;

  const clienteId = boton.dataset.clienteId;
  const cliente = clientesCacheHonorarios.find((c) => String(c.id) === clienteId);
  const honorario = honorariosCache.find((h) => String(h.cliente_id) === clienteId);

  abrirFormularioHonorario(cliente, honorario);
});

// --- Formulario de honorario (configurar / editar) -----------------------

function abrirFormularioHonorario(cliente, honorarioExistente) {
  elHonorarioClienteId.value = cliente.id;
  elHonorarioClienteNombre.textContent = cliente.razon_social;
  elFormHonorarioTitulo.textContent = honorarioExistente ? `Editar honorario: ${cliente.razon_social}` : `Configurar honorario: ${cliente.razon_social}`;
  elHonorarioMonto.value = honorarioExistente ? honorarioExistente.monto : '';
  elHonorarioPeriodicidad.value = honorarioExistente ? honorarioExistente.periodicidad : 'mensual';
  elFormHonorarioContenedor.classList.remove('oculto');
}

function cerrarFormularioHonorario() {
  elFormHonorario.reset();
  elFormHonorarioContenedor.classList.add('oculto');
}

elBtnCancelarHonorario.addEventListener('click', cerrarFormularioHonorario);

elFormHonorario.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const datos = {
    cliente_id: Number(elHonorarioClienteId.value),
    monto: Number(elHonorarioMonto.value),
    periodicidad: elHonorarioPeriodicidad.value,
  };

  try {
    // "upsert" porque honorarios tiene un unique constraint por
    // cliente_id: si ya existía, lo actualiza; si no, lo crea.
    const { error } = await supabaseHonorarios
      .from('honorarios')
      .upsert(datos, { onConflict: 'cliente_id' });

    if (error) throw error;

    mostrarMensajeHonorarios('Honorario guardado correctamente.');
    cerrarFormularioHonorario();
    await cargarHonorarios();
  } catch (error) {
    console.error('Error al guardar honorario:', error);
    mostrarMensajeHonorarios('No se pudo guardar el honorario.', 'error');
  }
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

// Al elegir un cliente, sugerimos automáticamente el período vigente
// según su honorario (mensual o anual). El contador puede corregirlo si
// el pago corresponde a un período anterior (atrasado).
elPagoCliente.addEventListener('change', () => {
  const clienteId = Number(elPagoCliente.value);
  const cliente = clientesCacheHonorarios.find((c) => c.id === clienteId);
  const honorario = honorariosCache.find((h) => h.cliente_id === clienteId);
  const periodicidad = honorario ? honorario.periodicidad : 'mensual';
  const cierreFiscalMes = cliente?.cierre_fiscal_mes ?? 12;
  elPagoPeriodo.value = formatearFechaISO(obtenerPeriodoVigente(periodicidad, cierreFiscalMes));

  if (honorario) elPagoMonto.value = honorario.monto;
});

elFormPago.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  if (!elPagoCliente.value) {
    mostrarMensajeHonorarios('Elegí un cliente antes de registrar el pago.', 'error');
    return;
  }

  const datosPago = {
    cliente_id: Number(elPagoCliente.value),
    monto_pagado: Number(elPagoMonto.value),
    fecha_pago: elPagoFecha.value || formatearFechaISO(new Date()),
    periodo: elPagoPeriodo.value,
  };

  try {
    const { error } = await supabaseHonorarios.from('pagos_honorarios').insert(datosPago);
    if (error) throw error;

    mostrarMensajeHonorarios('Pago registrado correctamente.');
    elFormPago.reset();
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
      <td>${formatearGuaranies(pago.monto_pagado)}</td>
      <td>${formatearFechaVisibleHonorarios(pago.fecha_pago)}</td>
      <td>${formatearFechaVisibleHonorarios(pago.periodo)}</td>
    `;
    elTablaPagosBody.appendChild(tr);
  }
}

function formatearFechaVisibleHonorarios(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}/${anio}`;
}

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarHonorarios = cargarHonorarios;

cargarHonorarios();

})();
