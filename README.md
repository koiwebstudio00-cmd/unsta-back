# UNSTA · Backend y agente

API HTTP, CRM, sesiones, PostgreSQL/Prisma y coordinación con n8n. Repositorio independiente: no requiere código ni dependencias del frontend.

## Instalación local nueva

Node 24 y Docker para PostgreSQL. Ejecutar desde esta raíz:

```sh
npm ci
npm run demo:setup
npm run db:generate
docker compose --env-file .env.local up -d
npm run db:migrate
npm run build
npm run invite
npm start
```

En la instalación trasladada, `.env.local`, base e invitaciones ya existen: conservarlos. `demo:setup` no sobrescribe configuración existente. `invite` guarda un código de acceso privado en `.local`; no lo envía por correo.

El frontend se configura desde su propio repositorio. Localmente usa esta API en http://127.0.0.1:4100 y se abre en http://localhost:3000.

## Comandos

| Comando | Función |
| --- | --- |
| `npm run dev` | Ejecutar TypeScript con recarga durante desarrollo. |
| `npm run typecheck` | Comprobar tipos sin compilar. |
| `npm run build` | Compilar a `dist` e incluir herramientas, conocimiento y migraciones. |
| `npm start` | Ejecutar JavaScript compilado con Node. |
| `npm run check` | Tipos, workflows y todas las pruebas. |
| `npm run test:contract` | Pruebas puras del contrato y workflows. |
| `npm run test:api` | Pruebas en la base local exclusiva `unsta_demo_test`. |
| `npm run workflows:build` | Regenerar JSON locales de n8n. No publica ni contacta n8n. |
| `npm run workflows:check` | Verificar generación reproducible y estructura. |
| `npm run db:migrate:prod` | Ejecutar migraciones desde el build, con rol de migración. |
| `npm run invite` | Crear invitación en la base configurada, tras compilar. |

Las pruebas de API exigen PostgreSQL local y nunca vacían `unsta_demo`. Para CI se debe crear ese servicio y sus variables aisladas.

## Configuración

`.env.example` describe las variables. Los procesos ejecutados desde esta raíz cargan `.env.local`, sin sobrescribir variables inyectadas por el entorno. Producción recibe las variables desde Dokploy.

- `DATABASE_URL`: rol runtime sin SUPERUSER ni BYPASSRLS.
- `MIGRATION_DATABASE_URL`, `RUNTIME_DB_PASSWORD`: tareas de migración y provisión del rol.
- `POSTGRES_PASSWORD`: PostgreSQL local del Compose.
- `PANEL_ORIGIN`: URL exacta del frontend; igual a su `APP_ORIGIN`.
- `COOKIE_SECURE`: true cuando el panel opera por HTTPS.
- `AGENT_SERVICE_KEY`: credencial que usa n8n para llamar a esta API.
- `N8N_WEBHOOK_KEY`: credencial de los webhooks de entrada a n8n.
- `N8N_CONVERSATION_URL`, `N8N_OPENING_URL`: URLs de producción de los workflows.
- `DISPATCH_ENABLED`: habilita despachos a n8n. Mantener false hasta configurar el recorrido.
- `UNSTA_WORKSPACE_ID`: espacio institucional compartido; conservar el UUID que tiene los datos.
- `HOST`, `PORT`: escucha de la API; contenedores usan 0.0.0.0 y 4100.

La clave del modelo se configura en n8n. Ninguna de estas claves se entrega al navegador.

## Dokploy

Crear un servicio Application conectado a ESTE repositorio, contexto `/`, Dockerfile `/Dockerfile`, puerto interno 4100. PostgreSQL es persistente y se configura aparte; no incluirlo dentro del contenedor de la API.

El Dockerfile compila en una etapa y ejecuta Node con dependencias de producción. La imagen contiene Prisma CLI para una tarea explícita de migración: `npm run db:migrate:prod`. Ejecutarla con las variables del rol de migración antes de arrancar la versión que la requiera; el proceso normal se conecta usando `DATABASE_URL` del rol restringido. No ejecutar resets.

