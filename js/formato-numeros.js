// js/formato-numeros.js
// -----------------------------------------------------------------------
// Funciones puras para formatear montos en guaraníes con el punto
// separador de miles EN VIVO mientras se escribe en un input de dinero
// (type="text" + inputmode="numeric"). Mismo patrón que
// calendario-logica.js: solo funciones puras, sin tocar Supabase ni el
// DOM -- se importa con require(), nunca se carga como <script>. El
// manejo del evento "input" (mantener la posición del cursor, etc.) vive
// en cada pantalla que lo necesita (js/clientes.js, js/honorarios.js),
// que son quienes sí tocan el DOM.
// -----------------------------------------------------------------------

// Quita todo lo que no sea dígito (puntos separadores, espacios, letras
// pegadas por error, etc.), dejando solo los números. Sirve tanto para
// "limpiar" lo que el usuario tipeó como para recuperar el valor numérico
// real antes de mandarlo a Supabase.
function quitarPuntos(texto) {
  return (texto ?? '').toString().replace(/\D/g, '');
}

// Formatea una cadena de dígitos con el punto separador de miles (es-PY),
// ej. "1000000" -> "1.000.000". Recalcula siempre desde los dígitos, así
// que da igual si el texto de entrada ya traía puntos o no. Devuelve
// cadena vacía si no queda ningún dígito (input vacío).
function formatearConPuntos(texto) {
  const digitos = quitarPuntos(texto);
  if (!digitos) return '';
  return Number(digitos).toLocaleString('es-PY');
}

module.exports = { formatearConPuntos, quitarPuntos };
