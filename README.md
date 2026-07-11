# Gestor de Obligaciones

App de escritorio (Electron + Supabase) para un estudio contable en Paraguay: clientes, obligaciones fiscales, calendario de vencimientos, presentaciones, historial y honorarios.

## Instalación rápida

```bash
npm install
cp .env.example .env   # completar con tus credenciales de Supabase
npm start
```

La app pide login (Supabase Auth). No hay alta de usuarios desde la app: creá el usuario a mano en el dashboard de Supabase (Authentication → Users → Add user) y usá esas credenciales para entrar.

## Documentación completa

Ver [`docs/ESTADO_DEL_PROYECTO.md`](docs/ESTADO_DEL_PROYECTO.md): qué está hecho, decisiones de arquitectura, reglas de negocio del calendario perpetuo (SET Paraguay), y pendientes.
