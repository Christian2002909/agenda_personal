// js/configuracion.js
// -----------------------------------------------------------------------
// Pantalla de Configuración: tema claro/oscuro (local, por computadora) y
// el membrete general del estudio para la ficha de pago (compartido en
// Supabase, ver tabla configuracion_estudio).
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
const elConfiguracionEstudioMensaje = document.getElementById('configuracion-estudio-mensaje');

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

// Se llama cada vez que se entra a la pestaña Configuración: marca el
// radio del tema actual y trae el membrete general desde Supabase.
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
      })
      .eq('id', 1);

    if (error) throw error;

    mostrarMensajeConfiguracionEstudio('Membrete guardado correctamente.');
  } catch (error) {
    console.error('Error al guardar el membrete general:', error);
    mostrarMensajeConfiguracionEstudio('No se pudo guardar el membrete.', 'error');
  }
});

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarConfiguracion = cargarConfiguracion;

// Aplicamos el tema guardado apenas carga este script (antes de mostrar
// nada), para no arrancar siempre en claro y "saltar" a oscuro después.
aplicarTema(obtenerTemaGuardado());

})();
