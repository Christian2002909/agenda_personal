let tareas = [];
let config = null;
let diasAvisoTemp = [];
let horariosTemp = [];

function generarId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function diasRestantes(fechaLimite) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const limite = new Date(`${fechaLimite}T00:00:00`);
  return Math.round((limite - hoy) / (1000 * 60 * 60 * 24));
}

// ---------- Tema / color / panel / fondo ----------

async function aplicarTema() {
  let tema = config.tema;
  if (tema === 'sistema') {
    tema = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  }
  document.documentElement.setAttribute('data-tema', tema);
}

function aplicarColor() {
  document.documentElement.setAttribute('data-color', config.colorPrograma);
}

function aplicarPosicionPanel() {
  document.getElementById('app').setAttribute('data-posicion', config.posicionPanel);
}

function aplicarFondo() {
  const body = document.body;
  const { tipo, valor } = config.fondo || { tipo: 'degradado', valor: '' };

  // Limpiar cualquier estilo/atributo previo
  body.style.background = '';
  body.style.backgroundImage = '';
  body.style.backgroundColor = '';
  delete body.dataset.fondo;

  if (tipo === 'lavanda' || tipo === 'tulipanes') {
    // El degradado decorativo lo define themes.css según data-fondo
    body.dataset.fondo = tipo;
  } else if (tipo === 'color') {
    body.style.background = valor || '';
  } else if (tipo === 'imagen' && valor) {
    body.dataset.fondo = 'imagen';
    body.style.backgroundImage = `url("file://${valor.replace(/\\/g, '/')}")`;
    body.style.backgroundSize = 'cover';
    body.style.backgroundPosition = 'center';
    body.style.backgroundAttachment = 'fixed';
  }
  // tipo 'degradado' => sin overrides => usa el degradado por defecto de base.css
}

// Muestra el selector de color solo para "Color sólido" y el botón de imagen solo para "Imagen".
function actualizarControlesFondo() {
  const tipo = document.getElementById('cfg-fondo-tipo').value;
  document.getElementById('cfg-fondo-color').hidden = tipo !== 'color';
  document.getElementById('btn-elegir-imagen').hidden = tipo !== 'imagen';
}

function aplicarConfigVisual() {
  aplicarTema();
  aplicarColor();
  aplicarPosicionPanel();
  aplicarFondo();
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (config && config.tema === 'sistema') aplicarTema();
});

// ---------- Navegación ----------

function cambiarVista(vista) {
  document.querySelectorAll('.vista').forEach((v) => v.setAttribute('hidden', ''));
  document.getElementById(`vista-${vista}`).removeAttribute('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('activo', b.dataset.view === vista));
  if (vista === 'historial') renderHistorial();
}

// ---------- Render de tareas ----------

function tareasActivas() {
  return tareas
    .filter((t) => !t.completada && !t.eliminada)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.fechaLimite.localeCompare(b.fechaLimite));
}

function proximoOrden() {
  const ords = tareas.map((t) => t.orden ?? 0);
  return ords.length ? Math.max(...ords) + 1 : 0;
}

function crearTarjeta(tarea, modo) {
  const restantes = diasRestantes(tarea.fechaLimite);
  const card = document.createElement('div');
  card.className = 'tarjeta-tarea glass' + (tarea.completada ? ' completada' : '');
  card.dataset.id = tarea.id;

  let badge;
  if (modo === 'historial') {
    badge = tarea.eliminada
      ? '<span class="badge vencida">Eliminada</span>'
      : '<span class="badge">Completada</span>';
  } else {
    badge = `<span class="badge ${restantes < 0 ? 'vencida' : restantes <= 1 ? 'urgente' : ''}">${restantes < 0 ? 'Vencida' : restantes === 0 ? 'Hoy' : `${restantes} día(s)`}</span>`;
  }

  const acciones = modo === 'historial'
    ? `<button class="btn-secundario btn-reabrir">Reabrir</button>
       <button class="btn-peligro btn-borrar-def">Eliminar definitivamente</button>`
    : `<button class="btn-secundario btn-completar">Completar</button>
       <button class="btn-secundario btn-editar">Editar</button>
       <button class="btn-peligro btn-eliminar">Eliminar</button>`;

  card.innerHTML = `
    <div class="tarjeta-cabecera">
      <h3>${escaparHtml(tarea.titulo)}</h3>
      ${badge}
    </div>
    <p class="tarjeta-fecha">Último día: ${tarea.fechaLimite}</p>
    ${tarea.notas ? `<p class="tarjeta-notas">${escaparHtml(tarea.notas)}</p>` : ''}
    <div class="tarjeta-chips">
      ${(tarea.avisosPrevios || []).map((d) => `<span class="chip">${d}d antes</span>`).join('')}
      ${(tarea.horarios || []).map((h) => `<span class="chip">${h}</span>`).join('')}
    </div>
    <div class="tarjeta-acciones">${acciones}</div>
  `;

  if (modo === 'historial') {
    card.querySelector('.btn-reabrir').addEventListener('click', async () => {
      tarea.completada = false;
      tarea.eliminada = false;
      tarea.orden = proximoOrden();
      tareas = await AgendaStore.guardarTarea(tarea);
      renderTareas();
      renderHistorial();
    });
    card.querySelector('.btn-borrar-def').addEventListener('click', async () => {
      if (confirm('¿Eliminar esta tarea para siempre? No se podrá recuperar.')) {
        tareas = await AgendaStore.eliminarTarea(tarea.id);
        renderHistorial();
      }
    });
  } else {
    card.setAttribute('draggable', 'true');
    card.querySelector('.btn-editar').addEventListener('click', () => abrirModal(tarea));
    card.querySelector('.btn-completar').addEventListener('click', async () => {
      tarea.completada = true;
      tarea.completadaEn = new Date().toISOString();
      tareas = await AgendaStore.guardarTarea(tarea);
      renderTareas();
    });
    card.querySelector('.btn-eliminar').addEventListener('click', async () => {
      tarea.eliminada = true;
      tarea.eliminadaEn = new Date().toISOString();
      tareas = await AgendaStore.guardarTarea(tarea);
      renderTareas();
    });
  }

  return card;
}

