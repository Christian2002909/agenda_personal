# Guía: generar el `.exe` y configurar las notificaciones

## Parte 1 — Generar el instalador `.exe` (Windows)

Esto se hace **en tu PC con Windows** (no en la nube).

### Requisitos
- **Node.js 18 o superior** instalado (https://nodejs.org).

### Pasos
1. Abre una terminal (PowerShell) dentro de la carpeta del proyecto:
   ```
   cd C:\Users\Usuario\agenda_personal
   ```
2. Asegúrate de tener el código más reciente:
   ```
   git fetch origin claude/ecc-skill-install-4v2vz0
   git reset --hard origin/claude/ecc-skill-install-4v2vz0
   ```
3. Instala dependencias (si no lo hiciste antes):
   ```
   npm install
   ```
4. Genera el instalador:
   ```
   npm run build:win
   ```
5. Cuando termine, el instalador queda en la carpeta:
   ```
   C:\Users\Usuario\agenda_personal\dist\
   ```
   Busca un archivo tipo **`Agenda Personal Setup 1.0.0.exe`**. Ese es tu instalador:
   haz doble clic para instalar la app en tu PC (o pásalo a otra PC con Windows).

### Notas
- La primera vez, `build:win` descarga unas herramientas; puede tardar unos minutos.
- Las fotos de fondo (lavanda / tulipanes) y el icono ya vienen incluidos dentro del `.exe`.
- Si aparece un aviso de Windows SmartScreen al instalar (porque la app no está
  firmada digitalmente), pulsa "Más información" → "Ejecutar de todas formas". Es
  normal en apps propias sin certificado de firma.

---

## Parte 2 — Configurar las notificaciones

La app avisa de dos formas: **notificación de Windows** y **correo electrónico** (opcional).

### Cómo funcionan los recordatorios
Para cada tarea defines:
- **Fecha límite** ("último día").
- **Avisarme (días antes)**: cuántos días antes del último día quieres el aviso.
  Puedes poner varios (ej. `7`, `3`, `1`, `0`). `0` = el mismo día.
- **Horarios del aviso**: una o varias horas del día (ej. `09:00` y `18:30`).

La app revisa la hora **cada 30 segundos**; cuando coincide un día×horario, dispara
el aviso. Un mismo aviso no se repite.

### A) Notificación de Windows

Para que aparezcan, revisa esto **una sola vez**:

1. **La app debe estar corriendo.** Puede estar en la ventana o minimizada en la
   bandeja del sistema (junto al reloj). Si la cierras del todo, no avisa.
2. **Que inicie con Windows** (recomendado): en la app → **Configuración** →
   marca **"Iniciar Agenda Personal con Windows"** → **Guardar**. Así siempre está
   lista para avisarte.
3. **Permitir notificaciones en Windows:**
   - Windows → **Configuración** → **Sistema** → **Notificaciones**.
   - Verifica que las notificaciones estén **activadas** en general.
   - Busca **"Agenda Personal"** en la lista y actívala (aparece después del
     primer aviso).
4. **Desactiva "No molestar" / "Asistente de concentración":**
   - Windows → Configuración → Sistema → **Asistente de concentración** (o
     "No molestar") → ponlo en **Desactivado**, o las notificaciones se silencian.

### B) Aviso por correo electrónico (opcional)

En la app → **Configuración** → sección **"Avisos por correo"**:

1. **Correo electrónico**: tu dirección (ej. `tucorreo@gmail.com`). Los avisos te
   llegan a ti mismo.
2. **Contraseña de aplicación**: **NO es tu contraseña normal**. Es una clave
   especial que genera tu proveedor:
   - **Gmail**: activa la **verificación en 2 pasos** en tu cuenta de Google, luego
     ve a https://myaccount.google.com/apppasswords y genera una "contraseña de
     aplicación". Pega esos 16 caracteres aquí.
   - **Outlook/Hotmail**: similar, genera una contraseña de aplicación en la
     seguridad de tu cuenta Microsoft.
3. **Servidor SMTP** y **Puerto**: por defecto `smtp.gmail.com` y `465` (Gmail).
   - Outlook: `smtp.office365.com`, puerto `587`.
4. Pulsa **Guardar**.

### Prueba rápida (para no esperar días)
1. Crea una tarea nueva.
2. Fecha límite = **hoy**.
3. En "Avisarme (días antes)" agrega **`0`**.
4. En "Horarios" agrega una hora **1 o 2 minutos en el futuro** (mira tu reloj).
5. Guarda y espera. Debe saltar la notificación de Windows (y el correo si lo
   configuraste).

### Si no aparece la notificación — revisa:
- [ ] ¿La app está abierta o en la bandeja del sistema?
- [ ] ¿Las notificaciones de Windows están activadas para la app?
- [ ] ¿"Asistente de concentración / No molestar" está desactivado?
- [ ] ¿La hora del aviso ya pasó y la fecha/días son correctos?
- [ ] Para el correo: ¿usaste una **contraseña de aplicación** (no la normal) y el
      SMTP/puerto correctos?
