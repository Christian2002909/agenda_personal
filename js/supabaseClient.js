// js/supabaseClient.js
// -----------------------------------------------------------------------
// Este archivo hace UNA sola cosa: crear la conexión a Supabase y dejarla
// lista para que el resto de la app la use (por ejemplo, en clientes.js).
// -----------------------------------------------------------------------

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Si todavía no completaste el archivo .env, createClient() de Supabase
// directamente ROMPE la app entera (lanza un error apenas se llama). Por
// eso, mientras falten las credenciales, dejamos "supabase" en null en vez
// de crear el cliente: así el resto de la app puede arrancar igual y
// mostrar un aviso claro, en lugar de una pantalla rota.
let supabase = null;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    'Faltan las variables SUPABASE_URL y/o SUPABASE_ANON_KEY. ' +
      'Copiá el archivo .env.example como .env y completá tus credenciales reales de Supabase.'
  );
} else {
  // Este objeto "supabase" es el que vamos a usar en toda la app para leer
  // y guardar datos. Por ejemplo: supabase.from('clientes').select('*')
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

module.exports = supabase;
