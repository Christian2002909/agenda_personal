// Capa delgada sobre el puente IPC expuesto en preload.js (window.agenda).
const AgendaStore = {
  listarTareas: () => window.agenda.listarTareas(),
  guardarTarea: (tarea) => window.agenda.guardarTarea(tarea),
  eliminarTarea: (id) => window.agenda.eliminarTarea(id),
  obtenerConfig: () => window.agenda.obtenerConfig(),
  guardarConfig: (config) => window.agenda.guardarConfig(config),
  temaSistema: () => window.agenda.temaSistema(),
  elegirImagenFondo: () => window.agenda.elegirImagenFondo(),
  autenticarGoogle: () => window.agenda.autenticarGoogle(),
  probarCorreo: () => window.agenda.probarCorreo(),
  probarNotificacion: () => window.agenda.probarNotificacion(),
  onSyncError: (cb) => window.agenda.onSyncError(cb)
};
