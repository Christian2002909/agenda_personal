// main.js
// -----------------------------------------------------------------------
// Este es el "proceso principal" de Electron: el primer archivo que se
// ejecuta cuando abrís la app. Su único trabajo es crear la ventana de
// escritorio y decirle qué archivo HTML tiene que mostrar adentro.
// -----------------------------------------------------------------------

// Cargamos las variables del archivo .env (SUPABASE_URL, SUPABASE_ANON_KEY)
// para que estén disponibles en toda la app, incluso dentro de la ventana.
require('dotenv').config();

const { app, BrowserWindow } = require('electron');

// Crea la ventana principal de la aplicación.
function crearVentanaPrincipal() {
  const ventana = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'Gestor de Obligaciones',
    webPreferences: {
      // -----------------------------------------------------------------
      // NOTA DE SEGURIDAD:
      // Activamos nodeIntegration y desactivamos contextIsolation para que
      // los archivos .js de la interfaz (los que corren "adentro" de la
      // ventana) puedan usar require(), igual que en Node.js. Esto hace el
      // código mucho más simple de entender para alguien que recién
      // empieza a programar.
      //
      // Esto normalmente NO se recomienda en apps que cargan páginas de
      // internet, porque una página maliciosa podría ejecutar código en tu
      // computadora. Pero esta app SOLO carga el archivo index.html que
      // nosotros mismos escribimos (nunca carga sitios externos), así que
      // el riesgo real es muy bajo. Si en el futuro la app llega a cargar
      // contenido remoto, hay que cambiar a un preload.js con contextBridge.
      // -----------------------------------------------------------------
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Le decimos a la ventana que muestre nuestro archivo index.html.
  ventana.loadFile('index.html');

  // Si alguna vez necesitás ver errores de JavaScript de la interfaz,
  // descomentá esta línea para abrir las herramientas de desarrollador:
  // ventana.webContents.openDevTools();
}

// Cuando Electron termina de iniciar, creamos la ventana.
app.whenReady().then(crearVentanaPrincipal);

// En Windows y Linux, cuando se cierran todas las ventanas, cerramos la app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
