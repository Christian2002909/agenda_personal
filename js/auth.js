// js/auth.js
// -----------------------------------------------------------------------
// Maneja el login/logout con Supabase Auth. No hay pantalla de alta de
// usuarios: se crean a mano desde el dashboard de Supabase (Authentication
// → Users) o desde Configuración → Usuarios. Mientras no haya una sesión
// válida, se muestra #vista-login y se mantiene oculto el resto de la app
// (#app-autenticado) -- las tablas de la base ya tienen RLS que rechaza
// cualquier consulta sin sesión (ver schema.sql, sección 13), así que esto
// es solo para la experiencia de uso, la seguridad real está en la base de
// datos.
//
// El login tiene dos pasos ("elegí tu nombre" en vez de arrancar pidiendo
// email/contraseña):
//   1) #login-lista-nombres: un botón por cada fila de la vista pública
//      `perfiles_publicos` (única lectura sin sesión de todo el esquema,
//      ver schema.sql sección 15.2 -- expone solo id/nombre/email, nunca
//      `rol`).
//   2) #form-login: pide la contraseña de la persona elegida. Si hay una
//      sesión guardada en ESTA PC para ese perfil (checkbox "Recordar",
//      ver CLAVE_SESIONES más abajo), este paso se saltea solo intentando
//      restaurarla con setSession(); si el token guardado ya no sirve, cae
//      acá a pedir la contraseña de nuevo en vez de trabarse.
// -----------------------------------------------------------------------

