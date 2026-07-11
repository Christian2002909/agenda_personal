// js/clientes.js
// -----------------------------------------------------------------------
// Toda la lógica de la pantalla de Clientes vive en este archivo:
//   - Traer los clientes desde Supabase y mostrarlos en la tabla
//   - Mostrar/ocultar el formulario de alta y edición
//   - Guardar un cliente nuevo o los cambios de uno existente
//   - Filtrar el listado por responsable
// -----------------------------------------------------------------------

// Todo el archivo va adentro de esta función para que sus variables no
// choquen con las de otras pantallas (en un <script> clásico, sin esto,
// dos archivos no pueden declarar el mismo "const" en el nivel superior).
(function () {

// Traemos la conexión a Supabase que armamos en supabaseClient.js
// Nota: esta ruta es relativa a index.html (no a este archivo), porque así
// resuelve Node los require() dentro de un <script> cargado en la ventana.
const supabase = require('./js/supabaseClient.js');

// --- Referencias a elementos del HTML -----------------------------------
// Buscamos los elementos del HTML una sola vez y los guardamos en
// variables, para no tener que buscarlos de nuevo cada vez que los usamos.
const elMensaje = document.getElementById('mensaje');
const elFiltroResponsable = document.getElementById('filtro-responsable');
const elBtnNuevoCliente = document.getElementById('btn-nuevo-cliente');
const elFormContenedor = document.getElementById('form-cliente-contenedor');
const elFormTitulo = document.getElementById('form-titulo');
const elForm = document.getElementById('form-cliente');
const elBtnCancelar = document.getElementById('btn-cancelar');
const elTablaBody = document.getElementById('tabla-clientes-body');
const elSinClientes = document.getElementById('sin-clientes');

const elClienteId = document.getElementById('cliente-id');
const elClienteRuc = document.getElementById('cliente-ruc');
const elClienteRazonSocial = document.getElementById('cliente-razon-social');
const elClienteTerminacionRuc = document.getElementById('cliente-terminacion-ruc');
const elClienteTipoContribuyente = document.getElementById('cliente-tipo-contribuyente');
const elClienteResponsable = document.getElementById('cliente-responsable');
const elClienteCierreFiscalMes = document.getElementById('cliente-cierre-fiscal-mes');

const NOMBRES_MES_CLIENTES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Guardamos en memoria la última lista de clientes que llegó de Supabase,
// para poder armar el filtro de responsables y abrir la edición sin tener
// que volver a pedirle los datos al servidor.
let clientesCache = [];

// --- Mensajes para el usuario --------------------------------------------

function mostrarMensaje(texto, tipo = 'exito', permanente = false) {
  elMensaje.textContent = texto;
  elMensaje.className = `mensaje mensaje-${tipo}`;
  elMensaje.classList.remove('oculto');

  // Los mensajes de éxito/error puntuales se ocultan solos. Los mensajes
  // "permanentes" (por ejemplo, avisar que falta configurar Supabase) se
  // quedan visibles hasta que el usuario resuelva el problema.
  if (!permanente) {
    setTimeout(() => elMensaje.classList.add('oculto'), 4000);
  }
}

// --- Cargar y mostrar clientes --------------------------------------------

// Pide a Supabase la lista de clientes (opcionalmente filtrada por
// responsable) y la dibuja en la tabla.
async function cargarClientes() {
  // Si todavía no se completó el archivo .env con las credenciales reales
  // de Supabase, "supabase" es null (ver supabaseClient.js). En ese caso no
  // hay nada para consultar: mostramos el aviso y no seguimos.
  if (!supabase) {
    mostrarMensaje(
      'Todavía no configuraste la conexión a Supabase. Copiá el archivo ".env.example" como ".env", completá tus credenciales y volvé a abrir la app.',
      'error',
      true
    );
    return;
  }

  try {
    let consulta = supabase.from('clientes').select('*').order('razon_social', { ascending: true });

    const responsableSeleccionado = elFiltroResponsable.value;
    if (responsableSeleccionado && responsableSeleccionado !== 'todos') {
      consulta = consulta.eq('responsable', responsableSeleccionado);
    }

    const { data, error } = await consulta;
    if (error) throw error;

    clientesCache = data || [];
    dibujarTabla(clientesCache);
    actualizarOpcionesDeFiltro(clientesCache);
  } catch (error) {
    console.error('Error al cargar clientes:', error);
    mostrarMensaje(
      'No se pudieron cargar los clientes. Revisá tu conexión a internet y las credenciales del archivo .env.',
      'error'
    );
  }
}

// Dibuja las filas de la tabla a partir de un arreglo de clientes.
function dibujarTabla(clientes) {
  elTablaBody.innerHTML = '';

  if (clientes.length === 0) {
    elSinClientes.classList.remove('oculto');
    return;
  }
  elSinClientes.classList.add('oculto');

  for (const cliente of clientes) {
    const fila = document.createElement('tr');

    fila.innerHTML = `
      <td>${escaparHtml(cliente.ruc)}</td>
      <td>${escaparHtml(cliente.razon_social)}</td>
      <td>${cliente.terminacion_ruc ?? ''}</td>
      <td>${escaparHtml(cliente.tipo_contribuyente)}</td>
      <td>${escaparHtml(cliente.responsable)}</td>
      <td>${NOMBRES_MES_CLIENTES[(cliente.cierre_fiscal_mes ?? 12) - 1]}</td>
      <td>${formatearFecha(cliente.fecha_alta)}</td>
      <td><button class="boton boton-chico" data-id="${cliente.id}">Editar</button></td>
    `;

    elTablaBody.appendChild(fila);
  }
}

// Convierte una fecha "2026-07-11" en un formato más fácil de leer: 11/07/2026
function formatearFecha(fechaISO) {
  if (!fechaISO) return '';
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}/${anio}`;
}

// Evita que texto ingresado por el usuario "rompa" el HTML de la tabla
// (por ejemplo, si alguien escribe algo como <script> en la Razón Social).
function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// --- Filtro por responsable -----------------------------------------------

// Arma las opciones del <select> de filtro a partir de los responsables
// que ya existen entre los clientes cargados (sin repetir nombres).
function actualizarOpcionesDeFiltro(clientes) {
  const seleccionActual = elFiltroResponsable.value;
  const responsablesUnicos = [...new Set(clientes.map((c) => c.responsable))].sort();

  elFiltroResponsable.innerHTML = '<option value="todos">Todos</option>';

  for (const responsable of responsablesUnicos) {
    const opcion = document.createElement('option');
    opcion.value = responsable;
    opcion.textContent = responsable;
    elFiltroResponsable.appendChild(opcion);
  }

  // Si la opción que estaba elegida todavía existe en la nueva lista,
  // la mantenemos seleccionada (para no "resetear" el filtro sin querer).
  const sigueExistiendo = [...elFiltroResponsable.options].some((o) => o.value === seleccionActual);
  if (sigueExistiendo) {
    elFiltroResponsable.value = seleccionActual;
  }
}

elFiltroResponsable.addEventListener('change', cargarClientes);

// --- Mostrar / ocultar formulario ------------------------------------------

function abrirFormularioNuevo() {
  elForm.reset();
  elClienteId.value = '';
  elFormTitulo.textContent = 'Nuevo Cliente';
  elFormContenedor.classList.remove('oculto');
  elClienteRuc.focus();
}

function abrirFormularioEdicion(cliente) {
  elClienteId.value = cliente.id;
  elClienteRuc.value = cliente.ruc;
  elClienteRazonSocial.value = cliente.razon_social;
  elClienteTerminacionRuc.value = cliente.terminacion_ruc ?? '';
  elClienteTipoContribuyente.value = cliente.tipo_contribuyente;
  elClienteResponsable.value = cliente.responsable;
  elClienteCierreFiscalMes.value = cliente.cierre_fiscal_mes ?? 12;

  elFormTitulo.textContent = `Editar Cliente: ${cliente.razon_social}`;
  elFormContenedor.classList.remove('oculto');
  elClienteRuc.focus();
}

function cerrarFormulario() {
  elForm.reset();
  elFormContenedor.classList.add('oculto');
}

elBtnNuevoCliente.addEventListener('click', abrirFormularioNuevo);
elBtnCancelar.addEventListener('click', cerrarFormulario);

// Cuando el usuario escribe el RUC, sugerimos automáticamente la
// terminación (el último dígito antes del guion), pero el usuario siempre
// puede corregirla a mano después.
elClienteRuc.addEventListener('input', () => {
  const coincidencia = elClienteRuc.value.match(/^(\d+)-\d$/);
  if (coincidencia) {
    const numeroSinDigitoVerificador = coincidencia[1];
    const ultimoDigito = numeroSinDigitoVerificador.slice(-1);
    elClienteTerminacionRuc.value = ultimoDigito;
  }
});

// --- Guardar (alta o edición) -----------------------------------------------

elForm.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  if (!supabase) {
    mostrarMensaje('No se puede guardar: falta configurar la conexión a Supabase en el archivo .env.', 'error', true);
    return;
  }

  const datosCliente = {
    ruc: elClienteRuc.value.trim(),
    razon_social: elClienteRazonSocial.value.trim(),
    terminacion_ruc: elClienteTerminacionRuc.value === '' ? null : Number(elClienteTerminacionRuc.value),
    tipo_contribuyente: elClienteTipoContribuyente.value,
    responsable: elClienteResponsable.value.trim(),
    cierre_fiscal_mes: Number(elClienteCierreFiscalMes.value),
  };

  const idExistente = elClienteId.value;

  try {
    let error;

    if (idExistente) {
      // Ya hay un id: estamos editando un cliente que ya estaba guardado.
      ({ error } = await supabase.from('clientes').update(datosCliente).eq('id', idExistente));
    } else {
      // No hay id: es un cliente nuevo.
      ({ error } = await supabase.from('clientes').insert(datosCliente));
    }

    if (error) throw error;

    mostrarMensaje(idExistente ? 'Cliente actualizado correctamente.' : 'Cliente creado correctamente.');
    cerrarFormulario();
    await cargarClientes();
  } catch (error) {
    console.error('Error al guardar cliente:', error);

    // El error más común al empezar es el RUC duplicado (viola el unique constraint).
    if (error.code === '23505') {
      mostrarMensaje('Ya existe un cliente con ese RUC.', 'error');
    } else {
      mostrarMensaje('No se pudo guardar el cliente. Revisá los datos e intentá de nuevo.', 'error');
    }
  }
});

// --- Click en "Editar" dentro de la tabla ------------------------------------

// En vez de agregar un listener a cada botón "Editar" (que se crean y
// destruyen todo el tiempo), escuchamos los clicks en toda la tabla y
// revisamos si el click vino de un botón con data-id.
elTablaBody.addEventListener('click', (evento) => {
  const boton = evento.target.closest('button[data-id]');
  if (!boton) return;

  const cliente = clientesCache.find((c) => String(c.id) === boton.dataset.id);
  if (cliente) abrirFormularioEdicion(cliente);
});

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarClientes = cargarClientes;

// --- Arranque: apenas se abre la pantalla, cargamos los clientes -------------
cargarClientes();

})();
