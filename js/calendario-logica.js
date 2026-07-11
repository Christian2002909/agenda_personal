// js/calendario-logica.js
// -----------------------------------------------------------------------
// Funciones puras de cálculo para el calendario perpetuo de vencimientos.
// "Puras" quiere decir: no tocan Supabase ni el HTML, solo reciben datos
// y devuelven un resultado. Esto las hace fáciles de entender y de
// reutilizar tanto en la pantalla de Calendario como en la de
// Presentaciones (Fase 4).
//
// Reglas confirmadas con la SET (Resolución General 01/2007 y 38/2020):
//   - Cada terminación de RUC tiene un día fijo de vencimiento por mes.
//   - IVA vence ese día del mismo mes (es mensual).
//   - IRE SIMPLE vence en marzo del año siguiente al cierre fiscal.
//   - IRE GENERAL y ESTADO FINANCIERO vencen en abril del año siguiente.
//   - Si la fecha cae sábado, domingo o feriado, se corre al siguiente
//     día hábil.
//   - El cierre fiscal es por cliente (columna `clientes.cierre_fiscal_mes`,
//     1-12, default 12 = diciembre). Todo lo que sigue está expresado en
//     "meses posteriores al cierre", así que funciona para cualquier mes
//     de cierre, no solo diciembre.
// -----------------------------------------------------------------------

const CIERRE_FISCAL_MES_DEFAULT = 12;

const DIA_POR_TERMINACION_RUC = {
  0: 7, 1: 9, 2: 11, 3: 13, 4: 15,
  5: 17, 6: 19, 7: 21, 8: 23, 9: 25,
};

// Cantidad de meses posteriores al cierre fiscal en que vence cada
// obligación ANUAL. IVA no está acá porque es mensual (vence en el mismo
// mes del período, no relativo a un cierre). Con cierre en diciembre esto
// da marzo/abril, que es la regla original confirmada con la SET.
const MESES_POSTERIORES_AL_CIERRE = {
  IRE_SIMPLE: 3,        // 3er mes posterior al cierre
  IRE_GENERAL: 4,       // 4to mes posterior al cierre
  ESTADO_FINANCIERO: 4, // se presenta junto con IRE GENERAL
};

function esFinDeSemana(fecha) {
  const diaSemana = fecha.getDay(); // 0 = domingo, 6 = sábado
  return diaSemana === 0 || diaSemana === 6;
}

// Convierte un objeto Date a texto "YYYY-MM-DD", el formato que usa
// Postgres/Supabase para columnas de tipo date.
function formatearFechaISO(fecha) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

function esFeriado(fecha, feriadosSet) {
  return feriadosSet.has(formatearFechaISO(fecha));
}

// Si la fecha cae en un día inhábil (fin de semana o feriado cargado en
// la tabla `feriados`), avanza día por día hasta el próximo día hábil.
function ajustarASiguienteDiaHabil(fecha, feriadosSet) {
  const resultado = new Date(fecha);
  while (esFinDeSemana(resultado) || esFeriado(resultado, feriadosSet)) {
    resultado.setDate(resultado.getDate() + 1);
  }
  return resultado;
}

// Calcula la fecha de vencimiento de una obligación para un cliente en un
// período determinado. Devuelve un objeto Date, o null si no corresponde
// calcularla automáticamente (obligación "manual", como IDU, o cliente
// sin terminación de RUC cargada todavía).
function calcularFechaVencimiento({
  codigoObligacion,
  periodicidad,
  terminacionRuc,
  periodoAncla,
  feriadosSet,
  cierreFiscalMes = CIERRE_FISCAL_MES_DEFAULT,
}) {
  if (periodicidad === 'manual') return null;

  const diaBase = DIA_POR_TERMINACION_RUC[terminacionRuc];
  if (diaBase === undefined) return null;

  let anio;
  let mes; // 0-indexado, como usa el objeto Date de JavaScript

  if (periodicidad === 'mensual') {
    anio = periodoAncla.getFullYear();
    mes = periodoAncla.getMonth();
  } else {
    // Anual: `periodoAncla` representa el EJERCICIO FISCAL que cierra en
    // el mes `cierreFiscalMes` de ese año. El vencimiento cae N meses
    // después del cierre (ver MESES_POSTERIORES_AL_CIERRE), pudiendo caer
    // en el año siguiente si el cierre + N cruza fin de año.
    const totalMeses = (cierreFiscalMes - 1) + MESES_POSTERIORES_AL_CIERRE[codigoObligacion];
    anio = periodoAncla.getFullYear() + Math.floor(totalMeses / 12);
    mes = totalMeses % 12;
  }

  const fechaBase = new Date(anio, mes, diaBase);
  return ajustarASiguienteDiaHabil(fechaBase, feriadosSet);
}

// Determina cuál es el "período vigente" que el calendario perpetuo debe
// tener siempre generado, según la fecha de hoy. Así no hace falta
// recrear nada a mano cuando cambia el mes o el año.
function obtenerPeriodoVigente(periodicidad, cierreFiscalMes = CIERRE_FISCAL_MES_DEFAULT, hoy = new Date()) {
  if (periodicidad === 'mensual') {
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  }
  // Anual: el ejercicio vigente es el que cerró más recientemente. Si ya
  // pasamos el mes de cierre de este año, es el de este año; si todavía
  // no llegamos, es el del año pasado (con cierre en diciembre esto da
  // siempre "año pasado", que es la regla original).
  const mesHoy = hoy.getMonth() + 1;
  const anioEjercicio = mesHoy > cierreFiscalMes ? hoy.getFullYear() : hoy.getFullYear() - 1;
  return new Date(anioEjercicio, 0, 1);
}

module.exports = {
  CIERRE_FISCAL_MES_DEFAULT,
  DIA_POR_TERMINACION_RUC,
  MESES_POSTERIORES_AL_CIERRE,
  formatearFechaISO,
  ajustarASiguienteDiaHabil,
  calcularFechaVencimiento,
  obtenerPeriodoVigente,
};
