# Publicar en npm y distribuir la skill

## Entrega preparada

El nombre es `orbita-sso`, versión inicial `1.0.0`, público y licencia MIT. El nombre respondió 404 en el registro al prepararlo; eso no reserva el nombre. npm decide disponibilidad y permisos al publicar. Si cambia antes de publicar, actualiza `name` y los imports de documentación/ejemplos/skill, luego repite los checks.

Esta carpeta es un proyecto independiente del monorepo de Match. La fuente de distribución es `WhiteRabbitCoder/orbita-sso` en GitHub. Publicar no requiere tocar claves o credenciales de Railway. Comprueba el registro npm para conocer las versiones publicadas.

## Publicar el paquete

Desde esta carpeta, con Node 22+:

```bash
npm ci
npm run release:check
npm run test:package
npm pack
npm login
npm whoami
npm publish --access public
```

`prepublishOnly` ejecuta typecheck y tests. `prepack` compila. `files` limita el contenido a código compilado, documentación, ejemplos, SQL, skill y archivos de licencia; no contiene `.env`, fuentes de pruebas, dependencias instaladas ni datos de tus aplicaciones.

Puedes publicar el artefacto ya construido:

```bash
npm login
npm publish ./orbita-sso-1.0.0.tgz --access public
```

Al publicar un tarball, no se vuelven a ejecutar los scripts del proyecto: usa el artefacto validado y no lo edites después. npm puede pedir autenticación/2FA en el navegador; complétala con tu cuenta. No necesitas poner un token npm dentro del repositorio.

Una vez publicado:

```bash
npm view orbita-sso version
npm install orbita-sso
```

La URL del registro es `https://www.npmjs.com/package/orbita-sso`. El paquete es ESM con declaraciones TypeScript y sus metadatos apuntan al repositorio `https://github.com/WhiteRabbitCoder/orbita-sso`.

Para releases futuras usa SemVer: patch para correcciones compatibles, minor para capacidades compatibles y major para contratos incompatibles. npm no permite reemplazar una versión publicada. Actualiza CHANGELOG, revisa ejemplos/skill y repite los checks.

Fuentes oficiales: [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) y [paquetes públicos sin scope](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).

## Distribuir la skill con skills.sh

La plataforma es **skills.sh**. La skill está en `skills/integrate-orbita-sso/`, con entrypoint, referencias autónomas y metadatos opcionales de Codex. Funciona con agentes compatibles con el formato Agent Skills; no depende del resto del workspace.

Publica esta carpeta de proyecto en un repositorio GitHub accesible a quienes deban instalarla. Para distribución pública usa un repo público y conserva la estructura `skills/integrate-orbita-sso/SKILL.md`. Puedes publicar código y skill en el mismo repo. El repositorio público de esta distribución es `WhiteRabbitCoder/orbita-sso`:

```bash
# Ver lo disponible sin instalar
npx skills add WhiteRabbitCoder/orbita-sso --list
# Instalación en el proyecto para el agente elegido por el CLI
npx skills add WhiteRabbitCoder/orbita-sso --skill integrate-orbita-sso
# Instalación para Codex
npx skills add WhiteRabbitCoder/orbita-sso --skill integrate-orbita-sso --agent codex
# Todos los agentes soportados, sin preguntas
npx skills add WhiteRabbitCoder/orbita-sso --skill integrate-orbita-sso --agent '*' --yes
```

Para instalación global agrega `--global`. Que el CLI soporte varios agentes no significa que cada agente del mercado soporte skills; comprueba los destinos soportados por su versión.

La documentación de skills.sh indica que el directorio/leaderboard registra instalaciones mediante telemetría del CLI; no se hace `npm publish` para la skill ni se sube un ZIP directamente al sitio. No se garantiza aparición inmediata ni una posición en el ranking. [FAQ oficial](https://skills.sh/docs/faq), [CLI y destinos soportados](https://github.com/vercel-labs/skills).

Prueba local antes de crear el remoto:

```bash
npx skills add ./skills --list
npx skills add ./skills --skill integrate-orbita-sso --agent codex
```

También se incluye dentro del paquete npm. Después de instalar la dependencia:

```bash
npx skills add ./node_modules/orbita-sso/skills --skill integrate-orbita-sso
```

Ejemplo de instrucción al agente: «Usa integrate-orbita-sso para integrar esta app con Órbita. Conserva su modelo de usuarios, sincroniza su catálogo y verifica el login». En Codex puede invocarse como `$integrate-orbita-sso`.

Cuando actualices la API del paquete, actualiza la skill y sus referencias en el mismo release. La skill declara compatibilidad con el major 1 y el contrato proveedor 1.0.
