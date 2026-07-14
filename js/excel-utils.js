// js/excel-utils.js
// -----------------------------------------------------------------------
// Funciones puras/compartidas para importar y exportar archivos .xlsx con
// la librería `exceljs`. La usa únicamente js/clientes.js, para
// importar/exportar la cartera de Clientes en un libro de 2 hojas
// ("Clientes" con los datos básicos + obligaciones, "Honorarios" con lo
// financiero por cliente) -- js/honorarios.js es una pantalla 100% manual,
// sin ningún botón de Excel.
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

// `require('exceljs')` a nivel de archivo, sin try/catch, ROMPÍA por
// completo tanto a js/clientes.js como a js/honorarios.js si por cualquier
// motivo el paquete no estaba instalado (por ejemplo: se hizo `git pull` de
// una rama que agregó esta dependencia -- ver commit "Cambiar la libreria
// de Excel de xlsx a exceljs" -- sin volver a correr `npm install`; como
// node_modules/ está en .gitignore, un `git pull` nunca lo instala solo).
// El `require()` de este archivo pasa como la primera línea ejecutable de
// clientes.js/honorarios.js, ANTES que cualquier document.getElementById(),
// definición de función o listener de esos dos archivos -- si tira, TODO
// el resto del archivo que lo importa queda sin ejecutar: ni el
// autocompletado de RUC, ni los checkboxes de "Obligaciones de este
// cliente", ni el <select> de Responsable, ni la tabla de Honorarios ni el
// selector "Ver cartera de" se llegan a dibujar, y como mostrarMensaje()
// tampoco llegó a definirse, no aparece ningún cartel de error en la
// pantalla -- solo una excepción no capturada en la consola de DevTools.
//
// Para que un problema de esta librería (que solo hace falta para
// Importar/Exportar Excel) no tumbe pantallas enteras que no tienen nada
// que ver con Excel, dejamos `ExcelJS` en null si el require() falla, y
// recién avisamos con un mensaje claro (ver exigirExcelJS) cuando el
// usuario intenta usar una función que sí lo necesita -- mismo criterio
// que ya usa js/supabaseClient.js con las credenciales de Supabase.
let ExcelJS = null;
try {
  ExcelJS = require('exceljs');
} catch (error) {
  console.error(
    'No se pudo cargar la librería "exceljs" (Importar/Exportar Excel no va a funcionar hasta solucionarlo). ' +
      '¿Falta correr "npm install" después de un git pull reciente?',
    error
  );
}

// Se usa para distinguir, en los catch de clientes.js/honorarios.js, el
// caso "la librería de Excel no está disponible" (mensaje accionable: hay
// que correr npm install) del caso "el archivo .xlsx que subió el usuario
// está mal" (mensaje genérico que ya mostraban esas pantallas).
class ErrorLibreriaExcelNoDisponible extends Error {}

function exigirExcelJS() {
  if (!ExcelJS) {
    throw new ErrorLibreriaExcelNoDisponible(
      'No se pudo cargar la librería de Excel (exceljs). Cerrá la app, corré "npm install" en la carpeta del proyecto (así se termina de instalar) y volvé a abrirla.'
    );
  }
}

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
// usando la primera fila de la hoja elegida como encabezados (columnas).
// Las celdas vacías quedan como string vacío en vez de no aparecer en el
// objeto (más simple de validar fila por fila). Las filas completamente
// vacías se saltean.
//
// `hoja` identifica QUÉ hoja leer del libro, y es opcional -- si no se
// pasa, se sigue leyendo la primera hoja (índice 0), igual que antes de
// que existiera este parámetro, así que cualquier llamador viejo sigue
// funcionando sin cambios. Acepta:
//   - un número: índice 0-based dentro de `libro.worksheets` (mismo orden
//     en que se agregaron las hojas al workbook, ej. 0 = primera, 1 =
//     segunda).
//   - un string: nombre exacto de la hoja (el que se le puso con
//     `addWorksheet` al generar el archivo, ej. "Clientes" u
//     "Honorarios"), resuelto con `libro.getWorksheet(nombre)`. Útil
//     cuando un mismo archivo trae varias hojas y no se puede asumir su
//     orden (ej. si alguien reordenó las hojas a mano en Excel).
// Si la hoja pedida no existe (número fuera de rango, o ningún nombre
// coincide), devuelve un array vacío en vez de tirar error -- mismo
// criterio que ya tenía esta función cuando el archivo no tenía ninguna
// hoja.
async function leerFilasDeArchivoExcel(archivo, hoja = 0) {
  exigirExcelJS();
  const buffer = await archivo.arrayBuffer();
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);

  const hojaExcel = typeof hoja === 'string' ? libro.getWorksheet(hoja) : libro.worksheets[hoja];
  if (!hojaExcel) return [];

  const encabezados = [];
  hojaExcel.getRow(1).eachCell({ includeEmpty: true }, (celda, numeroColumna) => {
    encabezados[numeroColumna] = celdaValorPlano(celda.value);
  });

  const filas = [];
  for (let numeroFila = 2; numeroFila <= hojaExcel.rowCount; numeroFila++) {
    const fila = hojaExcel.getRow(numeroFila);
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
  exigirExcelJS();
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
  ErrorLibreriaExcelNoDisponible,
};