function renderTareas() {
  const contenedor = document.getElementById('lista-tareas');
  contenedor.innerHTML = '';
  const activas = tareasActivas();

  if (!activas.length) {
    contenedor.innerHTML = '<p class="vacio">No tienes tareas pendientes. Crea una con "+ Nueva tarea".</p>';
    return;
  }

  for (const tarea of activas) contenedor.appendChild(crearTarjeta(tarea, 'activa'));
  habilitarArrastre(contenedor);
}

function renderHistorial() {
  const contenedor = document.getElementById('lista-historial');
  if (!contenedor) return;
  contenedor.innerHTML = '';
  const hist = tareas
    .filter((t) => t.completada || t.eliminada)
    .sort((a, b) => (b.completadaEn || b.eliminadaEn || '').localeCompare(a.completadaEn || a.eliminadaEn || ''));

  if (!hist.length) {
    contenedor.innerHTML = '<p class="vacio">Aún no hay nada en el historial.</p>';
    return;
  }
  for (const tarea of hist) contenedor.appendChild(crearTarjeta(tarea, 'historial'));
}

// ---------- Arrastrar para reordenar ----------

let tarjetaArrastrada = null;

function habilitarArrastre(contenedor) {
  contenedor.querySelectorAll('.tarjeta-tarea').forEach((card) => {
    card.addEventListener('dragstart', () => {
      tarjetaArrastrada = card;
      setTimeout(() => card.classList.add('arrastrando'), 0);
    });
    card.addEventListener('dragend', async () => {
      card.classList.remove('arrastrando');
      tarjetaArrastrada = null;
      await guardarOrdenActual(contenedor);
    });
  });

  contenedor.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!tarjetaArrastrada) return;
    const ref = elementoDestino(contenedor, e.clientX, e.clientY);
    if (ref == null) {
      if (contenedor.lastElementChild !== tarjetaArrastrada) contenedor.appendChild(tarjetaArrastrada);
    } else if (ref !== tarjetaArrastrada && ref.previousElementSibling !== tarjetaArrastrada) {
      contenedor.insertBefore(tarjetaArrastrada, ref);
    }
  });
}

function elementoDestino(contenedor, x, y) {
  const cards = [...contenedor.querySelectorAll('.tarjeta-tarea:not(.arrastrando)')];
  let mejor = null;
  let mejorDist = Infinity;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < mejorDist) { mejorDist = dist; mejor = c; }
  }
  if (!mejor) return null;
  const r = mejor.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const antes = (y < cy) || (Math.abs(y - cy) <= r.height / 2 && x < cx);
  return antes ? mejor : mejor.nextElementSibling;
}

