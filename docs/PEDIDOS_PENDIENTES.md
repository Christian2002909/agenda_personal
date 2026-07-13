# Pedidos pendientes

Este documento junta, en las palabras del usuario, todo lo que falta implementar. Se va completando ANTES de escribir código — cada pedido se anota acá tal cual se pidió, y recién cuando el usuario dice "arrancamos" se pasa a codificar. No borrar ítems de acá salvo que el usuario lo pida explícitamente; al implementar uno, marcarlo como hecho en vez de borrarlo.

## Pantalla de Login

- [ ] **Guardar la información / autocompletado**: que el navegador/Electron pueda recordar y autocompletar el email (y posiblemente la contraseña) al escribir en el login, para no tener que tipearlos cada vez. Hoy los campos del formulario de login no lo permiten.
- [ ] **"Olvidé mi contraseña"**: agregar un link/flujo de recuperación de contraseña en la pantalla de login (Supabase Auth ya lo soporta por mail, hoy la app no lo expone).

## General (todo el sistema)

- [ ] **Corrector ortográfico**: que todos los campos de texto de la aplicación (no solo login) tengan corrección/sugerencia de palabras mientras se escribe, como en un navegador normal.
- [ ] **Formato de miles con punto en montos**: los campos de dinero (cuota mensual/anual de honorarios, monto de cada pago) deben mostrarse y/o escribirse con el punto separador de miles para que se lea claro cuánto es — ejemplo: `100.000` en vez de `100000`.
