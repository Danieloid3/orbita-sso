# Verificación de la entrega

## Comandos reproducibles

```bash
npm ci
npm run check
npm run test:package
npm run release:check
```

`check` valida tipos, compila, ejecuta las pruebas Node y revisa que los enlaces locales de documentación/skill existan. `test:package` crea el tarball, lo instala en un consumidor temporal independiente y comprueba exports ESM, tipos TypeScript, compatibilidad con Express/pg y presencia de SQL/skill. Las carpetas temporales se conservan para inspección y no entran al paquete.

## Pruebas cubiertas

- Discovery v1, origen permitido, catálogo completo automático, sincronización concurrente y recuperación de inicialización fallida.
- RS256 firmado con claves generadas para pruebas; audience exacta, firma inválida, expiración, claims obligatorios, roles/tipos, atributos y rotación de kid.
- Cookie opaca y plazo absoluto; state/nonce ausente, incorrecto, expirado, repetido y callbacks concurrentes.
- Introspección activa/revocada, fallos de proveedor, logout POST/Origin/CSRF y revocación local durante caída central.
- Migración aprobada, adopción + reautorización, negativa sin prueba, cuenta ausente, rol desconocido, sujeto/rol distintos y bloqueo de loops.
- Servidor Express real en puerto temporal con peticiones HTTP de login/callback/session, múltiples Set-Cookie y paso a rutas de negocio.
- Esquema y consultas PostgreSQL ejecutados en el motor embebido PGlite: JSON, expiración, namespace, consumo de un uso y borrado de sesiones. Suite adicional opcional con dos pools en un servidor PostgreSQL real.

El proveedor de las pruebas es un doble controlado que firma JWT RS256 reales; no es el Órbita desplegado. No se usaron secretos reales ni se migraron usuarios de producción. La prueba Express sí sirve HTTP real; discovery/token/introspection usan el doble inyectado.

## PostgreSQL real

La suite real requiere una **base desechable dedicada**. Crea las tablas del SDK y borra solo el namespace temporal que generó. Nunca apuntes esta variable a una base de negocio.

PowerShell:

```powershell
$env:ORBITA_TEST_DATABASE_URL = 'postgresql://usuario:clave@localhost:5432/orbita_sdk_test'
npm test
Remove-Item Env:ORBITA_TEST_DATABASE_URL
```

Sin esa variable, la prueba de conexiones PostgreSQL reales aparece como skipped. La aceptación con Docker ejecutó también esa prueba: 55 tests aprobados y ninguno omitido. El esquema y todas las consultas también se ejecutan en PGlite en la suite por defecto; su única conexión no sustituye la prueba con dos pools reales. El workflow CI usa PostgreSQL y Node 22/24.

## Skill

`skills/integrate-orbita-sso/SKILL.md` tiene frontmatter Agent Skills, referencias autónomas y metadatos opcionales de Codex. Su validación de estructura se hace con `quick_validate.py` del skill-creator local. La compatibilidad de discovery puede comprobarse sin instalarla con `npx skills add ./skills --list`.

Esta verificación estructural no equivale a haber observado una integración completa hecha por todos los agentes soportados. La distribución usa `WhiteRabbitCoder/orbita-sso` como fuente GitHub del CLI de skills.sh; el directorio del sitio puede tardar en reflejar una instalación y no se presume indexación inmediata.

## Validación del ambiente objetivo

Antes de usar la app integrada en producción, prueba login real desde tarjeta y botón, asignación/cambio/revocación del rol, revisión administrativa pendiente, estado inactivo de usuario/app, callbacks registrados, logout central y migración aprobada con sus políticas reales. Los ejemplos no sustituyen automáticamente los contratos de sesión o APIs existentes de la aplicación consumidora.
