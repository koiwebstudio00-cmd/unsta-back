# UNSTA · Backend y agente

API HTTP, CRM, sesiones, PostgreSQL/Prisma y coordinación con n8n. Repositorio independiente: no requiere código ni dependencias del frontend.

## Entrega del 2 de noviembre de 2026

Incluye conocimiento 1.1.0, respuestas conversacionales, captura de interés con evidencia, seguimientos contextuales a las 2/4 horas y cierre por silencio a las 6 horas, con persistencia y protección de decisiones manuales. También incorpora una corrección para crear el espacio institucional de forma segura ante accesos concurrentes.

Preparación del próximo despliegue (no ejecutado como parte de esta entrega):

1. Respaldar PostgreSQL y conservar las variables privadas y `UNSTA_WORKSPACE_ID`. El push del código no transporta la base local ni sus cuentas.
2. Construir esta versión y ejecutar `npm run db:migrate:prod` antes de iniciar el servicio. Debe aplicarse `202611020001_lead_followups`; no resetear la base ni recrear su volumen.
3. Configurar un origen HTTPS estable del backend, `PANEL_ORIGIN` igual al dominio del frontend y cookies seguras. Validar `/health` y el login.
4. Revisar los tres workflows y sus credenciales en n8n. El JSON versionado contiene un origen `.invalid` deliberado: no sustituir el flujo activo con ese placeholder. Mantener versión/hash del conocimiento coincidentes.
5. Habilitar `DISPATCH_ENABLED` cuando el recorrido esté conectado. Verificar una consulta, su respuesta, el interés y la programación del seguimiento desde el panel. Los seguimientos siguen siendo mensajes internos, sin WhatsApp/email.

Validación local: `npm run check` y `npm run build`. Las pruebas de API usan exclusivamente `unsta_demo_test`; el ciclo temporal se comprueba con reloj simulado. El frontend documenta y exporta el alcance funcional desde su página Proyecto.

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
- `DISPATCH_ENABLED`: habilita despachos a n8n y seguimientos automáticos. Mantener false hasta configurar el recorrido.
- `UNSTA_WORKSPACE_ID`: espacio institucional compartido; conservar el UUID que tiene los datos.
- `HOST`, `PORT`: escucha de la API; contenedores usan 0.0.0.0 y 4100.

La clave del modelo se configura en n8n. Ninguna de estas claves se entrega al navegador.

## Dokploy

Crear un servicio Application conectado a ESTE repositorio, contexto `/`, Dockerfile `/Dockerfile`, puerto interno 4100. PostgreSQL es persistente y se configura aparte; no incluirlo dentro del contenedor de la API.

El Dockerfile compila en una etapa y ejecuta Node con dependencias de producción. La imagen contiene Prisma CLI para una tarea explícita de migración: `npm run db:migrate:prod`. Ejecutarla con las variables del rol de migración antes de arrancar la versión que la requiera; el proceso normal se conecta usando `DATABASE_URL` del rol restringido. No ejecutar resets.

Asignar un dominio HTTPS propio del backend para que n8n y el servidor Next puedan acceder. Configurar `PANEL_ORIGIN`, variables de base y claves antes de activar despacho. `/health` comprueba conexión con PostgreSQL. Mantener una instancia de API durante esta transición; su worker arranca en el mismo proceso.

El Compose de esta carpeta es para desarrollo local y conserva `name: unsta-demo` y su volumen. No cambiar esa identidad ni ejecutar `down -v`: contiene los datos actuales.

## n8n y conocimiento

Estado documental al 2 de noviembre de 2026: conocimiento **1.1.0**, con **40 registros**, **19 fuentes** y **12 propuestas** (7 carreras y 5 cursos/diplomaturas). Incluye Medicina, Psicología, Abogacía, Contador Público, Marketing, Informática e Inteligencia Artificial; requisitos de ingreso y equivalencias; cursos, servicios, contactos, aranceles/horarios publicados y calendario 2026. Seis carreras tienen fichas ampliadas y planes resumidos por año. Se conservan campos desconocidos, condiciones y discrepancias.

La base operativa persiste cuentas/sesiones, contactos, mensajes, intereses, resúmenes, notas, tareas, derivaciones, avisos, ciclos automáticos y auditoría. No se publican datos personales en documentación. El frontend ofrece una descripción editorial exportable desde **Proyecto**, junto a **Demo**; el contenido se mantiene en su propio repositorio, sin imports entre proyectos.

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

## Interés y seguimientos automáticos

Las declaraciones de interés y preguntas concretas de admisión (duración, materias, aranceles, ingreso) pueden registrar una propuesta con el mensaje del interesado como evidencia. No se capturan menciones aisladas, preguntas ambiguas entre propuestas ni consultas administrativas de alumnos. El interés respaldado actualiza el lead a `informado` (Contactados). La preinscripción requiere declaración explícita y nunca acredita inscripción.

El worker del backend, habilitado con `DISPATCH_ENABLED=true`, administra un ciclo persistente `LeadFollowup` por contacto. Programa seguimientos para todos los leads después de publicar una respuesta correctamente, incluso si solo saludaron o hicieron una consulta general. No se incorporan chats históricos automáticamente. Los mensajes se guardan en el chat del panel; no hay entrega externa ni integración de WhatsApp/email en este proceso.

El contenido se adapta al tema más reciente: saludo, consulta general, carrera, aranceles, horarios, ingreso, plan de estudios o modalidad/sede. Las continuaciones breves recuperan el tema anterior y los cambios de tema tienen prioridad. El segundo mensaje tiene otro texto. Se usan mensajes breves sin inventar importes, horarios ni datos académicos; el seguimiento no atribuye al lead una intención de inscribirse. Las consultas de alumnos, negativas y cierres explícitos no activan mensajes comerciales.

- Primer mensaje: dos horas desde el último mensaje del lead. Si la respuesta inicial demoró más de dos horas, se concede un intervalo completo desde esa respuesta.
- Segundo mensaje: dos horas después del primer seguimiento efectivamente publicado.
- Cierre: dos horas después del segundo, si sigue sin respuesta, se marca `sin_interes` con motivo `no_reply_after_two_followups`. No se interpreta el silencio como un rechazo declarado.
- Un nuevo mensaje cancela el plazo anterior y reinicia el contador. Si el ciclo había cerrado por silencio, reactiva el lead. No reabre una negativa fijada manualmente ni un pedido de no contacto.
- Atención humana, derivación, cierre de chat, cambio manual de etapa y preinscripción detienen el ciclo. Las correcciones manuales de etapa no se sobrescriben. Un pedido de no recibir mensajes deshabilita seguimientos posteriores para ese contacto.
- No hay filtro de horario: los intervalos son corridos. Tras una caída se procesa un paso por ciclo, dejando dos horas para el siguiente; no se envían mensajes acumulados en ráfaga.

Cada envío y cambio automático queda auditado. El bloqueo por workspace y la escritura transaccional de mensaje/contador evitan duplicados entre workers concurrentes. La nueva tabla tiene RLS forzada y claves compuestas por workspace. `GET /v1/demo/followup` incorpora `automations`; Seguimiento muestra los próximos envíos y cierres. No sustituye las tareas manuales.

Aplicar `npm run db:migrate` y regenerar Prisma antes de iniciar esta versión. Las pruebas con reloj simulado se ejecutan solo sobre `unsta_demo_test` con `npm run test:api`.
