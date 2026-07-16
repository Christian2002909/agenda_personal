const Store = require('electron-store');

const defaultConfig = {
  tema: 'sistema',
  colorPrograma: 'normal',
  posicionPanel: 'izquierda',
  fondo: { tipo: 'degradado', valor: '' },
  email: { direccion: '', appPassword: '', smtpHost: 'smtp.gmail.com', smtpPort: 465 },
  iniciarConWindows: false,
  googleCalendar: { clientId: '', clientSecret: '', tokens: null, activo: false },
  icloudReminders: { appleId: '', appPassword: '', activo: false }
};

const store = new Store({
  name: 'agenda-personal-data',
  defaults: {
    tareas: [],
    config: defaultConfig,
    ultimosAvisos: {}
  }
});

function getTareas() {
  return store.get('tareas', []);
}

function saveTarea(tarea) {
  const tareas = getTareas();
  const idx = tareas.findIndex((t) => t.id === tarea.id);
  if (idx >= 0) {
    tareas[idx] = tarea;
  } else {
    tareas.push(tarea);
  }
  store.set('tareas', tareas);
  return tareas;
}

function deleteTarea(id) {
  const tareas = getTareas().filter((t) => t.id !== id);
  store.set('tareas', tareas);
  return tareas;
}

function getConfig() {
  const stored = store.get('config', {});
  return {
    ...defaultConfig,
    ...stored,
    fondo: { ...defaultConfig.fondo, ...(stored.fondo || {}) },
    email: { ...defaultConfig.email, ...(stored.email || {}) },
    googleCalendar: { ...defaultConfig.googleCalendar, ...(stored.googleCalendar || {}) },
    icloudReminders: { ...defaultConfig.icloudReminders, ...(stored.icloudReminders || {}) }
  };
}

function saveConfig(config) {
  const merged = {
    ...getConfig(),
    ...config,
    fondo: { ...getConfig().fondo, ...(config.fondo || {}) },
    email: { ...getConfig().email, ...(config.email || {}) },
    googleCalendar: { ...getConfig().googleCalendar, ...(config.googleCalendar || {}) },
    icloudReminders: { ...getConfig().icloudReminders, ...(config.icloudReminders || {}) }
  };
  store.set('config', merged);
  return merged;
}

function getUltimosAvisos() {
  return store.get('ultimosAvisos', {});
}

function marcarAvisoDisparado(clave) {
  const avisos = getUltimosAvisos();
  avisos[clave] = Date.now();
  store.set('ultimosAvisos', avisos);
}

module.exports = {
  getTareas,
  saveTarea,
  deleteTarea,
  getConfig,
  saveConfig,
  getUltimosAvisos,
  marcarAvisoDisparado
};
