const { app, BrowserWindow, Tray, Menu, MenuItem, Notification, ipcMain, nativeTheme, nativeImage, dialog } = require('electron');
const path = require('path');
const nodemailer = require('nodemailer');

const store = require('./store');
const { calcularAvisosPendientes, tareaEstaVencida } = require('./scheduler');
const googleSync = require('./google-sync');
const icloudSync = require('./icloud-sync');

const INTERVALO_NAG_VENTANA_MS = 5 * 60 * 1000;
const INTERVALO_NAG_CALENDARIO_MS = 10 * 60 * 1000;

let mainWindow = null;
let tray = null;
let saliendo = false;

// Evita que se abran varias copias de la app a la vez (cada una con su propio
// reloj/scheduler y sus propios datos en memoria, lo que causaba que los avisos
// no se dispararan de forma confiable). Si ya hay una instancia corriendo, esta
// nueva se cierra y le pide a la existente que se muestre en pantalla.
const seObtuvoElBloqueo = app.requestSingleInstanceLock();

if (!seObtuvoElBloqueo) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function crearVentana() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 720,
    minHeight: 520,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // Corrector ortográfico en español
  try {
    mainWindow.webContents.session.setSpellCheckerLanguages(['es']);
  } catch (err) {
    try {
      mainWindow.webContents.session.setSpellCheckerLanguages(['es-ES']);
    } catch (e) {
      console.error('No se pudo activar el corrector en español:', e.message);
    }
  }

  // Menú contextual (clic derecho): sugerencias de ortografía + cortar/copiar/pegar
  mainWindow.webContents.on('context-menu', (evento, params) => {
    const menu = new Menu();

    for (const sugerencia of params.dictionarySuggestions) {
      menu.append(new MenuItem({
        label: sugerencia,
        click: () => mainWindow.webContents.replaceMisspelling(sugerencia)
      }));
    }

    if (params.misspelledWord) {
      menu.append(new MenuItem({
        label: 'Agregar al diccionario',
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    if (params.isEditable || params.selectionText) {
      menu.append(new MenuItem({ label: 'Cortar', role: 'cut', enabled: params.editFlags.canCut }));
      menu.append(new MenuItem({ label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy }));
      menu.append(new MenuItem({ label: 'Pegar', role: 'paste', enabled: params.editFlags.canPaste }));
    }

    if (menu.items.length) menu.popup();
  });

  mainWindow.on('close', (evento) => {
    if (!saliendo) {
      evento.preventDefault();
      mainWindow.hide();
    }
  });
}

function crearBandeja() {
  try {
    const iconoPath = path.join(__dirname, '..', 'assets', 'icon.png');
    const imagen = nativeImage.createFromPath(iconoPath);
    tray = new Tray(imagen.isEmpty() ? nativeImage.createEmpty() : imagen);
    const menu = Menu.buildFromTemplate([
      { label: 'Abrir Agenda Personal', click: () => mainWindow && mainWindow.show() },
      { label: 'Salir', click: () => { saliendo = true; app.quit(); } }
    ]);
    tray.setToolTip('Agenda Personal');
    tray.setContextMenu(menu);
    tray.on('click', () => mainWindow && mainWindow.show());
  } catch (err) {
    // La bandeja es opcional: si falla (icono faltante, etc.) la app sigue funcionando.
    console.error('No se pudo crear el icono de bandeja:', err.message);
  }
}

// Crea el transporte SMTP. Quita espacios de la contraseña de aplicación
// (Gmail la muestra como "xxxx xxxx xxxx xxxx" y con espacios el login falla).
function crearTransporte(config) {
  return nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpPort === 465,
    auth: {
      user: config.email.direccion,
      pass: (config.email.appPassword || '').replace(/\s+/g, '')
    }
  });
}

async function probarCorreo(config) {
  if (!config.email.direccion || !config.email.appPassword) {
    throw new Error('Falta el correo o la contraseña de aplicación en Configuración.');
  }
  const transporte = crearTransporte(config);
  await transporte.verify();
  await transporte.sendMail({
    from: config.email.direccion,
    to: config.email.direccion,
    subject: 'Prueba de Agenda Personal',
    text: 'Si recibes este correo, los avisos por email ya funcionan correctamente. 🎉'
  });
}

function enviarEmail(config, tarea, dias) {
  if (!config.email.direccion || !config.email.appPassword) return Promise.resolve();
  const transporte = crearTransporte(config);
  const asunto = dias > 0
    ? `Recordatorio: "${tarea.titulo}" vence en ${dias} dia(s)`
    : `Recordatorio: "${tarea.titulo}" vence hoy`;
  return transporte.sendMail({
    from: config.email.direccion,
    to: config.email.direccion,
    subject: asunto,
    text: `${tarea.titulo}\nFecha limite: ${tarea.fechaLimite}\n\n${tarea.notas || ''}`
  });
}

// Muestra la notificación de Windows una sola vez (la re-insistencia periódica
// se encarga de repetirla cada 5 minutos mientras la tarea siga sin completar).
function mostrarNotificacion(titulo, cuerpo) {
  if (!Notification.isSupported()) return;
  new Notification({ title: titulo, body: cuerpo }).show();
}

function dispararAviso(aviso) {
  const config = store.getConfig();
  const { tarea, dias } = aviso;
  const texto = dias > 0 ? `Vence en ${dias} dia(s): ${tarea.fechaLimite}` : `Vence hoy (${tarea.fechaLimite})`;
  const canales = config.notificaciones || { ventana: true, correo: true };

  if (canales.ventana) {
    mostrarNotificacion(tarea.titulo, texto);
  }

  if (canales.correo) {
    enviarEmail(config, tarea, dias).catch((err) => {
      console.error('Error enviando email:', err.message);
      if (mainWindow) mainWindow.webContents.send('sync:error', `Correo del aviso "${tarea.titulo}": ${err.message}`);
    });
  }

  store.marcarAvisoDisparado(aviso.clave);
}

// Devuelve true (y marca la clave) si ya pasó el intervalo indicado desde la última
// vez que se disparó esa clave. Reutiliza el mismo almacén de "últimos avisos".
function debeRenagar(ultimosAvisos, clave, intervaloMs, ahora) {
  const ultimo = ultimosAvisos[clave];
  if (!ultimo || ahora.getTime() - ultimo >= intervaloMs) {
    store.marcarAvisoDisparado(clave);
    return true;
  }
  return false;
}

// Mientras una tarea venga sin completar (y ya haya vencido alguno de sus avisos),
// insiste con la notificación de Windows cada 5 minutos y re-sincroniza el evento
// de Google Calendar cada 10 minutos, para que no pase desapercibida.
function reinsistirTareasVencidas(ahora) {
  const config = store.getConfig();
  const canales = config.notificaciones || { ventana: true, correo: true };
  const tareas = store.getTareas().filter((t) => !t.completada && !t.eliminada);
  const ultimosAvisos = store.getUltimosAvisos();

  for (const tarea of tareas) {
    if (!tareaEstaVencida(tarea, ahora)) continue;

    if (canales.ventana && debeRenagar(ultimosAvisos, `nagVentana:${tarea.id}`, INTERVALO_NAG_VENTANA_MS, ahora)) {
      mostrarNotificacion(tarea.titulo, `Vence el ${tarea.fechaLimite} y sigue pendiente`);
    }

    if (config.googleCalendar.activo && debeRenagar(ultimosAvisos, `nagCalendario:${tarea.id}`, INTERVALO_NAG_CALENDARIO_MS, ahora)) {
      googleSync.crearOActualizarEvento(config, tarea).catch((err) => {
        console.error('Google sync (re-insistencia):', err.message);
      });
    }
  }
}

function iniciarScheduler() {
  const revisar = () => {
    const tareas = store.getTareas();
    const ultimosAvisos = store.getUltimosAvisos();
    const config = store.getConfig();

    // Corrección manual por si el reloj interno de Electron calcula mal la zona horaria.
    const correccionMs = (config.correccionHorariaMin || 0) * 60 * 1000;
    const ahora = new Date(Date.now() + correccionMs);

    const pendientes = calcularAvisosPendientes(tareas, ultimosAvisos, ahora);

    const activas = tareas.filter((t) => !t.completada && !t.eliminada);
    console.log(
      `[scheduler] ${ahora.toLocaleString()} (corrección: ${config.correccionHorariaMin || 0} min) — tareas activas: ` +
      activas.map((t) => `"${t.titulo}" (${t.fechaLimite} ${JSON.stringify(t.horarios)})`).join(', ') +
      ` — pendientes encontrados: ${pendientes.length}`
    );

    pendientes.forEach((p) => {
      console.log(`[scheduler] Disparando aviso: "${p.tarea.titulo}" (clave=${p.clave})`);
      dispararAviso(p);
    });

    reinsistirTareasVencidas(ahora);
  };
  revisar();
  setInterval(revisar, 30 * 1000);
}

function registrarIpc() {
  ipcMain.handle('tareas:listar', () => store.getTareas());
  ipcMain.handle('tareas:guardar', async (evento, tarea) => {
    let tareas = store.saveTarea(tarea);
    const config = store.getConfig();
    const seCompletoOElimino = (tarea.completada || tarea.eliminada) && tarea.googleEventId;

    if (seCompletoOElimino) {
      // Al completar (o eliminar) la tarea, el evento desaparece del calendario.
      try {
        await googleSync.eliminarEvento(config, tarea);
      } catch (err) {
        console.error('Google sync (eliminar evento):', err.message);
        if (mainWindow) mainWindow.webContents.send('sync:error', 'Google Calendar: ' + err.message);
      }
      tarea.googleEventId = null;
      tareas = store.saveTarea(tarea);
    } else if (config.googleCalendar.activo) {
      try {
        const eventId = await googleSync.crearOActualizarEvento(config, tarea);
        if (eventId && eventId !== tarea.googleEventId) {
          tarea.googleEventId = eventId;
          tareas = store.saveTarea(tarea);
        }
      } catch (err) {
        console.error('Google sync:', err.message);
        if (mainWindow) mainWindow.webContents.send('sync:error', 'Google Calendar: ' + err.message);
      }
    }
    if (config.icloudReminders.activo) {
      try {
        await icloudSync.sincronizarTarea(config, tarea);
      } catch (err) {
        console.error('iCloud sync:', err.message);
        if (mainWindow) mainWindow.webContents.send('sync:error', 'iCloud: ' + err.message);
      }
    }
    return tareas;
  });
  ipcMain.handle('tareas:eliminar', (evento, id) => store.deleteTarea(id));

  ipcMain.handle('email:probar', async () => {
    await probarCorreo(store.getConfig()); // lanza error si falla → el renderer lo muestra
    return true;
  });

  ipcMain.handle('notif:probar', () => {
    if (Notification.isSupported()) {
      new Notification({ title: 'Prueba de notificación', body: '¡Las notificaciones funcionan! 🔔' }).show();
      return true;
    }
    return false;
  });

  ipcMain.handle('config:obtener', () => store.getConfig());
  ipcMain.handle('config:guardar', (evento, config) => {
    const guardada = store.saveConfig(config);
    app.setLoginItemSettings({ openAtLogin: !!guardada.iniciarConWindows });
    return guardada;
  });

  ipcMain.handle('config:tema-sistema', () => (nativeTheme.shouldUseDarkColors ? 'oscuro' : 'claro'));

  ipcMain.handle('dialogo:elegir-imagen', async () => {
    const resultado = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Imagenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (resultado.canceled || !resultado.filePaths.length) return null;
    return resultado.filePaths[0];
  });

  ipcMain.handle('google:autenticar', async () => {
    const config = store.getConfig();
    try {
      const tokens = await googleSync.autenticar(config);
      config.googleCalendar.tokens = tokens;
      config.googleCalendar.activo = true;
      return store.saveConfig(config);
    } catch (err) {
      console.error('Error en autenticación Google:', err.message);
      throw err;
    }
  });
}

app.whenReady().then(() => {
  if (!seObtuvoElBloqueo) return; // otra instancia ya está corriendo; esta se está cerrando.
  // Identidad de la app en Windows: necesaria para que las notificaciones (toasts)
  // se muestren correctamente y aparezcan en el Centro de actividades.
  app.setAppUserModelId('com.agendapersonal.app');
  registrarIpc();   // Primero los manejadores IPC, para que el renderer nunca se quede sin ellos.
  crearVentana();
  crearBandeja();
  iniciarScheduler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana();
  });
});

app.on('before-quit', () => { saliendo = true; });

app.on('window-all-closed', () => {
  // La app vive en la bandeja del sistema; no se cierra al cerrar la ventana.
});
