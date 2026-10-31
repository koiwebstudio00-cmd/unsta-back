> Documento trasladado desde la demo. Para instalación y comandos actuales, consultar primero el README de este repositorio.

# Backend local de la demo UNSTA

Implementación del 31/10/2026: Express 5 + TypeScript + Prisma 6.10.1 + PostgreSQL 17. Se reutilizan los patrones de Lamelas: backend como fuente de verdad, contexto de espacio en transacción, aislamiento en PostgreSQL, herramientas HTTP y cola persistente. La conversación está conectada a n8n remoto mediante túnel temporal; ver [pendientes actuales](pendientes-demo-2026-10-31.txt).

## Arranque

Desde la raíz del proyecto:

```sh
npm ci
npm run demo:setup
docker compose --env-file .env.local up -d postgres
npm run db:generate
npm run db:migrate
npm start
```

`demo:setup` genera secretos aleatorios en `.env.local` con permisos restringidos y no sobreescribe una configuración existente. Ese archivo está excluido de Git. PostgreSQL publica solo `127.0.0.1:55432`; la API escucha por defecto en `127.0.0.1:4100`.

Comprobación de disponibilidad: `GET http://127.0.0.1:4100/health`. Este endpoint comprueba la API y la conexión a PostgreSQL, no el modelo ni n8n.

Para detener PostgreSQL conservando datos:

```sh
docker compose --env-file .env.local stop
```

La base está en el volumen `unsta-demo_unsta_pg_data`. No usar `down -v` si se quieren conservar los datos.

## Acceso de evaluadores

```sh
npm run invite -- evaluador@example.test
```

Crea una invitación de un solo uso, válida por 24 horas, al espacio compartido UNSTA definido por `UNSTA_WORKSPACE_ID`. El espacio se crea solo si todavía no existe. Guarda el token en `.local/invite-<workspace>-<invitacion>.local.json`, con permisos restringidos. No envía correo ni imprime el secreto. El [panel local](panel-local.md) ofrece el formulario en `/ingresar`.

`POST /v1/auth/accept-invite`, con `Origin` igual a `PANEL_ORIGIN`, recibe `{ "token": "valor_del_archivo_local" }`. Devuelve cookie `unsta_session` HttpOnly y un `csrf_token`. Las escrituras de `/v1/demo` requieren esa cookie, el mismo `Origin` y `X-CSRF-Token`. La sesión vence a los siete días. Todas las invitaciones comparten el mismo espacio institucional: los miembros ven y gestionan los mismos contactos, conversaciones y seguimientos, incluso desde distintos navegadores. Cada persona conserva su sesión y email propios.

## Rutas para el panel

Prefijo `/v1/demo`, autenticado:

| Método y ruta | Uso |
| --- | --- |
| `GET /me`, `POST /logout` | Sesión. |
| `GET /status`, `GET /catalog`, `GET /knowledge` | Estado local, versión de conocimiento, propuestas y fuentes con condiciones. |
| `POST /conversations` | Nueva persona y conversación; `contact_id` opcional para continuar una ficha propia. |
| `GET /conversations/:id` | Conversación, mensajes, casos y estados públicos de turnos. |
| `POST /conversations/:id/messages` | `{text, client_message_id}`; persiste y encola en una transacción. |
| `POST /conversations/:id/control` | `{action: take/release/close}`; pausa/invalida al bot. |
| `POST /conversations/:id/reply` | Respuesta humana `{text, client_message_id}`; requiere tomar el chat. |
| `POST /turns/:id/retry` | Reintento manual de turno fallido, solo en modo bot. |
| `GET /contacts`, `GET /contacts/:id` | Listado y ficha con intereses, notas, tareas y avisos. |
| `PATCH /contacts/:id` | Corregir campos y protegerlos de la IA. |
| `POST /contacts/:id/notes` | Nota interna `{text}`. |
| `POST /contacts/:id/tasks` | Tarea `{text, due_at}` con fecha ISO. |
| `PATCH /tasks/:id` | `{status: completada/cancelada}`. |
| `PATCH /interests/:id` | Cambiar etapa; `inscripcion_simulada` se mantiene explícita. |
| `POST /subscriptions/:id/cancel` | Cancelar un aviso. |
| `POST /openings` | `{proposal_id, description}`; crea un evento ficticio nuevo. |
| `GET /followup` | Tareas, suscripciones, casos, eventos y avisos. |

Un reenvío del mismo `client_message_id` conserva el mensaje original; el mismo ID con otro texto devuelve conflicto. Cada POST de creación de apertura representa un evento nuevo; el panel debe bloquear doble clic hasta recibir su ID. El procesamiento de ese ID sí es idempotente.

La vista de conversación está limitada a 500 mensajes; contactos a 200 y avisos/suscripciones a lotes acotados. Es un recorte para la demo, no paginación de producción.

