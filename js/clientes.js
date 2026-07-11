// js/clientes.js
// -----------------------------------------------------------------------
// Pantalla Clientes: SOLO para cargar/editar un cliente (alta o edición).
// No tiene listado propio -- para ver los clientes ya cargados (con su
// RUC, clave de Marangatu, etc.) hay que ir a la pantalla de
// Presentaciones (js/presentaciones.js), que además puede abrir un
// cliente acá para editarlo (ver window.editarClienteDesdeOtraVista).
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
const elMensaje = document.getElementById('mensaje');
const elFormTitulo = document.getElementById('form-titulo');
const elForm = document.getElementById('form-cliente');
const elBtnCancelar = document.getElementById('btn-cancelar');

const elClienteId = document.getElementById('cliente-id');
const elClienteRuc = document.getElementById('cliente-ruc');
const elClienteRazonSocial = document.getElementById('cliente-razon-social');
const elClienteTerminacionRuc = document.getElementById('cliente-terminacion-ruc');
const elClienteResponsable = document.getElementById('cliente-responsable');
const elClienteClaveMarangatu = document.getElementById('cliente-clave-marangatu');
const elClienteCierreFiscalMes = document.getElementById('cliente-cierre-fiscal-mes');
const elClienteObligacionesCheckboxes = document.getElementById('cliente-obligaciones-checkboxes');

// Catálogo de obligaciones, para armar los checkboxes.
let obligacionesCache = [];
let obligacionesDelClienteEnEdicion = new Set();

// Se pone en true justo antes de forzar la vista de Clientes desde otra
// pantalla (ver editarClienteDesdeOtraVista) para que la próxima llamada a
// cargarClientes() -que dispara navegacion.js al cambiar de pestaña- no
// resetee el formulario que estamos a punto de completar con los datos
// del cliente a editar.
let ignorarProximaCarga = false;

// --- Mensajes para el usuario --------------------------------------------

function mostrarMensaje(texto, tipo = 'exito', permanente = false) {
  elMensaje.textContent = texto;
  elMensaje.className = `mensaje mensaje-${tipo}`;
  elMensaje.classList.remove('oculto');

  if (!permanente) {
    setTimeout(() => elMensaje.classList.add('oculto'), 4000);
  }
}

// Evita que texto ingresado por el usuario "rompa" el HTML (por ejemplo,
// si alguien escribe algo como <script> en el nombre de una obligación).
function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// --- Carga inicial: solo el catálogo de obligaciones (para los checkboxes) ---

async function cargarClientes() {
  if (!supabase) {
    mostrarMensaje(
      'Todavía no configuraste la conexión a Supabase. Copiá el archivo ".env.example" como ".env", completá tus credenciales y volvé a abrir la app.',
      'error',
      true
    );
    return;
  }

  // Si venimos de editarClienteDesdeOtraVista(), esa función ya dejó todo
  // listo (catálogo cargado, formulario en modo edición): no lo pisamos.
  if (ignorarProximaCarga) {
    ignorarProximaCarga = false;
    return;
  }

  try {
    const { data, error } = await supabase.from('obligaciones').select('*').order('id');
    if (error) throw error;

    obligacionesCache = data || [];
    abrirFormularioNuevo();
  } catch (error) {
    console.error('Error al cargar el catálogo de obligaciones:', error);
    mostrarMensaje('No se pudo cargar el catálogo de obligaciones.', 'error');
  }
}

// --- Checkboxes de obligaciones por cliente --------------------------------

// Arma un checkbox por cada obligación del catálogo, tildando las que
// están en "obligacionesSeleccionadas" (un Set de obligacion_id).
function dibujarCheckboxesObligaciones(obligacionesSeleccionadas) {
  elClienteObligacionesCheckboxes.innerHTML = '';

  for (const obligacion of obligacionesCache) {
    const marcado = obligacionesSeleccionadas.has(obligacion.id);

    const etiqueta = document.createElement('label');
    etiqueta.className = 'opcion-checkbox';
    etiqueta.innerHTML = `
      <input type="checkbox" value="${obligacion.id}" ${marcado ? 'checked' : ''} />
      ${escaparHtml(obligacion.nombre)}
    `;
    elClienteObligacionesCheckboxes.appendChild(etiqueta);
  }
}

// --- Mostrar el formulario en modo alta / edición --------------------------

function abrirFormularioNuevo() {
  elForm.reset();
  elClienteId.value = '';
  elFormTitulo.textContent = 'Nuevo Cliente';
  obligacionesDelClienteEnEdicion = new Set();
  dibujarCheckboxesObligaciones(obligacionesDelClienteEnEdicion);
  elClienteRuc.focus();
}