async function guardarOrdenActual(contenedor) {
  const ids = [...contenedor.querySelectorAll('.tarjeta-tarea')].map((c) => c.dataset.id);
  let cambio = false;
  ids.forEach((id, i) => {
    const t = tareas.find((t) => t.id === id);
    if (t && t.orden !== i) { t.orden = i; cambio = true; }
  });
  if (!cambio) return;
  for (const id of ids) {
    const t = tareas.find((t) => t.id === id);
    if (t) tareas = await AgendaStore.guardarTarea(t);
  }
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

// ---------- Modal de tarea ----------

function abrirModal(tarea) {
  const modal = document.getElementById('modal-tarea');
  document.getElementById('modal-titulo').textContent = tarea ? 'Editar tarea' : 'Nueva tarea';
  document.getElementById('tarea-id').value = tarea ? tarea.id : '';
  document.getElementById('tarea-titulo').value = tarea ? tarea.titulo : '';
  document.getElementById('tarea-fecha-limite').value = tarea ? tarea.fechaLimite : '';
  document.getElementById('tarea-notas').value = tarea ? tarea.notas || '' : '';
  document.getElementById('btn-eliminar-tarea').hidden = !tarea;

  diasAvisoTemp = tarea ? [...(tarea.avisosPrevios || [])] : [];
  horariosTemp = tarea ? [...(tarea.horarios || [])] : [];
  renderChipsDias();
  renderChipsHorarios();

  modal.hidden = false;
}

function cerrarModal() {
  document.getElementById('modal-tarea').hidden = true;
}

function renderChipsDias() {
  const cont = document.getElementById('lista-dias-aviso');
  cont.innerHTML = diasAvisoTemp
    .map((d, i) => `<span class="chip removible" data-idx="${i}">${d}d antes ✕</span>`)
    .join('');
  cont.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      diasAvisoTemp.splice(Number(chip.dataset.idx), 1);
      renderChipsDias();
    });
  });
}

function renderChipsHorarios() {
  const cont = document.getElementById('lista-horarios');
  cont.innerHTML = horariosTemp
    .map((h, i) => `<span class="chip removible" data-idx="${i}">${h} ✕</span>`)
    .join('');
  cont.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      horariosTemp.splice(Number(chip.dataset.idx), 1);
      renderChipsHorarios();
    });
  });
}

async function guardarTareaDesdeModal() {
  const titulo = document.getElementById('tarea-titulo').value.trim();
  const fechaLimite = document.getElementById('tarea-fecha-limite').value;
  if (!titulo || !fechaLimite) {
    alert('Completa al menos el título y la fecha límite.');
    return;
  }

  const idExistente = document.getElementById('tarea-id').value;
  const existente = tareas.find((t) => t.id === idExistente);

  const tarea = {
    id: idExistente || generarId(),
    titulo,
    fechaLimite,
    notas: document.getElementById('tarea-notas').value.trim(),
    avisosPrevios: [...diasAvisoTemp],
    horarios: [...horariosTemp],
    completada: existente ? existente.completada : false,
    eliminada: existente ? existente.eliminada : false,
    orden: existente && existente.orden != null ? existente.orden : proximoOrden(),
    creadaEn: existente ? existente.creadaEn : new Date().toISOString()
  };

  tareas = await AgendaStore.guardarTarea(tarea);
  cerrarModal();
  renderTareas();
}

// ---------- Configuración ----------

function cargarFormularioConfig() {
  document.getElementById('cfg-tema').value = config.tema;
  document.getElementById('cfg-color').value = config.colorPrograma;
  document.getElementById('cfg-posicion').value = config.posicionPanel;
  document.getElementById('cfg-fondo-tipo').value = config.fondo.tipo;
  document.getElementById('cfg-fondo-color').value = config.fondo.tipo === 'color' && config.fondo.valor ? config.fondo.valor : '#ffffff';
  actualizarControlesFondo();

  document.getElementById('cfg-email-direccion').value = config.email.direccion;
  document.getElementById('cfg-email-password').value = config.email.appPassword;
  document.getElementById('cfg-email-host').value = config.email.smtpHost;
  document.getElementById('cfg-email-puerto').value = config.email.smtpPort;

  document.getElementById('cfg-autostart').checked = !!config.iniciarConWindows;

  document.getElementById('cfg-google-clientid').value = config.googleCalendar.clientId;
  document.getElementById('cfg-google-clientsecret').value = config.googleCalendar.clientSecret;
  document.getElementById('google-estado').textContent = config.googleCalendar.tokens ? 'Conectado' : 'No conectado';

  document.getElementById('cfg-icloud-appleid').value = config.icloudReminders.appleId;
  document.getElementById('cfg-icloud-password').value = config.icloudReminders.appPassword;
  document.getElementById('cfg-icloud-activo').checked = !!config.icloudReminders.activo;
}