## Conectar n8n más adelante

Los endpoints de [contrato-api-agente.md](contrato-api-agente.md) están implementados bajo `/v1/agent`. Requieren `Authorization: Bearer <AGENT_SERVICE_KEY>` y, después del claim, `X-UNSTA-Attempt-Token`.

La API local **no es accesible automáticamente desde el servidor remoto de n8n**. Antes de la prueba integrada se necesita desplegar este backend en un origen HTTPS accesible. Ese origen reemplazará el placeholder de `agent-contract/config.json`; luego se regeneran/importan los workflows.

Cuando se importen y configuren los workflows:

1. Crear las credenciales según [importar-n8n.md](importar-n8n.md).
2. Configurar `N8N_CONVERSATION_URL` y `N8N_OPENING_URL` con las URLs de producción que muestre el editor.
3. Configurar en n8n el mismo `N8N_WEBHOOK_KEY` del backend.
4. Habilitar `DISPATCH_ENABLED=true` y reiniciar la API.

Por defecto las URLs están vacías y el despacho está apagado. Las pruebas de backend usan transporte falso, no llaman a la instancia de Lamelas. Deshabilitar el despacho pausa envíos nuevos; no revoca una ejecución ya reclamada. Para detener un chat en ejecución, tomarlo/cerrarlo desde su operación de control.

## Persistencia y concurrencia

- Los datos operativos tienen RLS forzada por `workspaceId`, claves foráneas compuestas y restricciones de unicidad. La API rechaza arrancar como superusuario o con `BYPASSRLS`.
- Cada operación usa una transacción corta con contexto de espacio y bloqueo por espacio. Es una simplificación consciente para pocos evaluadores: serializa también conversaciones del mismo espacio; no pretende máxima concurrencia.
- Las llamadas a n8n/modelo quedan fuera de las transacciones. Un trabajo se reclama con lease y comparación de estado antes del envío.
- Un turno por conversación procesa a la vez; el orden se determina por secuencia de mensajes, no por timestamps.
- Toma humana invalida intentos y cancela turnos pendientes. El endpoint de publicación vuelve a comprobar estado, versión y token dentro de la transacción.
- Tres entregas sin claim o dos intentos de agente agotados terminan en fallo visible. El operador puede reintentar expresamente. El watchdog no vuelve a emitir una respuesta ya publicada.
- El resumen registra un horizonte observado separado del máximo de secuencia del snapshot; los mensajes que llegaron mientras respondía el bot no se pierden.
- La base de conocimiento se conserva como snapshot JSON con versión/hash en PostgreSQL. La búsqueda usa el núcleo local sobre la misma versión, validada al iniciar. No hay embeddings ni actualización automática desde la web.

Las tablas de sesión, invitación, espacios, dispatch e incidentes son infraestructura de servicio; no están expuestas mediante listados generales al evaluador. El secreto del servicio permite procesar trabajos de los espacios de esta demo. El token de intento limita cada llamada concreta al turno/evento correspondiente.

## Evidencia y consentimiento

Las herramientas validan JSON Schema, autor/conversación/secuencia del mensaje de evidencia y reglas literales conservadoras. Un dato ambiguo puede rechazarse para pedir aclaración. Esto no equivale a un verificador semántico completo: la extracción y las respuestas deben evaluarse con el modelo real antes de atención pública.

Para crear avisos se acepta una petición explícita que identifique propuesta y aviso simulado en el panel, o una afirmación a una pregunta inmediatamente anterior que contenga esos datos. No alcanza con indicar interés en estudiar. La cancelación y la inserción de avisos usan el mismo bloqueo de espacio. Un replay de una operación no reactiva una suscripción cancelada.

Las notas del operador no se incluyen en el contexto del agente. Las inscripciones solo se marcan como simuladas; no se verifica el sistema académico ni se acredita un pago.

## Verificación

```sh
npm run check
npm run build
npm run test:api
```

`api:build` realiza chequeo estricto de TypeScript (`tsc --noEmit`); el arranque local usa `tsx`, no un bundle de producción.

`api:test` crea/migra **unsta_demo_test** en PostgreSQL local y vacía exclusivamente esa base antes de correr. Se niega a hacerlo si la URL no es local o la base configurada no es `unsta_demo`. Las pruebas no borran `unsta_demo`.

Resultados de esta entrega: 27 pruebas de contrato/workflows y 20 pruebas HTTP/PostgreSQL aprobadas. Incluyen RLS entre espacios, autenticación, doble envío y doble claim, evidencia, correcciones manuales, varios intereses, publicación idempotente, toma humana, resumen, consentimiento/cancelación, aviso único, watchdog y transporte con dos workers.

No se han probado aún el navegador/panel, la importación real de los JSON ni respuestas de un modelo en n8n. El panel Next.js y la evaluación conversacional son las siguientes etapas.
