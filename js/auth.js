// js/auth.js
// -----------------------------------------------------------------------
// Maneja el login/logout con Supabase Auth. No hay pantalla de alta de
// usuarios: se crean a mano desde el dashboard de Supabase (Authentication
// → Users). Mientras no haya una sesión válida, se muestra #vista-login y
// se mantiene oculto el resto de la app (#app-autenticado) -- las tablas
// de la base ya tienen RLS que rechaza cualquier consulta sin sesión (ver
// schema.sql, sección 13), así que esto es solo para la experiencia de
// uso, la seguridad real está en la base de datos.
// -----------------------------------------------------------------------

(function () {

const supabaseAuth = require('./js/supabaseClient.js');

const elVistaLogin = document.getElementById('vista-login');
const elAppAutenticado = document.getElementById('app-autenticado');
const elFormLogin = document.getElementById('form-login');
const elLoginEmail = document.getElementById('login-email');
const elLoginPassword = document.getElementById('login-password');
const elLoginMensaje = document.getElementById('login-mensaje');
const elBtnLogout = document.getElementById('btn-logout');
const elUsuarioActual = document.getElementById('usuario-actual');

function mostrarMensajeLogin(texto) {
  elLoginMensaje.textContent = texto;
  elLoginMensaje.classList.remove('oculto');
}

function actualizarPantallaSegunSesion(sesion) {
  const haySesion = Boolean(sesion);
  elVistaLogin.classList.toggle('oculto', haySesion);
  elAppAutenticado.classList.toggle('oculto', !haySesion);

  if (!haySesion) return;

  elUsuarioActual.textContent = sesion.user.email;

  // La pestaña activa pudo haber intentado cargar sus datos antes de que
  // hubiera sesión (y haberse quedado con un error de permiso denegado).
  // La recargamos ahora que ya estamos logueados.
  const botonVistaActiva = document.querySelector('.nav-boton.activo');
  if (botonVistaActiva && typeof window.mostrarVista === 'function') {
    window.mostrarVista(botonVistaActiva.dataset.vista);
  }
}

if (!supabaseAuth) {
  // Sin .env configurado no hay forma de autenticar: mostramos el mismo
  // aviso que ya usan las demás pantallas en este caso.
  mostrarMensajeLogin(
    'Todavía no configuraste la conexión a Supabase. Copiá el archivo ".env.example" como ".env", completá tus credenciales y volvé a abrir la app.'
  );
} else {
  supabaseAuth.auth.getSession().then(({ data }) => actualizarPantallaSegunSesion(data.session));

  supabaseAuth.auth.onAuthStateChange((_evento, sesion) => actualizarPantallaSegunSesion(sesion));

  elFormLogin.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    elLoginMensaje.classList.add('oculto');

    const boton = elFormLogin.querySelector('button[type="submit"]');
    boton.disabled = true;

    try {
      const { error } = await supabaseAuth.auth.signInWithPassword({
        email: elLoginEmail.value.trim(),
        password: elLoginPassword.value,
      });

      if (error) {
        mostrarMensajeLogin('Usuario o contraseña incorrectos.');
      } else {
        elFormLogin.reset();
      }
    } catch (error) {
      console.error('Error al iniciar sesión:', error);
      mostrarMensajeLogin('No se pudo conectar con Supabase. Revisá tu conexión a internet.');
    } finally {
      boton.disabled = false;
    }
  });

  elBtnLogout.addEventListener('click', () => supabaseAuth.auth.signOut());
}

})();
