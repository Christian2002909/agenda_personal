# Pedidos pendientes

Este documento junta, en las palabras del usuario, todo lo que falta implementar. Se va completando ANTES de escribir código — cada pedido se anota acá tal cual se pidió, y recién cuando el usuario dice "arrancamos" se pasa a codificar. No borrar ítems de acá salvo que el usuario lo pida explícitamente; al implementar uno, marcarlo como hecho en vez de borrarlo.

## Pantalla de Login

- [ ] **Guardar la información / autocompletado**: que el navegador/Electron pueda recordar y autocompletar el email (y posiblemente la contraseña) al escribir en el login, para no tener que tipearlos cada vez. Hoy los campos del formulario de login no lo permiten.
- [ ] **"Olvidé mi contraseña"**: agregar un link/flujo de recuperación de contraseña en la pantalla de login (Supabase Auth ya lo soporta por mail, hoy la app no lo expone).

## Pantalla Presentaciones (y probablemente otras — ver bug de fondo)

- [ ] **[BUG] Cartel rojo "No se pudieron cargar las presentaciones" queda pegado aunque la tabla cargue bien.** Causa encontrada: cada pantalla intenta cargar datos apenas arranca la app, antes de terminar de loguearse (a propósito, así está documentado); ese primer intento falla porque todavía no hay sesión, y muestra el cartel de error — pero el código nunca lo vuelve a OCULTAR cuando la carga real después del login sale bien. Afecta al menos a Presentaciones (`presentaciones-mensaje`) y Calendario (`calendario-mensaje`); hay que revisar si también pasa en Historial/Honorarios/Configuración y corregir en todas: ocultar el mensaje de error apenas una carga se complete con éxito.
- [ ] **Sacar la columna "Fecha"** de la tabla de Presentaciones (fecha en que se marcó presentado) — no hace falta mostrarla ahí.

## Pantalla Clientes

- [ ] **Campo "Responsable" pasa de texto libre a lista desplegable**: en vez de tipear el nombre a mano (hoy `placeholder="Ej: Christian"`), mostrar un `<select>` con los nombres de la gente que ya tiene su usuario creado en el sistema (se lee de la tabla `perfiles`). Alcance confirmado por el usuario: SOLO este cambio de campo — no incluye (todavía) filtrar/ver la cartera de cada uno, eso sigue pausado aparte.
- [ ] **Al tildar las obligaciones del cliente, agregar RG 90 como DOS opciones separadas** ("RG 90 Mensual" cód. 955 y "RG 90 Anual" cód. 956) para que cada cliente tenga marcada la que le corresponde (según tenga IVA o no) — mismo patrón de checkbox que ya usan IVA/IRE/IRP-RSP/etc. Depende de que RG 90 se agregue primero al catálogo de obligaciones (ver ítem en Calendario más abajo).
- [ ] **Sacar la sección "Membrete para la ficha de pago (opcional)" de este formulario** (el override por cliente individual, con nombre/dirección/teléfono). **CONFIRMADO por el usuario**: no se reemplaza por nada en Honorarios — el membrete queda ÚNICO Y CENTRALIZADO en Configuración ("Membrete General"), usado para TODOS los clientes por igual, sin override por cliente. Ver ítem actualizado en Configuración más abajo.

## Pantalla Configuración

- [ ] **El "Membrete General" existente pasa a ser el único membrete del sistema** (ya no hay override por cliente — ver ítem de arriba en Clientes). Se usa para todos los clientes por igual al generar cualquier ficha de pago.
- [ ] **Agregar soporte de logo** (imagen) a esa misma sección de membrete — hoy solo tiene nombre/dirección/teléfono/nota de vencimiento, todo texto.

## Pantalla Calendario

