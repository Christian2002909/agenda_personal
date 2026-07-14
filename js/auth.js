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
const elBtnOlvideContrasena = document.getElementById('btn-olvide-contrasena');
const elBannerSinPerfil = document.getElementById('banner-sin-perfil');
const elBtnIrACompletarPerfil = document.getElementById('btn-ir-a-completar-perfil');

function mostrarMensajeLogin(texto, tipo = 'error') {
  elLoginMensaje.textContent = texto;
  elLoginMensaje.className = `mensaje mensaje-${tipo}`;
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

  // Detectamos acá, apenas se confirma la sesión, si el usuario logueado
  // tiene su propia fila en `perfiles` -- caso típico: el primer admin,
  // creado a mano en el dashboard de Supabase antes de que existiera
  // "Crear Responsable" en Configuración, nunca tuvo perfil propio y no
  // puede identificarse como responsable de sus propios clientes (ver
  // docs/PEDIDOS_PENDIENTES.md, "Pantalla Configuración / Clientes").
  verificarPerfilPropio(sesion.user.id);
}

// Muestra/oculta el banner global "no tenés tu propio perfil" (index.html,
// fuera de las vistas para que se vea sin importar la pestaña activa). Se
// vuelve a llamar sola tras cada login/logout, y queda expuesta en
// "window" para que js/configuracion.js la dispare de nuevo apenas el
// propio usuario crea su perfil (pestaña Usuarios), sin esperar a un
// próximo login -- mismo mecanismo de comunicación entre pantallas que ya
// usa el resto de la app (ver CLAUDE.md, "cross-file communication").
async function verificarPerfilPropio(usuarioId) {
  if (!elBannerSinPerfil) return;

  if (!usuarioId) {
    elBannerSinPerfil.classList.add('oculto');
    return;
  }

  try {
    const { data, error } = await supabaseAuth
      .from('perfiles')
      .select('id')
      .eq('id', usuarioId)
      .maybeSingle();

    if (error) throw error;

    // Si ya existe la fila, ocultamos el aviso; si no existe (data null),
    // lo mostramos.
    elBannerSinPerfil.classList.toggle('oculto', Boolean(data));
  } catch (error) {
    console.error('Error al verificar si el usuario logueado tiene su propio perfil en "perfiles":', error);
    // Ante un error de red/consulta no mostramos el aviso por las dudas --
    // no queremos alarmar de más si en realidad sí tiene perfil y solo
    // falló esta consulta puntual; la próxima carga lo vuelve a intentar.
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

  // Botón del banner "Completar mi perfil": lleva directo a Configuración →
  // Usuarios, donde vive el formulario de autoregistro (ver js/configuracion.js,
  // tarjeta "Tu perfil"). mostrarPestanaUsuariosConfiguracion() la expone
  // configuracion.js -- mismo patrón que window.mostrarVista/window.editarClienteDesdeOtraVista.
  if (elBtnIrACompletarPerfil) {
    elBtnIrACompletarPerfil.addEventListener('click', () => {
      if (typeof window.mostrarVista === 'function') {
        window.mostrarVista('vista-configuracion');
      }
      if (typeof window.mostrarPestanaUsuariosConfiguracion === 'function') {
        window.mostrarPestanaUsuariosConfiguracion();
      }
    });
  }

  // Expuesta para que js/configuracion.js pueda refrescar el banner apenas
  // el propio usuario crea su perfil, sin esperar a un próximo login.
  window.verificarPerfilPropio = () =>
    supabaseAuth.auth
      .getSession()
      .then(({ data }) => verificarPerfilPropio(data?.session?.user?.id));

  // "Olvidé mi contraseña": Supabase manda el mail de recuperación si el
  // email existe. No distinguimos si existe o no en el mensaje (por
  // seguridad, para no confirmar qué emails están registrados).
  if (elBtnOlvideContrasena) {
    elBtnOlvideContrasena.addEventListener('click', async () => {
      const email = elLoginEmail.value.trim();
      if (!email) {
        mostrarMensajeLogin('Escribí tu email arriba y volvé a hacer clic en el link.');
        return;
      }

      elBtnOlvideContrasena.disabled = true;
      try {
        await supabaseAuth.auth.resetPasswordForEmail(email);
      } catch (error) {
        console.error('Error al pedir el restablecimiento de contraseña:', error);
      } finally {
        mostrarMensajeLogin('Si el email existe, te llegará un correo para restablecer la contraseña.', 'exito');
        elBtnOlvideContrasena.disabled = false;
      }
    });
  }
}

})();
