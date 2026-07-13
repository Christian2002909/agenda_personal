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
const { leerFilasDeArchivoExcel, descargarComoExcel, celdaEsAfirmativa, celdaTexto, celdaNumero, ErrorLibreriaExcelNoDisponible } = require('./js/excel-utils.js');

// --- Referencias a elementos del HTML -----------------------------------
const elMensaje = document.getElementById('mensaje');
const elFormTitulo = document.getElementById('form-titulo');
const elForm = document.getElementById('form-cliente');
const elBtnCancelar = document.getElementById('btn-cancelar');

const elBtnImportarClientes = document.getElementById('btn-importar-clientes-excel');
const elInputImportarClientes = document.getElementById('input-importar-clientes-excel');
const elBtnExportarClientes = document.getElementById('btn-exportar-clientes-excel');
const elImportarResumen = document.getElementById('clientes-importar-resumen');
const elImportarResumenTexto = document.getElementById('clientes-importar-resumen-texto');
const elImportarResumenDetalle = document.getElementById('clientes-importar-resumen-detalle');

const elClienteId = document.getElementById('cliente-id');
const elClienteRuc = document.getElementById('cliente-ruc');
const elClienteRazonSocial = document.getElementById('cliente-razon-social');
const elClienteTerminacionRuc = document.getElementById('cliente-terminacion-ruc');
const elClienteResponsable = document.getElementById('cliente-responsable');
const elClienteClaveMarangatu = document.getElementById('cliente-clave-marangatu');
const elClienteCierreFiscalMes = document.getElementById('cliente-cierre-fiscal-mes');
const elClienteObligacionesCheckboxes = document.getElementById('cliente-obligaciones-checkboxes');
const elClienteHonorarioMensual = document.getElementById('cliente-honorario-mensual');
const elClienteHonorarioAnual = document.getElementById('cliente-honorario-anual');

// Catálogo de obligaciones, para armar los checkboxes.
let obligacionesCache = [];
let obligacionesDelClienteEnEdicion = new Set();

// Lista de perfiles (tabla `perfiles`), para armar el <select> de
// Responsable.
let perfilesCache = [];

// Si el panel "RG 90 visible" está apagado desde Configuración, no se
// ofrecen RG90_MENSUAL/RG90_ANUAL como checkboxes de obligaciones acá.
// Arranca en true para no ocultar nada mientras todavía no se cargó la
// configuración real.
let panelRg90Visible = true;

// Se pone en true justo antes de forzar la vista de Clientes desde otra
// pantalla (ver editarClienteDesdeOtraVista) para que la próxima llamada a
// cargarClientes() -que dispara navegacion.js al cambiar de pestaña- no
// resetee el formulario que estamos a punto de completar con los datos
// del cliente a editar.
let ignorarProximaCarga = false;

// Id (uuid) del usuario logueado, para preseleccionar su propio perfil como
// Responsable al abrir el formulario de un cliente NUEVO (ver
// abrirFormularioNuevo). Queda null si todavía no se pudo leer la sesión, o
// si su perfil no está en perfilesCache por algún motivo; en ese caso el
// <select> simplemente arranca sin preselección, como antes.
let usuarioActualId = null;

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
    const [{ data: obligaciones, error: errorObligaciones }, { data: configuracion, error: errorConfiguracion }] =
      await Promise.all([
        supabase.from('obligaciones').select('*').order('id'),
        supabase.from('configuracion_estudio').select('panel_rg90_visible').eq('id', 1).maybeSingle(),
      ]);
    if (errorObligaciones) throw errorObligaciones;

    obligacionesCache = obligaciones || [];
    // Si falló la lectura de configuración, seguimos mostrando RG 90 (no
    // ocultamos nada por un error transitorio de una tabla que no es la
    // esencial de esta pantalla).
    if (!errorConfiguracion) {
      panelRg90Visible = configuracion?.panel_rg90_visible ?? true;
    }
  } catch (error) {
    console.error('Error al cargar el catálogo de obligaciones:', error);
    mostrarMensaje('No se pudo cargar el catálogo de obligaciones.', 'error');
    return;
  }

  // La lista de responsables no es indispensable para poder ver el
  // formulario (si falla, dejamos el select con el fallback correspondiente
  // en vez de bloquear toda la pantalla).
  await cargarPerfiles();
  await cargarUsuarioActual();

  abrirFormularioNuevo();
}

