// js/configuracion.js
// -----------------------------------------------------------------------
// Pantalla de Configuración: por ahora solo el tema claro/oscuro. No usa
// Supabase, la preferencia se guarda en esta computadora (localStorage),
// así que cada persona que usa la app puede elegir la suya.
//
// El tema se aplica ANTES de que termine de cargar el resto de la
// interfaz (ver el bloque fuera de la función más abajo), para que no se
// vea un parpadeo de tema claro antes de pasar al oscuro.
// -----------------------------------------------------------------------

(function () {

const CLAVE_TEMA = 'gestor-obligaciones-tema';

const elTemaClaro = document.getElementById('tema-claro');
const elTemaOscuro = document.getElementById('tema-oscuro');

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

// Se llama cada vez que se entra a la pestaña Configuración: marca el
// radio que corresponde al tema actualmente guardado.
function cargarConfiguracion() {
  const tema = obtenerTemaGuardado();
  elTemaClaro.checked = tema === 'claro';
  elTemaOscuro.checked = tema === 'oscuro';
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

// Exponemos solo esta función en "window" para que navegacion.js pueda
// volver a llamarla cada vez que se entra a esta pestaña.
window.cargarConfiguracion = cargarConfiguracion;

// Aplicamos el tema guardado apenas carga este script (antes de mostrar
// nada), para no arrancar siempre en claro y "saltar" a oscuro después.
aplicarTema(obtenerTemaGuardado());

})();
