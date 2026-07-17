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
        // Se dispara en cuanto ya pasó la hora objetivo y no se disparó antes. Sin límite superior
        // estricto: un recordatorio nunca debe perderse en silencio (ej. si la PC estaba apagada o
        // la app tardó en revisar); el tope de 24h solo evita resucitar datos muy viejos/corruptos.
        if (!yaDisparado && diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000) {
          pendientes.push({ tarea, dias: d, hora, clave });
        }
      }
    }
  }

  return pendientes;
}

// Devuelve true si al menos uno de los avisos configurados de la tarea ya venció
// (sin importar si ya se disparó antes) — se usa para la re-insistencia periódica.
function tareaEstaVencida(tarea, ahora = new Date()) {
  const dias = tarea.avisosPrevios && tarea.avisosPrevios.length ? tarea.avisosPrevios : [0];
  const horas = tarea.horarios && tarea.horarios.length ? tarea.horarios : ['09:00'];

  for (const d of dias) {
    const fechaBase = fechaConDiasRestados(tarea.fechaLimite, d);
    for (const hora of horas) {
      const objetivo = combinarFechaHora(fechaBase.toISOString().slice(0, 10), hora);
      if (ahora.getTime() - objetivo.getTime() >= 0) return true;
    }
  }
  return false;
}

module.exports = { calcularAvisosPendientes, combinarFechaHora, fechaConDiasRestados, tareaEstaVencida };