- [ ] **Volver a mostrar la columna "Obligación"** en la tabla del Calendario — ATENCIÓN: esto es lo contrario de lo que se había pedido antes (`docs/ESTADO_DEL_PROYECTO.md` dice "el Calendario ya no muestra la columna Obligación, pedido explícito del usuario"). Confirmado de nuevo ahora: agregarla de vuelta.
- [ ] **Nueva obligación: RG 90 (Registro de Comprobantes, Marangatu)** — investigado a fondo (DNIT, Resolución General N° 90/2021 y modificatorias). Dos variantes/códigos, cada una con su propia regla de vencimiento:
  - **Código 955 (mensual)**: para contribuyentes de IVA + IRP-RSP, o IVA + IRE SIMPLE. Vencimiento: el mismo día/plazo que IVA (misma fecha por terminación de RUC, mismo mes) — se puede calcular reutilizando la lógica que ya existe para IVA.
  - **Código 956 (anual)**: para contribuyentes de IRP-RSP que NO son contribuyentes de IVA. Vencimiento: **el segundo mes posterior al cierre del ejercicio fiscal** (ejemplo: cierre en diciembre → vence en febrero), a diferencia de IRE SIMPLE/IRP-RSP que vencen en el tercer mes (marzo). **Día exacto dentro de ese segundo mes todavía sin confirmar** — las fuentes no lo precisan más allá de "según el cronograma de vencimientos de declaraciones juradas informativas"; probablemente siga la misma tabla de terminación de RUC que las demás, pero hay que confirmarlo antes de programarlo (no asumir).
  - Aunque el contribuyente no haya tenido movimientos en el mes/año, igual tiene que hacer la confirmación (declaración en cero) — o sea, siempre genera un vencimiento, nunca se puede asumir "no aplica" por falta de actividad.
  - Al confirmarse, Marangatu genera un "Comprobante de Presentación" — mapea directo al mecanismo que ya existe en el sistema (checkbox de presentado + fecha), no hace falta un mecanismo nuevo aparte del que ya tienen IVA/IRE/etc.
  - Fuentes: [RG N° 90 — DNIT](https://www.dnit.gov.py/documents/d/global/rg-n-90-registro-de-comprobantes-de-ingresos-ventas-egresos-y-compras_07_05_2021), [Guía paso a paso — confirmar presentación de comprobantes (DNIT)](https://www.dnit.gov.py/documents/20123/224724/Guia+Paso+a+Paso+-+C%C3%B3mo+confirmar+la+presentaci%C3%B3n+de+los+comprobantes+registrados.pdf), [Registro electrónico de comprobantes — Resolución 90/2021 (Estudio Contable Lic. Elisabeth Neufeld de Mueller)](https://www.ecmueller.com.py/es/registro-electronico-de-comprobantes-res-90-2021/), [Conclusiones — Registro de Documentos Sistema Marangatu RG N° 90 (II) — Rodríguez Silvero & Asociados](https://rsa.com.py/conclusiones-registro-de-documentos-sistema-marangatu-rg-n-90-ii/)

## Pantalla Historial

- [ ] **[BUG] Confirmado: el mismo cartel rojo pegado también aparece acá** ("No se pudo cargar el historial.") — mismo bug de fondo ya anotado arriba (Presentaciones), se corrige junto con las demás pantallas afectadas.
- [ ] **Rediseñar el layout de la grilla mensual** — hoy queda "mal estirada" (la tabla de 12 columnas de mes se corta/desborda feo). Revisar el diseño para que se vea bien sin tener que scrollear tanto.
- [ ] **Historial pasa a ser editable, no solo de lectura**: hoy solo calcula y colorea fechas (verde/rojo/gris) pero no se puede tocar nada. Se pide poder marcar "Presentado" para CUALQUIER período pasado directamente desde acá (no solo el vigente, que es lo único editable hoy desde Presentaciones/Calendario) — motivo: cuando un período termina, Presentaciones lo "limpia" y pasa a Historial de solo lectura, así que si en su momento no se tildó, hoy no hay forma de corregirlo después. Al marcar un período viejo como presentado, la fecha de presentación se pone automática (la fecha de hoy, el día en que se tilda) — **confirmado por el usuario, no hace falta selector de fecha retroactiva**. Implica que Historial va a tener que poder crear/actualizar filas en `presentaciones` para períodos que hoy no tienen fila (la tabla `presentaciones` solo se genera automáticamente para el período vigente).
- [ ] **Ampliar el rango de años visibles**: hoy solo muestra el año actual (mensuales) o actual+anterior (anuales) — se pide un rango más amplio, ejemplo dado por el usuario: 2022, 2023, 2024, 2025, 2026. Definir si es un selector de año o se listan todos esos años a la vez (a confirmar antes de programar).
- [ ] **Agregar RG 90 al filtro de Obligación** (mensual 955 y anual 956), igual que el resto de las obligaciones — depende de que se agregue primero al catálogo (ver ítem en Calendario).

## General (todo el sistema)

- [ ] **Sacar todos los textos de ayuda/explicación** (clase `texto-ayuda`, hay 8 bloques en `index.html`: Honorarios ×2, Calendario ×2, y 4 más en otras pantallas a repasar uno por uno) — no tienen que estar en el sistema.
- [ ] **Placeholders de ejemplo genéricos, no información real**: revisar el resto de los placeholders del sistema por si hay otros casos con nombres/datos reales en vez de ejemplos genéricos (el caso de "Responsable" ya queda resuelto por el ítem de arriba, al pasar a ser una lista en vez de texto libre).

- [ ] **Corrector ortográfico**: que todos los campos de texto de la aplicación (no solo login) tengan corrección/sugerencia de palabras mientras se escribe, como en un navegador normal.
- [ ] **Formato de miles con punto en montos**: los campos de dinero (cuota mensual/anual de honorarios, monto de cada pago) deben mostrarse y/o escribirse con el punto separador de miles para que se lea claro cuánto es — ejemplo: `100.000` en vez de `100000`.