async function guardarConfigDesdeFormulario() {
  const nuevaConfig = {
    tema: document.getElementById('cfg-tema').value,
    colorPrograma: document.getElementById('cfg-color').value,
    posicionPanel: document.getElementById('cfg-posicion').value,
    fondo: {
      tipo: document.getElementById('cfg-fondo-tipo').value,
      valor: document.getElementById('cfg-fondo-tipo').value === 'color'
        ? document.getElementById('cfg-fondo-color').value
        : config.fondo.valor
    },
    email: {
      direccion: document.getElementById('cfg-email-direccion').value.trim(),
      appPassword: document.getElementById('cfg-email-password').value,
      smtpHost: document.getElementById('cfg-email-host').value.trim() || 'smtp.gmail.com',
      smtpPort: Number(document.getElementById('cfg-email-puerto').value) || 465
    },
    iniciarConWindows: document.getElementById('cfg-autostart').checked,
    googleCalendar: {
      ...config.googleCalendar,
      clientId: document.getElementById('cfg-google-clientid').value.trim(),
      clientSecret: document.getElementById('cfg-google-clientsecret').value.trim()
    },
    icloudReminders: {
      appleId: document.getElementById('cfg-icloud-appleid').value.trim(),
      appPassword: document.getElementById('cfg-icloud-password').value,
      activo: document.getElementById('cfg-icloud-activo').checked
    }
  };

  config = await AgendaStore.guardarConfig(nuevaConfig);
  aplicarConfigVisual();
  alert('Configuración guardada.');
}

// ---------- Inicialización ----------

async function init() {
  config = await AgendaStore.obtenerConfig();
  tareas = await AgendaStore.listarTareas();

  aplicarConfigVisual();
  cargarFormularioConfig();
  renderTareas();

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => cambiarVista(btn.dataset.view));
  });
  cambiarVista('agenda');

  document.getElementById('btn-nueva-tarea').addEventListener('click', () => abrirModal(null));
  document.getElementById('btn-cancelar-tarea').addEventListener('click', cerrarModal);
  document.getElementById('btn-guardar-tarea').addEventListener('click', guardarTareaDesdeModal);
  document.getElementById('btn-eliminar-tarea').addEventListener('click', async () => {
    const id = document.getElementById('tarea-id').value;
    if (id && confirm('¿Eliminar esta tarea?')) {
      const tarea = tareas.find((t) => t.id === id);
      if (tarea) {
        tarea.eliminada = true;
        tarea.eliminadaEn = new Date().toISOString();
        tareas = await AgendaStore.guardarTarea(tarea);
      }
      cerrarModal();
      renderTareas();
    }
  });

  document.getElementById('btn-agregar-dia').addEventListener('click', () => {
    const input = document.getElementById('nuevo-dia-aviso');
    const valor = Number(input.value);
    if (!Number.isNaN(valor) && valor >= 0 && !diasAvisoTemp.includes(valor)) {
      diasAvisoTemp.push(valor);
      renderChipsDias();
    }
    input.value = '';
  });

  document.getElementById('btn-agregar-horario').addEventListener('click', () => {
    const input = document.getElementById('nuevo-horario');
    if (input.value && !horariosTemp.includes(input.value)) {
      horariosTemp.push(input.value);
      renderChipsHorarios();
    }
    input.value = '';
  });

  document.getElementById('btn-elegir-imagen').addEventListener('click', async () => {
    const ruta = await AgendaStore.elegirImagenFondo();
    if (ruta) {
      config.fondo = { tipo: 'imagen', valor: ruta };
      document.getElementById('cfg-fondo-tipo').value = 'imagen';
      aplicarFondo();
    }
  });

  // Vista previa en vivo del fondo
  document.getElementById('cfg-fondo-color').addEventListener('input', (e) => {
    config.fondo = { tipo: 'color', valor: e.target.value };
    aplicarFondo();
  });
  document.getElementById('cfg-fondo-tipo').addEventListener('change', (e) => {
    const tipo = e.target.value;
    if (tipo === 'color') {
      config.fondo = { tipo, valor: document.getElementById('cfg-fondo-color').value };
    } else if (tipo === 'imagen') {
      config.fondo = { tipo, valor: config.fondo.valor || '' };
    } else {
      // degradado, lavanda, tulipanes
      config.fondo = { tipo, valor: '' };
    }
    actualizarControlesFondo();
    aplicarFondo();
  });

  // Vista previa en vivo de tema y color
  document.getElementById('cfg-tema').addEventListener('change', (e) => {
    config.tema = e.target.value;
    aplicarTema();
  });
  document.getElementById('cfg-color').addEventListener('change', (e) => {
    config.colorPrograma = e.target.value;
    aplicarColor();
  });
  document.getElementById('cfg-posicion').addEventListener('change', (e) => {
    config.posicionPanel = e.target.value;
    aplicarPosicionPanel();
  });

  document.getElementById('btn-guardar-config').addEventListener('click', guardarConfigDesdeFormulario);

  document.getElementById('btn-google-conectar').addEventListener('click', async () => {
    await guardarConfigDesdeFormulario();
    document.getElementById('google-estado').textContent = 'Conectando... revisa el navegador';
    try {
      config = await AgendaStore.autenticarGoogle();
      document.getElementById('google-estado').textContent = 'Conectado';
    } catch (err) {
      document.getElementById('google-estado').textContent = 'Error: ' + err.message;
    }
  });
}

init();
