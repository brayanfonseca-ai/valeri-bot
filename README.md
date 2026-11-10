# Valeri

Asistente de WhatsApp de Recursos Humanos de Transportes Vigía.
Construida con BuilderBot + WhatsApp Cloud API (Meta) sobre Node.js 24 y TypeScript.

| Carpeta / archivo | Contenido |
|---|---|
| `valeri-bot/` | Código del bot |
| `docs/ARQUITECTURA_VALERI.md` | Documentación técnica completa (arquitectura, configuración, despliegue, problemas conocidos) |
| `docs/GUIA_USUARIO.md` | Guía de uso para empleados |

## Inicio rápido

```powershell
cd valeri-bot
copy .env.example .env    # completar con las credenciales (no se versionan)
npm install
npm run build
npm start
```

## Seguridad

Este repositorio es **público**. Nunca subir `.env`, tokens, la carpeta `data/` (datos de empleados)
ni certificados. Las credenciales se entregan por un canal privado.
