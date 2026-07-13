// js/configuracion.js
// -----------------------------------------------------------------------
// Pantalla de Configuración, organizada en 3 pestañas internas (Tema,
// Membrete, Paneles -- ver el bloque de sub-navegación más abajo):
//   - Tema: claro/oscuro (local, por computadora, en localStorage).
//   - Membrete: nombre/dirección/teléfono/nota de vencimiento + logo, todo
//     en la fila única de la tabla configuracion_estudio (Supabase).
//   - Paneles: switches on/off para mostrar/ocultar secciones opcionales
//     del resto de la app (ver columnas panel_* de configuracion_estudio).
//
// El tema se aplica ANTES de que termine de cargar el resto de la
// interfaz (ver el bloque fuera de la función más abajo), para que no se
// vea un parpadeo de tema claro antes de pasar al oscuro.
// -----------------------------------------------------------------------

(function () {

const supabaseConfiguracion = require('./js/supabaseClient.js');

const CLAVE_TEMA = 'gestor-obligaciones-tema';

const elTemaClaro = document.getElementById('tema-claro');
const elTemaOscuro = document.getElementById('tema-oscuro');

const elFormConfiguracionEstudio = document.getElementById('form-configuracion-estudio');
const elConfigNombreEstudio = document.getElementById('config-nombre-estudio');
const elConfigDireccion = document.getElementById('config-direccion');
const elConfigTelefono = document.getElementById('config-telefono');
const elConfigNotaVencimiento = document.getElementById('config-nota-vencimiento');
const elConfigLogo = document.getElementById('config-logo');
const elConfigLogoPreview = document.getElementById('config-logo-preview');
const elConfiguracionEstudioMensaje = document.getElementById('configuracion-estudio-mensaje');

const elPanelRg90Visible = document.getElementById('panel-rg90-visible');
const elPanelHonorariosCuotaAnual = document.getElementById('panel-honorarios-cuota-anual');
const elConfiguracionPanelesMensaje = document.getElementById('configuracion-paneles-mensaje');

// Logo elegido en esta sesión de edición (base64), o el que ya estaba
// guardado si el usuario no tocó el input de archivo. null = sin logo.
let logoBase64Actual = null;

// --- Sub-navegación interna (pestañas Tema / Membrete / Paneles) ---------

const elConfigTabBotones = document.querySelectorAll('.config-tab-boton');
const elConfigTabPaneles = document.querySelectorAll('.config-tab-panel');

for (const boton of elConfigTabBotones) {
  boton.addEventListener('click', () => {
    const idTab = boton.dataset.configTab;

    for (const panel of elConfigTabPaneles) {
      panel.classList.toggle('oculto', panel.id !== idTab);
    }
    for (const otroBoton of elConfigTabBotones) {
      otroBoton.classList.toggle('activo', otroBoton === boton);
    }
  });
}

function aplicarTema(tema) {
  if (tema === 'oscuro') {
    document.documentElement.setAttribute('data-theme', 'oscuro');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function obtenerTemaGuardado() {
  return localStorage.getItem(CLAVE_TEMA) === 'oscuro' ? 'oscuro' : 'claro';
}

function mostrarMensajeConfiguracionEstudio(texto, tipo = 'exito') {
  if (!elConfiguracionEstudioMensaje) return;
  elConfiguracionEstudioMensaje.textContent = texto;
  elConfiguracionEstudioMensaje.className = `mensaje mensaje-${tipo}`;
  elConfiguracionEstudioMensaje.classList.remove('oculto');
  setTimeout(() => elConfiguracionEstudioMensaje.classList.add('oculto'), 4000);
}

function mostrarMensajePaneles(texto, tipo = 'exito') {
  if (!elConfiguracionPanelesMensaje) return;
  elConfiguracionPanelesMensaje.textContent = texto;
  elConfiguracionPanelesMensaje.className = `mensaje mensaje-${tipo}`;
  elConfiguracionPanelesMensaje.classList.remove('oculto');
  setTimeout(() => elConfiguracionPanelesMensaje.classList.add('oculto'), 4000);
}

function mostrarPreviewLogo(base64) {
  if (!elConfigLogoPreview) return;
  if (base64) {
    elConfigLogoPreview.src = base64;
    elConfigLogoPreview.classList.remove('oculto');
  } else {
    elConfigLogoPreview.src = '';
    elConfigLogoPreview.classList.add('oculto');
  }
}

// Se llama cada vez que se entra a la pestaña Configuración: marca el
// radio del tema actual y trae el membrete general + switches de paneles
// desde Supabase.
async function cargarConfiguracion() {
  const tema = obtenerTemaGuardado();
  elTemaClaro.checked = tema === 'claro';
  elTemaOscuro.checked = tema === 'oscuro';

  if (!supabaseConfiguracion) return;

  try {
    const { data, error } = await supabaseConfiguracion
      .from('configuracion_estudio')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error) throw error;

    elConfigNombreEstudio.value = data?.nombre_estudio ?? '';
    elConfigDireccion.value = data?.direccion ?? '';
    elConfigTelefono.value = data?.telefono ?? '';
    elConfigNotaVencimiento.value = data?.nota_vencimiento ?? '';

    logoBase64Actual = data?.logo_base64 ?? null;
    mostrarPreviewLogo(logoBase64Actual);
    if (elConfigLogo) elConfigLogo.value = '';

    if (elPanelRg90Visible) elPanelRg90Visible.checked = data?.panel_rg90_visible ?? true;
    if (elPanelHonorariosCuotaAnual) elPanelHonorariosCuotaAnual.checked = data?.panel_honorarios_cuota_anual ?? true;
  } catch (error) {
    console.error('Error al cargar el membrete general:', error);
    mostrarMensajeConfiguracionEstudio('No se pudo cargar el membrete general.', 'error');
  }
}

elTemaClaro.addEventListener('change', () => {
  if (!elTemaClaro.checked) return;
  localStorage.setItem(CLAVE_TEMA, 'claro');
  aplicarTema('claro');
});

elTemaOscuro.addEventListener('change', () => {
  if (!elTemaOscuro.checked) return;
  localStorage.setItem(CLAVE_TEMA, 'oscuro');
  aplicarTema('oscuro');
});

// --- Logo: elegir un archivo y convertirlo a base64 para guardarlo -------

if (elConfigLogo) {
  elConfigLogo.addEventListener('change', () => {
    const archivo = elConfigLogo.files?.[0];
    if (!archivo) return;

    const lector = new FileReader();
    lector.onload = () => {
      logoBase64Actual = lector.result;
      mostrarPreviewLogo(logoBase64Actual);
    };
    lector.onerror = () => {
      console.error('Error al leer el archivo de logo:', lector.error);
      mostrarMensajeConfiguracionEstudio('No se pudo leer la imagen elegida.', 'error');
    };
    lector.readAsDataURL(archivo);
  });
}

elFormConfiguracionEstudio.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  if (!supabaseConfiguracion) {
    mostrarMensajeConfiguracionEstudio('Falta configurar la conexión a Supabase.', 'error');
    return;
  }

  try {
    const { error } = await supabaseConfiguracion
      .from('configuracion_estudio')
      .update({
        nombre_estudio: elConfigNombreEstudio.value.trim() || null,
        direccion: elConfigDireccion.value.trim() || null,
        telefono: elConfigTelefono.value.trim() || null,
        nota_vencimiento: elConfigNotaVencimiento.value.trim() || null,
        logo_base64: logoBase64Actual,
      })
      .eq('id', 1);

    if (error) throw error;

    mostrarMensajeConfiguracionEstudio('Membrete guardado correctamente.');
  } catch (error) {
    console.error('Error al guardar el membrete general:', error);
    mostrarMensajeConfiguracionEstudio('No se pudo guardar el membrete.', 'error');
  }
});

// --- Paneles: cada switch se guarda solo, apenas se toca ------------------

// Mapa columna -> elemento, para no repetir el mismo listener 4 veces.
const SWITCHES_PANELES = [
  ['panel_rg90_visible', elPanelRg90Visible],
  ['panel_honorarios_cuota_anual', elPanelHonorariosCuotaAnual],
];

for (const [columna, elemento] of SWITCHES_PANELES) {
  if (!elemento) continue;

  elemento.addEventListener('change', async () => {
    if (!supabaseConfiguracion) {
      mostrarMensajePaneles('Falta configurar la conexión a Supabase.', 'error');
      elemento.checked = !elemento.checked;
      return;
    }

    const valorNuevo = elemento.checked;
    elemento.disabled = true;

    try {
      const { error } = await supabaseConfiguracion
        .from('configuracion_estudio')
        .update({ [columna]: valorNuevo })
        .eq('id', 1);

      if (error) throw error;
      mostrarMensajePaneles('Preferencia guardada.');
    } catch (error) {
      console.error(`Error al guardar ${columna}:`, error);
      elemento.checked = !valorNuevo; // revertimos el switch visualmente
      mostrarMensajePaneles('No se pudo guardar el cambio. Intentá de nuevo.', 'error');
    } finally {
      elemento.disabled = false;
    }
  });
}

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarConfiguracion = cargarConfiguracion;

// Aplicamos el tema guardado apenas carga este script (antes de mostrar
// nada), para no arrancar siempre en claro y "saltar" a oscuro después.
aplicarTema(obtenerTemaGuardado());

})();
