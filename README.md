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
npm run account:create -- tu-correo@tu-dominio.com
npm start
```

En la instalación trasladada, `.env.local`, base e invitaciones ya existen: conservarlos. `demo:setup` no sobrescribe configuración existente. `account:create` crea una cuenta persistente y guarda sus credenciales iniciales en un archivo privado de `.local`; no las envía por correo.

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
| `npm run account:create -- email` | Crear una cuenta persistente con contraseña inicial aleatoria. |
| `npm run invite` | Mecanismo anterior de invitaciones; mantenido por compatibilidad, fuera del login del panel. |

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

El panel usa email y contraseña. Las cuentas se guardan en PostgreSQL con un hash scrypt y sal aleatoria; la contraseña nunca se entrega al navegador como parte de una respuesta de sesión.

1. Configurar `APP_ORIGIN` del frontend igual a `PANEL_ORIGIN` del backend, y `COOKIE_SECURE=true` en ambos. Configurar `API_URL` del frontend con la URL accesible del backend.
2. Aplicar las migraciones con `npm run db:migrate:prod` antes de iniciar esta versión. La migración de cuentas es aditiva y conserva los leads y sesiones existentes.
3. Una sola vez por persona, abrir la terminal del contenedor backend en Dokploy, desde `/app`, y ejecutar:

   ```sh
   npm run account:create -- tu-correo@tu-dominio.com
   ```

4. Abrir el archivo privado `.local/account-….local.json` que indica el comando y guardar el email y la contraseña en un gestor de contraseñas. El comando no sobrescribe cuentas existentes. El archivo no se incluye en Git ni en imágenes; copiarlo antes de reemplazar el contenedor.
5. Entrar al dominio del frontend y usar esas credenciales. Se pueden reutilizar desde otro navegador y después de cerrar sesión; ya no se requieren códigos de invitación. La sesión dura siete días.

«Solicitar acceso» lleva a `/solicitar-acceso`, con contacto de Koi y enlace de correo a koi.webstudio00@gmail.com. No envía emails automáticamente ni habilita registro público. Las nuevas cuentas se crean con el comando anterior, después de revisar la solicitud.

Todas las cuentas creadas acceden al espacio institucional `UNSTA_WORKSPACE_ID`. Conservar ese UUID al trasladar la base. Desplegar código no copia los datos locales: migrar PostgreSQL si se quieren conservar leads y cuentas.

Las sesiones conservan cookies HttpOnly, comprobación de origen y CSRF. El endpoint de login limita los intentos y devuelve un error genérico para email inexistente o contraseña incorrecta. El endpoint anterior de invitaciones permanece por compatibilidad, pero el frontend ya no lo utiliza.

Alcance actual: cuentas con acceso compartido al CRM; no hay roles diferenciados, SSO ni recuperación/cambio de contraseña autoservicio. La página de solicitud también sirve como contacto de ayuda.
