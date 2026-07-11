// js/navegacion.js
// -----------------------------------------------------------------------
// Este archivo NO usa Supabase, solo maneja qué "vista" (sección de la
// pantalla) está visible en cada momento: cuando el usuario hace clic en
// un botón del menú de arriba, ocultamos todas las vistas y mostramos
// únicamente la que corresponde a ese botón.
// -----------------------------------------------------------------------

const elBotonesNav = document.querySelectorAll('.nav-boton');
const elVistas = document.querySelectorAll('.vista');

// Cada pantalla define su propia función "cargarX()" (cargarClientes,
// cargarCalendario, cargarHonorarios, etc.) para traer sus datos de
// Supabase. Como esas funciones quedan disponibles en "window" (por ser
// declaradas en scripts sueltos, no módulos), acá las volvemos a llamar
// cada vez que el usuario entra a esa pestaña, para que siempre muestre
// datos actualizados y no lo que había cuando se abrió la app.
const FUNCION_DE_RECARGA_POR_VISTA = {
  'vista-clientes': 'cargarClientes',
  'vista-calendario': 'cargarCalendario',
  'vista-presentaciones': 'cargarPresentaciones',
  'vista-historial': 'cargarHistorial',
  'vista-honorarios': 'cargarHonorarios',
  'vista-configuracion': 'cargarConfiguracion',
};

function mostrarVista(nombreVista) {
  for (const vista of elVistas) {
    vista.classList.toggle('oculto', vista.id !== nombreVista);
  }

  for (const boton of elBotonesNav) {
    boton.classList.toggle('activo', boton.dataset.vista === nombreVista);
  }

  const nombreFuncion = FUNCION_DE_RECARGA_POR_VISTA[nombreVista];
  if (nombreFuncion && typeof window[nombreFuncion] === 'function') {
    window[nombreFuncion]();
  }
}

for (const boton of elBotonesNav) {
  boton.addEventListener('click', () => mostrarVista(boton.dataset.vista));
}

// Expuesta para que js/auth.js pueda recargar la pestaña activa apenas
// se confirma el login (sin esto, la primera pestaña quedaría con el
// error de "permiso denegado" que Supabase devuelve antes de loguearse).
window.mostrarVista = mostrarVista;
