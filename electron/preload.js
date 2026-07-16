const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agenda', {
  listarTareas: () => ipcRenderer.invoke('tareas:listar'),
  guardarTarea: (tarea) => ipcRenderer.invoke('tareas:guardar', tarea),
  eliminarTarea: (id) => ipcRenderer.invoke('tareas:eliminar', id),

  obtenerConfig: () => ipcRenderer.invoke('config:obtener'),
  guardarConfig: (config) => ipcRenderer.invoke('config:guardar', config),
  temaSistema: () => ipcRenderer.invoke('config:tema-sistema'),

  elegirImagenFondo: () => ipcRenderer.invoke('dialogo:elegir-imagen'),

  autenticarGoogle: () => ipcRenderer.invoke('google:autenticar'),

  probarCorreo: () => ipcRenderer.invoke('email:probar'),
  probarNotificacion: () => ipcRenderer.invoke('notif:probar'),

  // Avisa al renderer cuando falla la sincronización con Google/iCloud
  onSyncError: (cb) => ipcRenderer.on('sync:error', (evento, mensaje) => cb(mensaje))
});