// Llena el formulario con los datos de un cliente ya cargado. Las
// obligaciones ya asignadas se leen de "obligacionesDelClienteEnEdicion",
// que tiene que estar seteada ANTES de llamar a esta función (ver
// window.editarClienteDesdeOtraVista, que la carga desde Supabase).
function abrirFormularioEdicion(cliente) {
  elClienteId.value = cliente.id;
  elClienteRuc.value = cliente.ruc;
  elClienteRazonSocial.value = cliente.razon_social;
  elClienteTerminacionRuc.value = cliente.terminacion_ruc ?? '';
  elClienteResponsable.value = cliente.responsable;
  elClienteClaveMarangatu.value = cliente.clave_marangatu ?? '';
  elClienteCierreFiscalMes.value = cliente.cierre_fiscal_mes ?? 12;

  elFormTitulo.textContent = `Editar Cliente: ${cliente.razon_social}`;
  dibujarCheckboxesObligaciones(obligacionesDelClienteEnEdicion);
  elClienteRuc.focus();
}

elBtnCancelar.addEventListener('click', abrirFormularioNuevo);

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
    responsable: elClienteResponsable.value.trim(),
    clave_marangatu: elClienteClaveMarangatu.value.trim() || null,
    cierre_fiscal_mes: Number(elClienteCierreFiscalMes.value),
  };

  const idExistente = elClienteId.value;
  const obligacionesSeleccionadas = [...elClienteObligacionesCheckboxes.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => Number(input.value));

  try {
    let clienteId;

    if (idExistente) {
      // Ya hay un id: estamos editando un cliente que ya estaba guardado.
      const { error } = await supabase.from('clientes').update(datosCliente).eq('id', idExistente);
      if (error) throw error;
      clienteId = Number(idExistente);
    } else {
      // No hay id: es un cliente nuevo.
      const { data, error } = await supabase.from('clientes').insert(datosCliente).select('id').single();
      if (error) throw error;
      clienteId = data.id;
    }

    // Reemplazamos las obligaciones asignadas: borramos todas las de este
    // cliente y volvemos a insertar las que quedaron tildadas. Son pocas
    // filas como mucho (una por obligación del catálogo), así que es más
    // simple que comparar diferencias contra lo que había antes.
    const { error: errorBorrarObligaciones } = await supabase
      .from('cliente_obligaciones')
      .delete()
      .eq('cliente_id', clienteId);
    if (errorBorrarObligaciones) throw errorBorrarObligaciones;

    if (obligacionesSeleccionadas.length > 0) {
      const { error: errorInsertarObligaciones } = await supabase
        .from('cliente_obligaciones')
        .insert(obligacionesSeleccionadas.map((obligacionId) => ({ cliente_id: clienteId, obligacion_id: obligacionId })));
      if (errorInsertarObligaciones) throw errorInsertarObligaciones;
    }

    mostrarMensaje(idExistente ? 'Cliente actualizado correctamente.' : 'Cliente creado correctamente.');
    abrirFormularioNuevo();
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

// --- Editar un cliente desde otra pantalla (Presentaciones) -----------------

// Cambia a la pestaña Clientes y abre el formulario con los datos de un
// cliente existente, listo para editar. Pensada para ser llamada desde
// js/presentaciones.js cuando el contador quiere corregir un cliente que
// ve en esa lista.
window.editarClienteDesdeOtraVista = async function editarClienteDesdeOtraVista(clienteId) {
  if (!supabase) return;

  try {
    const [
      { data: obligacionesCatalogo, error: errorObligacionesCatalogo },
      { data: cliente, error: errorCliente },
      { data: obligacionesDelCliente, error: errorObligacionesDelCliente },
    ] = await Promise.all([
      obligacionesCache.length > 0
        ? Promise.resolve({ data: obligacionesCache, error: null })
        : supabase.from('obligaciones').select('*').order('id'),
      supabase.from('clientes').select('*').eq('id', clienteId).single(),
      supabase.from('cliente_obligaciones').select('obligacion_id').eq('cliente_id', clienteId),
    ]);

    if (errorObligacionesCatalogo) throw errorObligacionesCatalogo;
    if (errorCliente) throw errorCliente;
    if (errorObligacionesDelCliente) throw errorObligacionesDelCliente;

    obligacionesCache = obligacionesCatalogo || [];
    obligacionesDelClienteEnEdicion = new Set((obligacionesDelCliente || []).map((fila) => fila.obligacion_id));

    ignorarProximaCarga = true;
    window.mostrarVista('vista-clientes');
    abrirFormularioEdicion(cliente);
  } catch (error) {
    console.error('Error al abrir el cliente para editar:', error);
    mostrarMensaje('No se pudo abrir el cliente para editar.', 'error');
  }
};

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarClientes = cargarClientes;

// --- Arranque: apenas se abre la pantalla, cargamos el catálogo -------------
cargarClientes();

})();
