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

const elFormCrearResponsable = document.getElementById('form-crear-responsable');
const elResponsableNombre = document.getElementById('responsable-nombre');
const elResponsableEmail = document.getElementById('responsable-email');
const elResponsablePassword = document.getElementById('responsable-password');
const elBtnGenerarPassword = document.getElementById('btn-generar-password');
const elConfiguracionUsuariosMensaje = document.getElementById('configuracion-usuarios-mensaje');
const elResponsableCreadoResultado = document.getElementById('responsable-creado-resultado');

// Logo elegido en esta sesión de edición (base64), o el que ya estaba
// guardado si el usuario no tocó el input de archivo. null = sin logo.
let logoBase64Actual = null;

// --- Sub-navegación interna (pestañas Tema / Membrete / Paneles) ---------

const elConfigTabBotones = document.querySelectorAll('.config-tab-boton');
const elConfigTabPaneles = document.querySelectorAll('.config-tab-panel');

function activarPestanaConfiguracion(idTab) {
  for (const panel of elConfigTabPaneles) {
    panel.classList.toggle('oculto', panel.id !== idTab);
  }
  for (const boton of elConfigTabBotones) {
    boton.classList.toggle('activo', boton.dataset.configTab === idTab);
  }
}

for (const boton of elConfigTabBotones) {
  boton.addEventListener('click', () => activarPestanaConfiguracion(boton.dataset.configTab));
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

// No usa setTimeout para auto-ocultarse (a diferencia de los otros
// mensajes de esta pantalla) porque el resultado de crear un responsable
// (con el email/contraseña que hay que comunicarle) se muestra debajo y
// tiene que poder quedar visible el tiempo que el admin necesite para
// copiarlo, no desaparecer solo.
function mostrarMensajeUsuarios(texto, tipo = 'exito') {
  if (!elConfiguracionUsuariosMensaje) return;
  elConfiguracionUsuariosMensaje.textContent = texto;
  elConfiguracionUsuariosMensaje.className = `mensaje mensaje-${tipo}`;
  elConfiguracionUsuariosMensaje.classList.remove('oculto');
}

// Mismo patrón que escaparHtml() en clientes.js/presentaciones.js: cada
// archivo tiene su propia copia porque son scripts sueltos sin módulos
// (ver cabecera de este archivo y CLAUDE.md). Evita que un nombre/email
// con caracteres especiales rompa el innerHTML del resultado de abajo.
function escaparHtmlConfiguracion(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// Sugiere una contraseña de 12 caracteres (mayúsculas/minúsculas/números/
// símbolo, sin caracteres fácilmente confundibles como 0/O o 1/l/I) --
// sigue siendo editable a mano antes de crear la cuenta.
function generarPasswordAleatoria() {
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let resultado = '';
  for (let i = 0; i < 12; i++) {
    resultado += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  }
  return resultado;
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

// --- Usuarios: crear un responsable nuevo con acceso real a la app --------
// El autoregistro del propio usuario logueado ("Tu perfil") ya no vive acá
// -- es obligatorio ANTES de entrar a la app (ver
// #vista-completar-perfil-inicial en index.html y js/auth.js).

if (elBtnGenerarPassword) {
  elBtnGenerarPassword.addEventListener('click', () => {
    elResponsablePassword.value = generarPasswordAleatoria();
  });
}

if (elFormCrearResponsable) {
  elFormCrearResponsable.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    if (!supabaseConfiguracion) {
      mostrarMensajeUsuarios('Falta configurar la conexión a Supabase.', 'error');
      return;
    }

    const nombre = elResponsableNombre.value.trim();
    const email = elResponsableEmail.value.trim();
    const password = elResponsablePassword.value;

    if (!nombre || !email || !password) {
      mostrarMensajeUsuarios('Completá nombre, email y contraseña.', 'error');
      return;
    }

    const boton = elFormCrearResponsable.querySelector('button[type="submit"]');
    boton.disabled = true;
    elResponsableCreadoResultado.classList.add('oculto');
    elConfiguracionUsuariosMensaje.classList.add('oculto');

    try {
      // 1) Guardamos la sesión del admin ANTES de crear el usuario nuevo.
      // signUp() puede dejar al cliente logueado como el usuario NUEVO en
      // vez de mantener la sesión de quien lo está creando -- sin este
      // paso, dar de alta un responsable desloguearía al admin de su
      // propia cuenta (ver docs/PEDIDOS_PENDIENTES.md, "Crear responsables
      // (usuarios) desde Configuración").
      const { data: sesionActual, error: errorSesion } = await supabaseConfiguracion.auth.getSession();
      if (errorSesion || !sesionActual?.session) {
        throw new Error('No se pudo leer tu sesión actual. Por seguridad, no se crea el responsable.');
      }
      const tokensAdmin = {
        access_token: sesionActual.session.access_token,
        refresh_token: sesionActual.session.refresh_token,
      };

      // 2) Creamos la cuenta nueva de Supabase Auth.
      const { data: datosAlta, error: errorAlta } = await supabaseConfiguracion.auth.signUp({ email, password });
      if (errorAlta) throw errorAlta;

      const usuarioNuevoId = datosAlta?.user?.id;
      if (!usuarioNuevoId) {
        throw new Error('Supabase no devolvió el id del usuario nuevo.');
      }

      // signUp() devuelve session=null cuando el proyecto tiene ACTIVADA la
      // confirmación de email (el usuario nuevo no puede loguearse hasta
      // confirmar el correo); devuelve una sesión activa cuando esa
      // confirmación está DESACTIVADA. Es la única forma de detectar esto
      // desde el cliente -- el ajuste en sí vive en el dashboard de
      // Supabase (Authentication → Providers → Email → "Confirm email"),
      // fuera del alcance del código.
      const requiereConfirmacionEmail = !datosAlta.session;

      // 3) Restauramos la sesión del admin INMEDIATAMENTE, sin depender de
      // si el paso anterior nos dejó logueados como el usuario nuevo o no.
      const { error: errorRestaurar } = await supabaseConfiguracion.auth.setSession(tokensAdmin);
      if (errorRestaurar) {
        console.error('Error al restaurar la sesión del admin:', errorRestaurar);
        mostrarMensajeUsuarios(
          'La cuenta se creó, pero no se pudo restaurar tu sesión automáticamente. Si quedaste desconectado, volvé a loguearte -- el perfil de este responsable todavía no se guardó, hay que completarlo a mano en Supabase o reintentar.',
          'error'
        );
        return;
      }

      // 4) Insertamos el perfil (nombre visible + rol por defecto + email).
      // Recién acá existe la fila que el resto de la app usa para listar
      // responsables (ver policy "perfiles_insertar_autenticados" en
      // schema.sql). El email se guarda también en `perfiles` (no solo en
      // auth.users) porque la pantalla de login necesita mostrarlo/usarlo
      // ANTES de que exista sesión, vía la vista pública
      // `perfiles_publicos` -- ver schema.sql sección 15.2 y js/auth.js.
      const { error: errorPerfil } = await supabaseConfiguracion
        .from('perfiles')
        .insert({ id: usuarioNuevoId, nombre, rol: 'responsable', email });

      if (errorPerfil) throw errorPerfil;

      // 5) Mostramos el resultado: el admin necesita ver el email y la
      // contraseña para poder comunicárselos a la persona, ya que no hay
      // garantía de que le llegue el mail (y si la confirmación por email
      // está activada, ni siquiera puede ingresar todavía).
      elResponsableCreadoResultado.innerHTML = `
        <p><strong>Responsable creado correctamente.</strong></p>
        <p>Email: <strong>${escaparHtmlConfiguracion(email)}</strong></p>
        <p>Contraseña inicial: <strong>${escaparHtmlConfiguracion(password)}</strong></p>
        <p>${
          requiereConfirmacionEmail
            ? `Este proyecto de Supabase tiene la confirmación por email ACTIVADA: ${escaparHtmlConfiguracion(nombre)} tiene que revisar su correo (${escaparHtmlConfiguracion(email)}) y confirmar la cuenta antes de poder ingresar.`
            : `La confirmación por email está DESACTIVADA en este proyecto: ${escaparHtmlConfiguracion(nombre)} ya puede ingresar ahora mismo con este email y esta contraseña.`
        }</p>
      `;
      elResponsableCreadoResultado.classList.remove('oculto');

      mostrarMensajeUsuarios('Responsable creado correctamente.');
      elFormCrearResponsable.reset();

      // No hace falta refrescar ningún <select> de "Ver cartera de"/
      // "Responsable" a mano acá: cada pantalla (Clientes, Presentaciones,
      // Historial, Honorarios) vuelve a leer `perfiles` cada vez que se
      // entra a esa pestaña (ver navegacion.js, FUNCION_DE_RECARGA_POR_VISTA),
      // así que el responsable nuevo aparece solo con cambiar de pestaña.
    } catch (error) {
      console.error('Error al crear el responsable:', error);
      const mensajeCrudo = error?.message || '';
      let mensaje = 'No se pudo crear el responsable. Revisá los datos e intentá de nuevo.';
      if (/already registered|already exists|user_already_exists/i.test(mensajeCrudo)) {
        mensaje = 'Ya existe una cuenta con ese email.';
      } else if (/password/i.test(mensajeCrudo)) {
        mensaje = 'La contraseña no cumple los requisitos mínimos de Supabase (probá con una más larga).';
      }
      mostrarMensajeUsuarios(mensaje, 'error');
    } finally {
      boton.disabled = false;
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