Asignar un dominio HTTPS propio del backend para que n8n y el servidor Next puedan acceder. Configurar `PANEL_ORIGIN`, variables de base y claves antes de activar despacho. `/health` comprueba conexión con PostgreSQL. Mantener una instancia de API durante esta transición; su worker arranca en el mismo proceso.

El Compose de esta carpeta es para desarrollo local y conserva `name: unsta-demo` y su volumen. No cambiar esa identidad ni ejecutar `down -v`: contiene los datos actuales.

## n8n y conocimiento

`agent-contract/` es la fuente de prompts, herramientas, validaciones y generador; `n8n/` contiene los tres workflows derivados; `base-conocimiento/` conserva el conocimiento canónico y sus casos.

Los JSON se generan inactivos y sin credenciales. `agent-contract/config.json` mantiene un origen `.invalid` hasta configurar el backend del despliegue. No importar/publicar ese placeholder sobre los flujos activos. La separación local conserva las claves y utiliza los workflows remotos actuales; el túnel temporal fue restablecido y su URL configurada por el usuario durante la verificación.

Al adoptar un dominio definitivo, configurar `api_base_url`, regenerar, validar y actualizar la instancia n8n. Se admite un host dedicado como `unsta-api.inmobiliarialyc.com.ar`; el dominio raíz y los hosts conocidos `api`, `n8n`, `evoapi` están bloqueados porque corresponden a otros servicios. La URL nunca se acepta desde el mensaje del usuario.

Versiones de conocimiento y hash deben coincidir entre backend y workflows. Mover archivos no cambia el conocimiento ni requiere reimportar los flujos activos si la URL permanece igual.

## Archivos privados y respaldo

`.env.local` y `.local/` están ignorados por Git y Docker. El respaldo previo al traslado está en `.local/separacion-2026-10-31/`. Las conversaciones/capturas históricas permanecen en el proyecto anterior; no se incluyeron indiscriminadamente en Git.

`deploy/evolution-dokploy/` contiene configuración de otro servicio, Evolution; no forma parte de la API ni se inicia con ella. Su instalación en VPS sigue siendo una tarea aparte.

Guías de n8n en `docs/importar-n8n.md`. Estado de la separación y validación en `docs/SEPARACION-2026-10-31.txt`.

## Ingresar al panel desplegado

El acceso actual es por invitación privada, no por contraseña ni registro público.

1. Configurar el dominio HTTPS del frontend: `APP_ORIGIN` en frontend y `PANEL_ORIGIN` en backend deben ser idénticos; `COOKIE_SECURE=true` en ambos. Configurar `API_URL` en frontend con el origen accesible del backend.
2. Con la base migrada, abrir la terminal del contenedor del BACKEND en Dokploy (directorio `/app`) y ejecutar:

   ```sh
   npm run invite -- tu-correo@tu-dominio.com
   ```

3. El comando indica un archivo `.local/invite-….local.json`. Abrir exactamente ese archivo en la terminal privada y copiar únicamente el valor `token`, sin comillas.
4. Abrir el dominio del FRONTEND y pegar el token en «Código de invitación».

No se envía correo automáticamente y el email no se verifica: es una identificación del evaluador. Cada código permite un ingreso, vence a las 24 horas y crea una sesión de siete días en ese navegador. Para entrar desde otro navegador, cerrar sesión o volver a ingresar tras vencer la sesión, generar otro código. No hay un código universal compartido.

Todas las invitaciones acceden a los mismos datos de UNSTA mediante `UNSTA_WORKSPACE_ID`; mantener ese UUID al trasladar la base. Una base nueva comienza sin los leads locales: desplegar código no copia los datos. Las invitaciones deben crearse en la base del despliegue; las locales solo sirven allí si se migra también esa base y siguen válidas.

Los archivos de invitación son privados, no van a Git ni se publican. Copiar el token antes de reemplazar el contenedor: `.local` no tiene persistencia garantizada en producción. El registro de invitación y la sesión sí se guardan en PostgreSQL.

Este mecanismo sirve para una demo privada desplegada. El producto operativo aún no implementa cuentas individuales con contraseña/SSO, recuperación ni permisos diferenciados de administrador y operador: todos los evaluadores tienen acceso compartido al CRM.
