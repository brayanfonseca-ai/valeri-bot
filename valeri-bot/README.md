# valeri-bot

Asistente de WhatsApp de Transportes Vigía (BuilderBot + Meta Cloud API).

Documentación completa:

- Técnica (arquitectura, configuración, despliegue, problemas conocidos): `../docs/ARQUITECTURA_VALERI.md`
- Para empleados (cómo usar Valeri): `../docs/GUIA_USUARIO.md`

## Correr en local

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start          # puerto PORT (3010 por defecto)
```

- Configuración: copiar `.env.example` a `.env` y completar (ver §6 de la documentación técnica).
- Health: `http://localhost:3010/health`
- Webhook de Meta: `/webhook` (necesita una URL pública HTTPS; en local, un túnel al puerto 3010).