async function cargarPerfiles() {
  try {
    const { data, error } = await supabase.from('perfiles').select('id, nombre').order('nombre');
    if (error) throw error;
    perfilesCache = (data || []).filter((perfil) => perfil.nombre);
  } catch (error) {
    console.error('Error al cargar la lista de responsables:', error);
    perfilesCache = [];
  }
}

// Lee el uuid del usuario actualmente logueado (mismo mecanismo que usa
// js/auth.js con supabase.auth.getSession()) para poder preseleccionarlo
// como Responsable al crear un cliente nuevo. No es indispensable: si falla
// o todavía no hay sesión (esta pantalla se autoinvoca al cargar el script,
// antes del login, ver comentario de arriba de cargarClientes), el
// formulario simplemente arranca sin preselección.
async function cargarUsuarioActual() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    usuarioActualId = data?.session?.user?.id ?? null;
  } catch (error) {
    console.error('Error al leer el usuario logueado:', error);
    usuarioActualId = null;
  }
}

// --- Checkboxes de obligaciones por cliente --------------------------------

// Arma un checkbox por cada obligación del catálogo, tildando las que
// están en "obligacionesSeleccionadas" (un Set de obligacion_id). Si el
// panel "RG 90 visible" está apagado, RG90_MENSUAL/RG90_ANUAL no se
// ofrecen como opción (aunque ya estuvieran tildadas para este cliente).
function dibujarCheckboxesObligaciones(obligacionesSeleccionadas) {
  elClienteObligacionesCheckboxes.innerHTML = '';

  const obligacionesAMostrar = panelRg90Visible
    ? obligacionesCache
    : obligacionesCache.filter((o) => o.codigo !== 'RG90_MENSUAL' && o.codigo !== 'RG90_ANUAL');

  for (const obligacion of obligacionesAMostrar) {
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

// --- <select> de Responsable, poblado desde la tabla `perfiles` -----------

// Arma las opciones del <select> a partir de perfilesCache. Si no hay
// ningún perfil cargado (tabla vacía o falló la lectura), deja una opción
// deshabilitada explicando la situación en vez de un <select> vacío mudo.
function dibujarOpcionesResponsable() {
  elClienteResponsable.innerHTML = '';

  if (perfilesCache.length === 0) {
    const opcionVacia = document.createElement('option');
    opcionVacia.value = '';
    opcionVacia.textContent = 'No hay responsables cargados';
    opcionVacia.disabled = true;
    opcionVacia.selected = true;
    elClienteResponsable.appendChild(opcionVacia);
    return;
  }

  for (const perfil of perfilesCache) {
    const opcion = document.createElement('option');
    opcion.value = perfil.id;
    opcion.textContent = perfil.nombre;
    elClienteResponsable.appendChild(opcion);
  }
}

// Selecciona, dentro de las opciones ya armadas por dibujarOpcionesResponsable,
// la que corresponde al responsable actual de un cliente que se está
// editando. Prioridad: 1) responsable_id guardado, si coincide con algún
// perfil de la lista (caso normal, cliente ya asignado a un uuid real);
// 2) si no hay responsable_id (cliente viejo sin backfill exitoso) o no
// coincide con ningún perfil actual, cae al mismo fallback de siempre por
// texto libre (responsableTexto) -- si tampoco coincide con el nombre de
// ningún perfil (texto libre viejo, o el perfil se borró/renombró), se
// agrega como opción extra seleccionada en vez de perderse silenciosamente.
function seleccionarResponsable(responsableId, responsableTexto) {
  if (responsableId) {
    const coincidenciaPorId = [...elClienteResponsable.options]
      .find((opcion) => opcion.value === responsableId);
    if (coincidenciaPorId) {
      elClienteResponsable.value = coincidenciaPorId.value;
      return;
    }
  }

  if (!responsableTexto) return;

  const coincidencia = [...elClienteResponsable.options]
    .find((opcion) => !opcion.disabled && opcion.textContent === responsableTexto);

  if (coincidencia) {
    elClienteResponsable.value = coincidencia.value;
    return;
  }

  const placeholder = elClienteResponsable.querySelector('option[disabled]');
  if (placeholder) placeholder.remove();

  const opcionActual = document.createElement('option');
  opcionActual.value = '__actual__';
  opcionActual.textContent = responsableTexto;
  opcionActual.selected = true;
  elClienteResponsable.appendChild(opcionActual);
}

// --- Mostrar el formulario en modo alta / edición --------------------------

function abrirFormularioNuevo() {
  elForm.reset();
  elClienteId.value = '';
  elFormTitulo.textContent = 'Nuevo Cliente';
  obligacionesDelClienteEnEdicion = new Set();
  dibujarCheckboxesObligaciones(obligacionesDelClienteEnEdicion);
  // Reconstruye el <select> de Responsable desde cero: si veníamos de
  // editar un cliente con un responsable "extra" (ver seleccionarResponsable),
  // esa opción no debe quedar pegada en el formulario de alta.
  dibujarOpcionesResponsable();
  // Cliente NUEVO: preseleccionamos el perfil del usuario logueado (sigue
  // siendo editable, cualquiera puede cambiarlo a otro responsable antes de
  // guardar -- ver docs/PEDIDOS_PENDIENTES.md, "Cartera por responsable").
  // Si no hay usuario logueado todavía o su perfil no está en la lista, el
  // <select> queda con la selección por defecto del navegador (la primera
  // opción), como pasaba antes de este cambio.
  if (usuarioActualId) {
    const opcionPropia = [...elClienteResponsable.options]
      .find((opcion) => opcion.value === usuarioActualId);
    if (opcionPropia) opcionPropia.selected = true;
  }
  elClienteRuc.focus();
}

// Llena el formulario con los datos de un cliente ya cargado. Las
// obligaciones ya asignadas se leen de "obligacionesDelClienteEnEdicion",
// que tiene que estar seteada ANTES de llamar a esta función (ver
// window.editarClienteDesdeOtraVista, que la carga desde Supabase).
// "honorario" es la fila de la tabla honorarios de este cliente, o null
// si todavía no tiene ninguna cuota configurada.
function abrirFormularioEdicion(cliente, honorario) {
  elClienteId.value = cliente.id;
  elClienteRuc.value = cliente.ruc;
  elClienteRazonSocial.value = cliente.razon_social;
  elClienteTerminacionRuc.value = cliente.terminacion_ruc ?? '';
  elClienteClaveMarangatu.value = cliente.clave_marangatu ?? '';
  elClienteCierreFiscalMes.value = cliente.cierre_fiscal_mes ?? 12;
  elClienteHonorarioMensual.value = honorario?.monto_mensual ?? '';
  elClienteHonorarioAnual.value = honorario?.monto_anual ?? '';

  dibujarOpcionesResponsable();
  seleccionarResponsable(cliente.responsable_id, cliente.responsable);

  elFormTitulo.textContent = `Editar Cliente: ${cliente.razon_social}`;
  dibujarCheckboxesObligaciones(obligacionesDelClienteEnEdicion);
  elClienteRuc.focus();
}

elBtnCancelar.addEventListener('click', abrirFormularioNuevo);

// Cuando el usuario escribe el RUC, sugerimos automáticamente la
// terminación (el último dígito antes del guion), pero el usuario siempre
// puede corregirla a mano después.
//
// Antes exigía `^(\d+)-\d$` -- todo el string tenía que ser EXACTAMENTE
// "dígitos-un dígito" con el `$` anclado al final, así que no disparaba
// hasta terminar de tipear el RUC COMPLETO, dígito verificador incluido.
// Eso era innecesariamente estricto: la terminación sale del último dígito
// de la base (antes del guion), no del dígito verificador, así que alcanza
// con que ya haya un guion después de al menos un dígito para poder
// sugerirla -- no hace falta esperar a que el campo quede en su forma
// final. También tolera espacios pegados al guion (por si se pega un RUC
// copiado de otro lado, ej. "80012345 - 6" o "80012345- 6").
elClienteRuc.addEventListener('input', () => {
  const coincidencia = elClienteRuc.value.match(/^\s*(\d+)\s*-/);
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

  // El <select> guarda el id del perfil (o un marcador "__actual__" para el
  // fallback de texto libre) en .value. Seguimos guardando el NOMBRE visible
  // en clientes.responsable (texto libre, lo siguen leyendo otras pantallas
  // sin tocar) y AHORA además el uuid en clientes.responsable_id cuando la
  // opción elegida corresponde a un perfil real -- si quedó seleccionada la
  // opción de fallback "__actual__" (responsable de texto libre viejo sin
  // perfil que lo respalde) o no hay ninguna opción real cargada, guardamos
  // null: no hay un perfil real al que referenciar.
  const opcionResponsable = elClienteResponsable.selectedOptions[0];
  const responsableTexto = opcionResponsable ? opcionResponsable.textContent.trim() : '';
  const responsableIdSeleccionado =
    opcionResponsable && opcionResponsable.value && opcionResponsable.value !== '__actual__'
      ? opcionResponsable.value
      : null;

  const datosCliente = {
    ruc: elClienteRuc.value.trim(),
    razon_social: elClienteRazonSocial.value.trim(),
    terminacion_ruc: elClienteTerminacionRuc.value === '' ? null : Number(elClienteTerminacionRuc.value),
    responsable: responsableTexto,
    responsable_id: responsableIdSeleccionado,
    clave_marangatu: elClienteClaveMarangatu.value.trim() || null,
    cierre_fiscal_mes: Number(elClienteCierreFiscalMes.value),
  };

  const montoMensual = elClienteHonorarioMensual.value === '' ? null : Number(elClienteHonorarioMensual.value);
  const montoAnual = elClienteHonorarioAnual.value === '' ? null : Number(elClienteHonorarioAnual.value);

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

    // Honorario: si no se cargó ni cuota mensual ni anual, no dejamos fila
    // en honorarios (la tabla exige al menos una); si ya existía, la
    // borramos. Si se cargó alguna, upsert (la tabla tiene unique por
    // cliente_id, así que reemplaza la fila existente si la había).
    if (montoMensual === null && montoAnual === null) {
      const { error: errorBorrarHonorario } = await supabase.from('honorarios').delete().eq('cliente_id', clienteId);
      if (errorBorrarHonorario) throw errorBorrarHonorario;
    } else {
      const { error: errorHonorario } = await supabase
        .from('honorarios')
        .upsert(
          { cliente_id: clienteId, monto_mensual: montoMensual, monto_anual: montoAnual },
          { onConflict: 'cliente_id' }
        );
      if (errorHonorario) throw errorHonorario;
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

// --- Importar clientes desde Excel ------------------------------------------
//
// Columnas esperadas (ver también exportarClientesAExcel, que genera un
// archivo con este mismo formato para usar de plantilla): "RUC", "Razón
// Social", "Terminación RUC", "Clave Marangatu", "Cierre Fiscal (mes)", y
// una columna más por cada obligación del catálogo (nombre exacto de
// obligaciones.nombre, ej. "IVA", "RG 90 Mensual") con "Sí"/"No" (o vacía
// = No) indicando si el cliente la tiene asignada.
//
// Por fila: si el RUC ya existe (comparación exacta) se ACTUALIZA ese
// cliente; si no existe, se crea. cliente_obligaciones se sincroniza con
// el mismo patrón "borrar todo y reinsertar" que ya usa el formulario
// manual de arriba. Cada fila se procesa en su propio try/catch para que
// un dato inválido en una fila no trabe la importación de las demás --
// al final se muestra cuántas se crearon/actualizaron y el detalle de las
// que se saltearon, con el número de fila del Excel y el motivo.
//
// Responsable: la planilla NO trae esta columna (se maneja aparte, por el
// sistema de usuarios -- ver docs/PEDIDOS_PENDIENTES.md, "Cartera por
// responsable"). Como clientes.responsable es NOT NULL, un cliente NUEVO
// creado por este importador queda asignado al usuario que está haciendo
// la importación en ese momento (mismo criterio que ya usa
// abrirFormularioNuevo() al precargar el <select> de Responsable para un
// alta manual). Un cliente EXISTENTE actualizado por RUC no toca su
// responsable/responsable_id actual -- el import solo pisa los campos que
// realmente vienen en el Excel.
async function importarClientesDesdeExcel(archivo) {
  if (!supabase) return;

  elBtnImportarClientes.disabled = true;
  elImportarResumen.classList.add('oculto');

  try {
    const filas = await leerFilasDeArchivoExcel(archivo);

    // Por si se importa antes de que termine de cargar el catálogo (no
    // debería pasar en la práctica, ya que el botón vive en la misma
    // pantalla que lo carga, pero así queda cubierto igual).
    if (obligacionesCache.length === 0) {
      const { data, error } = await supabase.from('obligaciones').select('*').order('id');
      if (error) throw error;
      obligacionesCache = data || [];
    }

    const { data: clientesExistentes, error: errorClientesExistentes } = await supabase
      .from('clientes')
      .select('id, ruc');
    if (errorClientesExistentes) throw errorClientesExistentes;

    const idPorRuc = new Map((clientesExistentes || []).map((c) => [c.ruc.trim(), c.id]));

    const responsableTexto = perfilesCache.find((p) => p.id === usuarioActualId)?.nombre || 'Sin asignar';

    let creados = 0;
    let actualizados = 0;
    const filasSalteadas = [];

    for (let i = 0; i < filas.length; i += 1) {
      const numeroFila = i + 2; // la fila 1 del Excel es el encabezado
      const fila = filas[i];

      try {
        const ruc = celdaTexto(fila['RUC']);
        const razonSocial = celdaTexto(fila['Razón Social']);

        if (!ruc || !razonSocial) {
          throw new Error('RUC y Razón Social son obligatorios.');
        }
        if (!/^[0-9]{1,8}-[0-9]$/.test(ruc)) {
          throw new Error('El RUC no tiene el formato esperado (ej: 80012345-6).');
        }

        let terminacionRuc = celdaNumero(fila['Terminación RUC']);
        if (terminacionRuc === null) {
          // Se deriva del RUC (último dígito antes del guion), mismo
          // criterio que usa el formulario manual al escribir el RUC.
          terminacionRuc = Number(ruc.match(/^(\d+)-\d$/)[1].slice(-1));
        }
        if (terminacionRuc < 0 || terminacionRuc > 9) {
          throw new Error('Terminación de RUC fuera de rango (0-9).');
        }

        let cierreFiscalMes = celdaNumero(fila['Cierre Fiscal (mes)']);
        if (cierreFiscalMes === null) cierreFiscalMes = 12; // mismo default que la tabla clientes
        if (![4, 6, 12].includes(cierreFiscalMes)) {
          throw new Error('Cierre Fiscal (mes) inválido: solo se admite 4, 6 o 12.');
        }

        const claveMarangatu = celdaTexto(fila['Clave Marangatu']) || null;

        const obligacionesSeleccionadas = obligacionesCache
          .filter((obligacion) => celdaEsAfirmativa(fila[obligacion.nombre]))
          .map((obligacion) => obligacion.id);

        const idExistente = idPorRuc.get(ruc);
        let clienteId;

        if (idExistente) {
          const { error } = await supabase
            .from('clientes')
            .update({
              ruc,
              razon_social: razonSocial,
              terminacion_ruc: terminacionRuc,
              clave_marangatu: claveMarangatu,
              cierre_fiscal_mes: cierreFiscalMes,
            })
            .eq('id', idExistente);
          if (error) throw error;
          clienteId = idExistente;
          actualizados += 1;
        } else {
          const { data, error } = await supabase
            .from('clientes')
            .insert({
              ruc,
              razon_social: razonSocial,
              terminacion_ruc: terminacionRuc,
              clave_marangatu: claveMarangatu,
              cierre_fiscal_mes: cierreFiscalMes,
              responsable: responsableTexto,
              responsable_id: usuarioActualId,
            })
            .select('id')
            .single();
          if (error) throw error;
          clienteId = data.id;
          creados += 1;
          idPorRuc.set(ruc, clienteId); // por si el mismo RUC se repite más abajo en el mismo archivo
        }

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
      } catch (errorFila) {
        console.error(`Error al importar la fila ${numeroFila} del Excel de clientes:`, errorFila);
        filasSalteadas.push({
          fila: numeroFila,
          motivo: errorFila.code === '23505' ? 'Ya existe un cliente con ese RUC.' : (errorFila.message || 'Error desconocido.'),
        });
      }
    }

    mostrarResumenImportacionClientes(creados, actualizados, filasSalteadas);

    // Si se creó o actualizó algo, el formulario queda limpio (no hay
    // ningún cliente puntual en edición después de un import masivo).
    if (creados > 0 || actualizados > 0) abrirFormularioNuevo();
  } catch (error) {
    console.error('Error al importar clientes desde Excel:', error);
    if (error instanceof ErrorLibreriaExcelNoDisponible) {
      mostrarMensaje(error.message, 'error', true);
    } else {
      mostrarMensaje('No se pudo leer el archivo. Verificá que sea un .xlsx con el formato esperado.', 'error', true);
    }
  } finally {
    elBtnImportarClientes.disabled = false;
    elInputImportarClientes.value = '';
  }
}

function mostrarResumenImportacionClientes(creados, actualizados, filasSalteadas) {
  elImportarResumenTexto.textContent =
    `Importación de Clientes terminada: ${creados} creado(s), ${actualizados} actualizado(s)` +
    (filasSalteadas.length > 0 ? `, ${filasSalteadas.length} fila(s) salteada(s) (detalle abajo).` : '.');

  elImportarResumenDetalle.innerHTML = filasSalteadas
    .map((item) => `<li>Fila ${item.fila}: ${escaparHtml(item.motivo)}</li>`)
    .join('');

  elImportarResumen.classList.remove('oculto');
}

if (elBtnImportarClientes && elInputImportarClientes) {
  elBtnImportarClientes.addEventListener('click', () => elInputImportarClientes.click());
  elInputImportarClientes.addEventListener('change', () => {
    const archivo = elInputImportarClientes.files[0];
    if (archivo) importarClientesDesdeExcel(archivo);
  });
}

// --- Exportar clientes a Excel ------------------------------------------
//
// Descarga TODOS los clientes del sistema (no hay ningún filtro en esta
// pantalla) con las mismas columnas que espera importarClientesDesdeExcel,
// para que el archivo exportado sirva de plantilla de referencia. El
// catálogo de obligaciones se usa completo (sin filtrar por el panel "RG
// 90 visible" de Configuración): la exportación es un respaldo de datos
// crudos, no una vista de la interfaz.
async function exportarClientesAExcel() {
  if (!supabase) return;

  elBtnExportarClientes.disabled = true;
  try {
    const [{ data: clientes, error: errorClientes }, { data: clienteObligaciones, error: errorClienteObligaciones }] =
      await Promise.all([
        supabase.from('clientes').select('*').order('razon_social'),
        supabase.from('cliente_obligaciones').select('cliente_id, obligacion_id'),
      ]);
    if (errorClientes) throw errorClientes;
    if (errorClienteObligaciones) throw errorClienteObligaciones;

    let catalogoObligaciones = obligacionesCache;
    if (catalogoObligaciones.length === 0) {
      const { data, error } = await supabase.from('obligaciones').select('*').order('id');
      if (error) throw error;
      catalogoObligaciones = data || [];
    }

    const obligacionesPorCliente = new Map();
    for (const fila of clienteObligaciones || []) {
      if (!obligacionesPorCliente.has(fila.cliente_id)) obligacionesPorCliente.set(fila.cliente_id, new Set());
      obligacionesPorCliente.get(fila.cliente_id).add(fila.obligacion_id);
    }

    const filasExcel = (clientes || []).map((cliente) => {
      const asignadas = obligacionesPorCliente.get(cliente.id) || new Set();
      const filaExcel = {
        'RUC': cliente.ruc,
        'Razón Social': cliente.razon_social,
        'Terminación RUC': cliente.terminacion_ruc ?? '',
        'Clave Marangatu': cliente.clave_marangatu ?? '',
        'Cierre Fiscal (mes)': cliente.cierre_fiscal_mes ?? '',
      };
      for (const obligacion of catalogoObligaciones) {
        filaExcel[obligacion.nombre] = asignadas.has(obligacion.id) ? 'Sí' : 'No';
      }
      return filaExcel;
    });

    await descargarComoExcel(`clientes_${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { nombre: 'Clientes', filas: filasExcel },
    ]);
  } catch (error) {
    console.error('Error al exportar clientes a Excel:', error);
    if (error instanceof ErrorLibreriaExcelNoDisponible) {
      mostrarMensaje(error.message, 'error', true);
    } else {
      mostrarMensaje('No se pudo exportar el Excel de clientes.', 'error');
    }
  } finally {
    elBtnExportarClientes.disabled = false;
  }
}

if (elBtnExportarClientes) elBtnExportarClientes.addEventListener('click', exportarClientesAExcel);

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
      { data: perfilesCatalogo, error: errorPerfilesCatalogo },
      { data: cliente, error: errorCliente },
      { data: obligacionesDelCliente, error: errorObligacionesDelCliente },
      { data: honorario, error: errorHonorario },
    ] = await Promise.all([
      obligacionesCache.length > 0
        ? Promise.resolve({ data: obligacionesCache, error: null })
        : supabase.from('obligaciones').select('*').order('id'),
      perfilesCache.length > 0
        ? Promise.resolve({ data: perfilesCache, error: null })
        : supabase.from('perfiles').select('id, nombre').order('nombre'),
      supabase.from('clientes').select('*').eq('id', clienteId).single(),
      supabase.from('cliente_obligaciones').select('obligacion_id').eq('cliente_id', clienteId),
      supabase.from('honorarios').select('monto_mensual, monto_anual').eq('cliente_id', clienteId).maybeSingle(),
    ]);

    if (errorObligacionesCatalogo) throw errorObligacionesCatalogo;
    if (errorCliente) throw errorCliente;
    if (errorObligacionesDelCliente) throw errorObligacionesDelCliente;
    if (errorHonorario) throw errorHonorario;

    obligacionesCache = obligacionesCatalogo || [];
    // La lista de responsables no es crítica: si falló, seguimos con lo que
    // ya hubiera en caché (posiblemente vacío) en vez de frenar la edición
    // del cliente por completo.
    if (!errorPerfilesCatalogo) {
      perfilesCache = (perfilesCatalogo || []).filter((perfil) => perfil.nombre);
    } else {
      console.error('Error al cargar la lista de responsables:', errorPerfilesCatalogo);
    }
    obligacionesDelClienteEnEdicion = new Set((obligacionesDelCliente || []).map((fila) => fila.obligacion_id));

    ignorarProximaCarga = true;
    window.mostrarVista('vista-clientes');
    abrirFormularioEdicion(cliente, honorario);
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
