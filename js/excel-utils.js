// js/excel-utils.js
// -----------------------------------------------------------------------
// Funciones puras/compartidas para importar y exportar archivos .xlsx con
// la librería `exceljs`. Las usan js/clientes.js (importar/exportar
// Clientes) y js/honorarios.js (importar cuotas/pagos, exportar
// Honorarios).
//
// Se usa `exceljs` en vez de `xlsx` (SheetJS) a propósito: la versión de
// `xlsx` publicada en el registro de npm tiene dos vulnerabilidades de
// severidad alta sin fix disponible ahí (SheetJS solo publica el parche
// en su propio CDN, no en npm). Como esta pantalla justamente parsea
// archivos .xlsx que puede traer cualquiera (no necesariamente generados
// por esta misma app), no vale la pena asumir ese riesgo pudiendo usar
// una librería sin vulnerabilidades conocidas para el mismo trabajo.
//
// Igual que js/calendario-logica.js, este archivo NUNCA se carga como
// <script> en index.html -- solo se importa con require() desde las
// pantallas que lo necesitan, así que no hace falta envolverlo en un
// (function () { ... })() (el sistema de módulos de Node ya le da un
// alcance propio a sus variables de nivel superior).
//
// No hay IPC ni cambios en main.js: leer un archivo se hace con
// `File.prototype.arrayBuffer()` sobre lo que entrega un
// <input type="file"> (proceso de renderer, permitido por
// nodeIntegration: true), y descargar un archivo se hace armando un
// Blob + <a download> temporal, dejando que Chromium/el SO manejen el
// diálogo de guardado -- mismo espíritu que la ficha de pago en PDF de
// js/honorarios.js (generarFichaPago -> window.print()).
// -----------------------------------------------------------------------

const ExcelJS = require('exceljs');

// Convierte el valor "crudo" de una celda de exceljs a un valor plano de
// JS (string/number/Date/boolean), igual que hacía `xlsx` antes: resuelve
// fórmulas (toma el resultado, no la fórmula en sí), texto enriquecido, e
// hipervínculos (toma el texto visible). Las fechas quedan como objetos
// Date de JS, necesario para la columna "Fecha de Pago" del importador de
// Historial de Pagos.
function celdaValorPlano(valor) {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor;
  if (typeof valor === 'object') {
    if ('result' in valor) return celdaValorPlano(valor.result); // celda con fórmula
    if ('richText' in valor) return valor.richText.map((parte) => parte.text).join('');
    if ('text' in valor) return valor.text; // hipervínculo
  }
  return valor;
}

// Lee un archivo .xlsx (el File que entrega un <input type="file">) y
// devuelve una Promise que resuelve a un array de objetos, uno por fila,
// usando la primera fila de la primera hoja como encabezados (columnas).
// Las celdas vacías quedan como string vacío en vez de no aparecer en el
// objeto (más simple de validar fila por fila). Las filas completamente
// vacías se saltean.
async function leerFilasDeArchivoExcel(archivo) {
  const buffer = await archivo.arrayBuffer();
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);

  const hoja = libro.worksheets[0];
  if (!hoja) return [];

  const encabezados = [];
  hoja.getRow(1).eachCell({ includeEmpty: true }, (celda, numeroColumna) => {
    encabezados[numeroColumna] = celdaValorPlano(celda.value);
  });

  const filas = [];
  for (let numeroFila = 2; numeroFila <= hoja.rowCount; numeroFila++) {
    const fila = hoja.getRow(numeroFila);
    if (fila.cellCount === 0) continue;

    const objetoFila = {};
    let tieneAlgunValor = false;

    for (let numeroColumna = 1; numeroColumna < encabezados.length; numeroColumna++) {
      const encabezado = encabezados[numeroColumna];
      if (!encabezado) continue;

      const valor = celdaValorPlano(fila.getCell(numeroColumna).value);
      if (valor !== '' && valor !== null && valor !== undefined) tieneAlgunValor = true;
      objetoFila[encabezado] = valor;
    }

    if (tieneAlgunValor) filas.push(objetoFila);
  }

  return filas;
}

// Arma un workbook .xlsx con una o varias hojas y dispara la descarga
// (Blob + <a download> temporal, sin tocar el proceso principal de
// Electron). `hojas` es un array de { nombre, filas } -- filas es un
// array de objetos planos (una fila por objeto, las claves son las
// columnas, tomadas del primer objeto de cada hoja).
async function descargarComoExcel(nombreArchivo, hojas) {
  const libro = new ExcelJS.Workbook();

  for (const { nombre, filas } of hojas) {
    // Excel no acepta nombres de hoja de más de 31 caracteres.
    const hoja = libro.addWorksheet(nombre.slice(0, 31));
    if (filas.length === 0) continue;

    hoja.columns = Object.keys(filas[0]).map((clave) => ({ header: clave, key: clave }));
    for (const fila of filas) hoja.addRow(fila);
  }

  const buffer = await libro.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

// Normaliza el valor de una celda "Sí"/"No" a booleano. Acepta variantes
// razonables (con/sin tilde, mayúsculas, "true"/"1"/"x"); cualquier otra
// cosa (incluida una celda vacía) se interpreta como "No", tal como pide
// el pedido ("Sí"/"No", o vacío = No).
function celdaEsAfirmativa(valor) {
  if (valor === null || valor === undefined) return false;
  const texto = String(valor).trim().toLowerCase();
  return texto === 'sí' || texto === 'si' || texto === 'true' || texto === '1' || texto === 'x';
}

// Texto de una celda, recortado; null/undefined se devuelve como string
// vacío para no tener que repetir el chequeo en cada validación de fila.
function celdaTexto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

// Número de una celda, o null si está vacía / no es un número válido (en
// vez de NaN, que complica los "if" de validación en cada importador).
function celdaNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

module.exports = {
  leerFilasDeArchivoExcel,
  descargarComoExcel,
  celdaEsAfirmativa,
  celdaTexto,
  celdaNumero,
};
