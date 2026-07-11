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
//   - Asumimos cierre fiscal el 31 de diciembre para todos los clientes
//     (no hay todavía un campo de cierre fiscal personalizado por cliente).
// -----------------------------------------------------------------------

const DIA_POR_TERMINACION_RUC = {
  0: 7, 1: 9, 2: 11, 3: 13, 4: 15,
  5: 17, 6: 19, 7: 21, 8: 23, 9: 25,
};

// Mes de vencimiento (1-12) para cada obligación ANUAL. IVA no está acá
// porque es mensual (vence en el mismo mes del período, no en un mes fijo).
const MES_VENCIMIENTO_ANUAL = {
  IRE_SIMPLE: 3,        // marzo (3er mes posterior al cierre)
  IRE_GENERAL: 4,       // abril (4to mes posterior al cierre)
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
function calcularFechaVencimiento({ codigoObligacion, periodicidad, terminacionRuc, periodoAncla, feriadosSet }) {
  if (periodicidad === 'manual') return null;

  const diaBase = DIA_POR_TERMINACION_RUC[terminacionRuc];
  if (diaBase === undefined) return null;

  let anio;
  let mes; // 0-indexado, como usa el objeto Date de JavaScript

  if (periodicidad === 'mensual') {
    anio = periodoAncla.getFullYear();
    mes = periodoAncla.getMonth();
  } else {
    // Anual: `periodoAncla` representa el EJERCICIO FISCAL que cierra el
    // 31/12 de ese año. El vencimiento cae en marzo/abril del año
    // SIGUIENTE (ver MES_VENCIMIENTO_ANUAL).
    anio = periodoAncla.getFullYear() + 1;
    mes = MES_VENCIMIENTO_ANUAL[codigoObligacion] - 1;
  }

  const fechaBase = new Date(anio, mes, diaBase);
  return ajustarASiguienteDiaHabil(fechaBase, feriadosSet);
}

// Determina cuál es el "período vigente" que el calendario perpetuo debe
// tener siempre generado, según la fecha de hoy. Así no hace falta
// recrear nada a mano cuando cambia el mes o el año.
function obtenerPeriodoVigente(periodicidad, hoy = new Date()) {
  if (periodicidad === 'mensual') {
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  }
  // Anual: el ejercicio fiscal que vence ESTE año calendario es el del
  // año anterior (cierre 31/12 del año pasado, vencimiento este año).
  return new Date(hoy.getFullYear() - 1, 0, 1);
}

module.exports = {
  DIA_POR_TERMINACION_RUC,
  MES_VENCIMIENTO_ANUAL,
  formatearFechaISO,
  ajustarASiguienteDiaHabil,
  calcularFechaVencimiento,
  obtenerPeriodoVigente,
};