(function () {

const supabaseAuth = require('./js/supabaseClient.js');

const elVistaLogin = document.getElementById('vista-login');
const elAppAutenticado = document.getElementById('app-autenticado');
const elLoginMensaje = document.getElementById('login-mensaje');

const elListaNombres = document.getElementById('login-lista-nombres');
const elNombresContenedor = document.getElementById('login-nombres-contenedor');
const elBtnOtroUsuario = document.getElementById('btn-login-otro-usuario');

const elFormLogin = document.getElementById('form-login');
const elBtnVolver = document.getElementById('btn-login-volver');
const elNombreElegido = document.getElementById('login-nombre-elegido');
const elFilaLoginEmail = document.getElementById('fila-login-email');
const elLoginEmail = document.getElementById('login-email');
const elLoginPassword = document.getElementById('login-password');
const elBtnVerPassword = document.getElementById('btn-ver-password');
const elLoginRecordar = document.getElementById('login-recordar');
const elBtnOlvideContrasena = document.getElementById('btn-olvide-contrasena');

const elBtnLogout = document.getElementById('btn-logout');
const elUsuarioActual = document.getElementById('usuario-actual');
const elBannerSinPerfil = document.getElementById('banner-sin-perfil');
const elBtnIrACompletarPerfil = document.getElementById('btn-ir-a-completar-perfil');

// Clave de localStorage donde se guardan, por PC, los tokens de sesión de
// cada perfil que tildó "Recordar" -- { [perfilId]: { access_token,
// refresh_token } }. Mismo patrón de nombre que CLAVE_TEMA en
// js/configuracion.js. No hay backend propio: localStorage es lo único
// disponible, y persiste igual en Electron que en un navegador.
const CLAVE_SESIONES = 'gestor-obligaciones-sesiones';

// Perfil elegido en el paso 1 ({ id, nombre, email } de perfiles_publicos),
// o null si se entró por "Ingresar con email y contraseña" sin elegir a
// nadie de la lista (primer arranque sin perfiles todavía, o alguien no
// listado). Vive en memoria nada más, no hace falta persistirlo.
let perfilElegido = null;

function mostrarMensajeLogin(texto, tipo = 'error') {
  elLoginMensaje.textContent = texto;
  elLoginMensaje.className = `mensaje mensaje-${tipo}`;
  elLoginMensaje.classList.remove('oculto');
}

function ocultarMensajeLogin() {
  elLoginMensaje.classList.add('oculto');
}

// --- Sesiones guardadas por PC (localStorage) ------------------------------

function leerSesionesGuardadas() {
  try {
    const crudo = localStorage.getItem(CLAVE_SESIONES);
    return crudo ? JSON.parse(crudo) : {};
  } catch (error) {
    console.error('Error al leer las sesiones guardadas en esta PC:', error);
    return {};
  }
}

function guardarSesionLocal(perfilId, sesion) {
  const sesiones = leerSesionesGuardadas();
  sesiones[perfilId] = {
    access_token: sesion.access_token,
    refresh_token: sesion.refresh_token,
  };
  localStorage.setItem(CLAVE_SESIONES, JSON.stringify(sesiones));
}

function borrarSesionLocal(perfilId) {
  const sesiones = leerSesionesGuardadas();
  if (!(perfilId in sesiones)) return;
  delete sesiones[perfilId];
  localStorage.setItem(CLAVE_SESIONES, JSON.stringify(sesiones));
}

// --- Paso 1: lista de nombres ----------------------------------------------

function mostrarPasoNombres() {
  perfilElegido = null;
  ocultarMensajeLogin();
  elFormLogin.classList.add('oculto');
  elFormLogin.reset();
  elLoginRecordar.checked = true;
  elLoginPassword.type = 'password';
  elBtnVerPassword.textContent = 'Ver';
  elListaNombres.classList.remove('oculto');
  cargarListaNombres();
}

async function cargarListaNombres() {
  elNombresContenedor.innerHTML = '<p class="texto-ayuda">Cargando...</p>';

  try {
    // perfiles_publicos es la única lectura sin sesión de todo el esquema
    // (ver schema.sql, sección 15.2): expone solo id/nombre/email, nunca
    // `rol`. Todavía no hay sesión acá, así que esta consulta corre como
    // `anon`.
    const { data, error } = await supabaseAuth
      .from('perfiles_publicos')
      .select('id, nombre, email')
      .order('nombre');

    if (error) throw error;

    const perfiles = (data || []).filter((perfil) => perfil.nombre);

    if (perfiles.length === 0) {
      elNombresContenedor.innerHTML =
        '<p class="texto-ayuda">Todavía no hay nombres cargados. Usá "Ingresar con email y contraseña".</p>';
      return;
    }

    elNombresContenedor.innerHTML = '';
    for (const perfil of perfiles) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'login-nombre-boton';
      boton.textContent = perfil.nombre;
      boton.addEventListener('click', () => elegirNombre(perfil));
      elNombresContenedor.appendChild(boton);
    }
  } catch (error) {
    console.error('Error al cargar la lista de nombres para el login:', error);
    elNombresContenedor.innerHTML =
      '<p class="texto-ayuda">No se pudo cargar la lista de nombres. Usá "Ingresar con email y contraseña" o revisá tu conexión.</p>';
  }
}

// Al tocar un nombre: si hay una sesión guardada en esta PC para ese
// perfil, se intenta restaurar directo. Si no hay, o si la restauración
// falla (token vencido/inválido/revocado), se cae al paso 2 pidiendo
// contraseña de nuevo -- nunca se traba mostrando un error sin salida.
async function elegirNombre(perfil) {
  const sesiones = leerSesionesGuardadas();
  const guardada = sesiones[perfil.id];

  if (guardada) {
    try {
      const { data, error } = await supabaseAuth.auth.setSession({
        access_token: guardada.access_token,
        refresh_token: guardada.refresh_token,
      });

      if (error || !data?.session) throw error || new Error('Sesión guardada inválida.');

      // onAuthStateChange (más abajo) ya se encarga de mostrar
      // #app-autenticado. Refrescamos la copia guardada por si Supabase
      // rotó el refresh token al restaurar la sesión.
      guardarSesionLocal(perfil.id, data.session);
      return;
    } catch (error) {
      console.warn(
        `La sesión guardada para "${perfil.nombre}" ya no sirve, pidiendo la contraseña de nuevo:`,
        error
      );
      borrarSesionLocal(perfil.id);
      // sigue abajo, al paso de contraseña.
    }
  }

  mostrarPasoContrasena(perfil);
}

// --- Paso 2: contraseña -----------------------------------------------------

function mostrarPasoContrasena(perfil) {
  perfilElegido = perfil;
  ocultarMensajeLogin();
  elListaNombres.classList.add('oculto');
  elFormLogin.reset();
  elLoginRecordar.checked = true;
  elLoginPassword.type = 'password';
  elBtnVerPassword.textContent = 'Ver';

  if (perfil) {
    elNombreElegido.textContent = `Hola, ${perfil.nombre}`;
    elNombreElegido.classList.remove('oculto');
  } else {
    elNombreElegido.classList.add('oculto');
  }

  // El email ya lo sabemos si vino de la lista Y esa fila lo tiene
  // guardado (columna perfiles.email); si no -- perfil no elegido de la
  // lista, o perfil viejo creado antes de este cambio -- se lo pedimos
  // además de la contraseña. Ver el comentario largo en schema.sql,
  // sección 15.2, sobre esta decisión.
  const necesitaEmail = !perfil || !perfil.email;
  elFilaLoginEmail.classList.toggle('oculto', !necesitaEmail);
  elLoginEmail.required = necesitaEmail;
  if (!necesitaEmail) elLoginEmail.value = '';

  elFormLogin.classList.remove('oculto');
  (necesitaEmail ? elLoginEmail : elLoginPassword).focus();
}

if (!supabaseAuth) {
  // Sin .env configurado no hay forma de autenticar: mostramos el mismo
  // aviso que ya usan las demás pantallas en este caso, y no dejamos la
  // lista de nombres con un "Cargando..." colgado sin sentido.
  mostrarMensajeLogin(
    'Todavía no configuraste la conexión a Supabase. Copiá el archivo ".env.example" como ".env", completá tus credenciales y volvé a abrir la app.'
  );
  elNombresContenedor.innerHTML = '';
} else {
  supabaseAuth.auth.getSession().then(({ data }) => actualizarPantallaSegunSesion(data.session));

  supabaseAuth.auth.onAuthStateChange((_evento, sesion) => actualizarPantallaSegunSesion(sesion));

  if (elBtnOtroUsuario) {
    elBtnOtroUsuario.addEventListener('click', () => mostrarPasoContrasena(null));
  }

  if (elBtnVolver) {
    elBtnVolver.addEventListener('click', () => mostrarPasoNombres());
  }

  if (elBtnVerPassword) {
    elBtnVerPassword.addEventListener('click', () => {
      const mostrando = elLoginPassword.type === 'text';
      elLoginPassword.type = mostrando ? 'password' : 'text';
      elBtnVerPassword.textContent = mostrando ? 'Ver' : 'Ocultar';
    });
  }

  elFormLogin.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    ocultarMensajeLogin();

    const boton = elFormLogin.querySelector('button[type="submit"]');
    boton.disabled = true;

    const email = (perfilElegido && perfilElegido.email) || elLoginEmail.value.trim();
    const password = elLoginPassword.value;

    if (!email) {
      mostrarMensajeLogin('Escribí tu email.');
      boton.disabled = false;
      return;
    }

    try {
      const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

      if (error) {
        mostrarMensajeLogin('Usuario o contraseña incorrectos.');
        return;
      }

      // "Recordar" guarda los tokens en esta PC, asociados al id del
      // usuario que acaba de loguearse (el mismo id que perfiles.id) --
      // así el próximo clic en su nombre entra directo sin pedir nada.
      // Si la casilla está destildada, no se guarda nada: la próxima vez
      // vuelve a pedir contraseña.
      if (elLoginRecordar.checked && data?.session) {
        guardarSesionLocal(data.session.user.id, data.session);
      }

      // onAuthStateChange (arriba) ya se encarga de mostrar
      // #app-autenticado.
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
  // seguridad, para no confirmar qué emails están registrados). El email
  // sale del perfil elegido si ya lo conocemos, o del campo (visible en
  // ese caso) si no.
  if (elBtnOlvideContrasena) {
    elBtnOlvideContrasena.addEventListener('click', async () => {
      const email = (perfilElegido && perfilElegido.email) || elLoginEmail.value.trim();
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

function actualizarPantallaSegunSesion(sesion) {
  const haySesion = Boolean(sesion);
  elVistaLogin.classList.toggle('oculto', haySesion);
  elAppAutenticado.classList.toggle('oculto', !haySesion);

  if (!haySesion) {
    // Sin sesión (primer arranque, después de "Cerrar sesión", o token
    // vencido): siempre se vuelve al paso 1, lista de nombres -- nunca se
    // deja un formulario de email/contraseña vacío colgado.
    mostrarPasoNombres();
    return;
  }

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

})();
