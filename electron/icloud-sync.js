const { DAVClient } = require('tsdav');

function crearCliente(config) {
  const { appleId, appPassword } = config.icloudReminders;
  return new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: { username: appleId, password: appPassword },
    authMethod: 'Basic',
    defaultAccountType: 'caldav'
  });
}

function tareaAVTodo(tarea) {
  const fecha = tarea.fechaLimite.replace(/-/g, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VTODO',
    `UID:${tarea.id}@agenda-personal`,
    `SUMMARY:${tarea.titulo}`,
    `DUE;VALUE=DATE:${fecha}`,
    `DESCRIPTION:${(tarea.notas || '').replace(/\n/g, '\\n')}`,
    `STATUS:${tarea.completada ? 'COMPLETED' : 'NEEDS-ACTION'}`,
    'END:VTODO',
    'END:VCALENDAR'
  ].join('\r\n');
}

async function sincronizarTarea(config, tarea) {
  if (!config.icloudReminders.activo || !config.icloudReminders.appleId) return null;
  const client = crearCliente(config);
  await client.login();
  const calendars = await client.fetchCalendars();
  const listaRecordatorios = calendars.find((c) => c.components && c.components.includes('VTODO')) || calendars[0];
  if (!listaRecordatorios) throw new Error('No se encontro una lista de Recordatorios en iCloud');

  const filename = `${tarea.id}.ics`;
  const icalString = tareaAVTodo(tarea);

  // Intentar actualizar primero; si no existe, crear
  try {
    const objetos = await client.fetchCalendarObjects({ calendar: listaRecordatorios });
    const existente = objetos.find((o) => o.url && o.url.includes(filename));
    if (existente) {
      return client.updateCalendarObject({
        calendarObject: { url: existente.url, etag: existente.etag, data: icalString }
      });
    }
  } catch (err) {
    // Si falla la búsqueda, intentamos crear directamente
    console.error('iCloud fetch para update falló, creando nuevo:', err.message);
  }

  return client.createCalendarObject({
    calendar: listaRecordatorios,
    filename,
    iCalString: icalString
  });
}

module.exports = { sincronizarTarea };
