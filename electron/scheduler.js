function combinarFechaHora(fechaISO, hora) {
  const [h, m] = hora.split(':').map(Number);
  const fecha = new Date(`${fechaISO}T00:00:00`);
  fecha.setHours(h, m, 0, 0);
  return fecha;
}

function fechaConDiasRestados(fechaISO, dias) {
  const fecha = new Date(`${fechaISO}T00:00:00`);
  fecha.setDate(fecha.getDate() - dias);
  return fecha;
}

function formatoClave(tareaId, dias, hora, fechaObjetivo) {
  const dia = fechaObjetivo.toISOString().slice(0, 10);
  return `${tareaId}|${dias}|${hora}|${dia}`;
}

// Revisa todas las tareas y devuelve los avisos que deben dispararse en este momento (minuto actual).
function calcularAvisosPendientes(tareas, ultimosAvisos, ahora = new Date()) {
  const pendientes = [];

  for (const tarea of tareas) {
    if (tarea.completada || tarea.eliminada) continue;
    const dias = tarea.avisosPrevios && tarea.avisosPrevios.length ? tarea.avisosPrevios : [0];
    const horas = tarea.horarios && tarea.horarios.length ? tarea.horarios : ['09:00'];

    for (const d of dias) {
      const fechaBase = fechaConDiasRestados(tarea.fechaLimite, d);
      for (const hora of horas) {
        const objetivo = combinarFechaHora(fechaBase.toISOString().slice(0, 10), hora);
        const clave = formatoClave(tarea.id, d, hora, objetivo);
        const yaDisparado = !!ultimosAvisos[clave];
        const diffMs = ahora.getTime() - objetivo.getTime();
        // Se dispara si ya pasó la hora objetivo (hasta 5 minutos de tolerancia) y no se disparó antes.
        if (!yaDisparado && diffMs >= 0 && diffMs < 5 * 60 * 1000) {
          pendientes.push({ tarea, dias: d, hora, clave });
        }
      }
    }
  }

  return pendientes;
}

module.exports = { calcularAvisosPendientes, combinarFechaHora, fechaConDiasRestados };
