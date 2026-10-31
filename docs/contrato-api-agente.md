> Documento trasladado desde la demo. Para instalación y comandos actuales, consultar primero el README de este repositorio.

# Contrato HTTP UNSTA ↔ n8n · v0.1.0

Estado: contrato implementado por el backend local; ver [backend-local.md](backend-local.md). Conversación conectada y probada con n8n remoto; el flujo de aperturas/avisos aún presenta fallas. Ver [revisión actual](pendientes-demo-2026-10-31.txt). Los ejemplos en `agent-contract/fixtures/` son ficticios y no habilitan acceso. Los nombres de campos son los usados por el código generado, endpoints de UNSTA; no son los endpoints de Lamelas.

## Autenticación y ámbitos

- Backend → webhooks n8n: `X-UNSTA-Webhook-Key`, secreto de esta demo.
- n8n → backend: `Authorization: Bearer <service_key>`, con permisos exclusivos para `/v1/agent` de UNSTA.
- Después del claim: también `X-UNSTA-Attempt-Token`, token temporal emitido por backend, vinculado a espacio, turno/evento, intento, versión de control y permisos. Guardar su hash, no el valor en claro.
- El navegador nunca llama estos endpoints de servicio. El panel tendrá sus propios endpoints autenticados.
- Los IDs de contacto y espacio se resuelven desde el turno persistido. No se aceptan desde parámetros del modelo.

Todos los endpoints usan JSON. Un `2xx` HTTP no significa éxito de una herramienta: su envoltorio es `{ "ok": true, "data": ... }` o `{ "ok": false, "error": { "code": "...", "message": "..." } }`. Errores de negocio recuperables pueden devolver `200` con `ok:false` para que el agente los interprete. Autenticación, permisos y errores de transporte usan `401`, `403`, `409` o `5xx`; el workflow se interrumpe, sin simular éxito.

## Reclamar un turno

`POST /v1/agent/turns/:turn_id/claim`

```json
{
  "execution_id": "1234",
  "workflow_id": "workflow-importado",
  "contract_version": "0.1.0"
}
```

Respuesta adquirida: ver `fixtures/claim-turno.json`. Respuesta duplicada/inactiva: `{ "claimed": false, "turn_id": "mismo-uuid" }`. Ambas son `200`, no un error técnico. Un ID desconocido o ajeno al servicio devuelve `404` sin revelar otro espacio.

Obligaciones de implementación:

1. Dentro de una transacción, verificar turno encolado, modo bot y que no haya otra ejecución activa en la conversación.
2. Reclamar exclusivamente, crear `attempt_id` y autorización temporal, fijar versión/hash de conocimiento y registrar `execution_id`/`workflow_id` para correlacionar errores.
3. Un lease inicial de 90 segundos limita el intento que puede escribir/publicar. Un watchdog invalida el intento antes de permitir un segundo; máximo inicial de 2 intentos. No habilitar retries automáticos independientes en n8n.
4. El timeout de workflow es 120 segundos e incluye resumen. El token ganador puede guardar solo su resumen durante esa ventana tras finalizar; no habilita más herramientas de negocio después de completar el turno. Un intento vencido o sustituido no conserva permisos.
5. Reintentar un webhook ya aceptado no crea otro intento mientras el primero siga activo. El `202` de n8n no equivale a completar el turno.

## Contexto

`GET /v1/agent/turns/:turn_id/context`

Respuesta completa: `fixtures/contexto-turno.json`. Campos obligatorios:

| Campo | Significado |
| --- | --- |
| `turn_id`, `attempt_id` | Deben coincidir con claim. |
| `conversation.id`, `mode`, `control_version` | Estado y versión de atención. |
| `knowledge_version`, `knowledge_hash` | Versión y SHA-256 de los bytes del JSON canónico. |
| `context_sequence` | Última secuencia del snapshot entregado. Puede incluir una respuesta a un turno previo publicada después del mensaje actual. |
| `summary_through_sequence` | Horizonte contiguo observado; coincide con la secuencia del mensaje actual. |
| `current_message` | `id`, `role: user`, `text`, `sequence`. Máximo 6.000 caracteres. |
| `messages` | Hasta 20 mensajes del snapshot con esos mismos campos; roles user/assistant/operator. |
| `contact` | Datos públicos declarados. Sin notas internas ni secretos. |
| `interests` | Intereses persistidos: propuesta, sede, modalidad, período y etapa. |
| `catalog` | IDs, títulos y sección de las 11 propuestas concretas. |
| `summary` | Resumen anterior con las claves permitidas en `prompt-summary.md`. |
| `summary_due` | Booleano calculado por backend: inicialmente cada 6 mensajes nuevos desde el resumen válido. |

No incluir mensajes de usuario de turnos posteriores ni notas internas. Incluir respuestas ya publicadas de turnos previos, incluso si su secuencia es posterior al mensaje actual. Entregar mensajes ordenados y sin duplicados. El workflow genera la fecha real y la zona horaria; no recibe una fecha elegida por el usuario. Se rechaza una versión/hash de conocimiento distinta a la compilada.

## Herramientas

`POST /v1/agent/turns/:turn_id/tools/:tool_name`

```json
{
  "attempt_id": "uuid-del-intento",
  "datos": { "propuesta_id": "carrera-psicologia" }
}
```

Los seis esquemas de `datos` están en `agent-contract/tools.json`. Son listas cerradas de propiedades. Validarlos en backend; la descripción que recibe el modelo no reemplaza esa validación.

| Herramienta | Respuesta dentro de `data` |
| --- | --- |
| `consultar_conocimiento`, `ver_propuesta` | `knowledge_version`, `knowledge_hash`, `registros`. Cada registro conserva datos, estado, período, restricciones y fuentes expandidas con URL. `registros: []` expresa ausencia en el recorte. |
| `actualizar_contacto` | `contacto` persistido y `campos_actualizados`; un conflicto de campo corregido manualmente devuelve `ok:false`. |
| `registrar_interes` | `interes` persistido y marca `created`. No unir contactos ni borrar otros intereses. |
| `gestionar_aviso` | `suscripcion` con `propuesta_id`, `estado: activa/cancelada`, evidencia y `simulado:true`. |
| `derivar_a_area` | `turn_id`, `attempt_id`, `caso`, `conversation`. Ejemplo exacto en `fixtures/resultado-handoff.json`. |

El backend debe validar que `mensaje_evidencia_id` pertenezca a esta conversación, sea de autor usuario y no sea posterior al snapshot. El texto debe respaldar los datos propuestos; para consentimiento no basta un ID cualquiera. Conservar evidencia y permitir revisión de la extracción. Proteger campos corregidos manualmente.

Una herramienta de lectura no puede recuperar otra versión de conocimiento. `knowledge.mjs` es el núcleo reutilizable de búsqueda; el adaptador debe validar límites antes de llamarlo y conservar la envoltura de salida. Aranceles y horarios referenciados se devuelven como registros completos, nunca datos sueltos sin condiciones.

Idempotencia: calcular una clave interna con `(turn_id, tool_name, argumentos canónicos validados)` y guardar resultado/transacción juntos. Un reintento del turno puede recuperar ese resultado, después de validar el intento activo. Usar también restricciones de dominio: un interés por identidad de propuesta/sede/período dentro del contacto, una suscripción activa por contacto/propuesta y un caso abierto por conversación. No confiar en claves inventadas por el modelo. Una edición dentro del mismo turno con parámetros diferentes necesita validación normal; no equivale a un retry.

Al derivar, bloquear conversación, crear/reutilizar caso, cambiar `bot → esperando_humano` e incrementar `control_version` exactamente una vez. Después del handoff se rechazan más escrituras del agente; solo queda autorizada la finalización de su aviso canónico. El código de n8n verifica la respuesta de esa herramienta, pero el backend debe volver a verificarla al publicar.

## Publicar o cancelar

`POST /v1/agent/turns/:turn_id/complete`

```json
{
  "turn_id": "uuid-del-turno",
  "attempt_id": "uuid-del-intento",
  "control_version": 1,
  "knowledge_version": "1.0.0",
  "record_ids": ["carrera-psicologia"],
  "handoff_id": null,
  "texto": "Respuesta candidata del asistente"
}
```

La respuesta candidata no debe ser visible hasta esta transacción. Bloquear conversación/turno; verificar intento activo, lease, versiones, modo bot y ausencia de publicación previa. Validar `record_ids` contra los resultados de herramientas de ese intento y limitar texto a 6.000 caracteres. Las referencias no prueban por sí solas que toda afirmación esté respaldada: eso se evalúa con casos del modelo.

Excepción de handoff: exigir caso creado por el mismo turno/intento, modo `esperando_humano` y versión resultante exacta. El backend impone el texto canónico, no acepta una confirmación arbitraria del modelo. Si un operador ya tomó el chat, descartar el mensaje tardío.

Éxito: `{ "published": true, "response_message_id": "uuid", "response_sequence": 3 }`. Si cambió el control: `{ "published": false, "reason": "human_control" }` y cancelar el turno. Repetir la misma finalización devuelve la publicación existente sin duplicarla; un payload diferente entra en conflicto.

`POST /v1/agent/turns/:turn_id/cancel`: `{ "attempt_id": "...", "reason": "control_humano" }`. No publicar respuesta; cancelación idempotente solo para ese intento.

## Resumen posterior

`PUT /v1/agent/turns/:turn_id/summary`

Campos: `attempt_id`, `resumen`, `through_sequence`, `control_version`. Validar claves/límites del normalizador y token del intento que publicó. Actualizar solo si el resumen no está superado, coincide la versión de control y el horizonte pertenece a su snapshot.

`through_sequence` es **el horizonte `summary_through_sequence` del contexto leído**, no la secuencia de la respuesta. Si llega otro mensaje mientras responde el modelo, guardar la secuencia de respuesta como horizonte podría ocultar ese mensaje del próximo resumen. La respuesta publicada puede aportar contexto, pero no adelanta la cobertura del historial observado.

`POST /v1/agent/turns/:turn_id/summary-skipped`: `{ "attempt_id": "...", "code": "SUMMARY_UNAVAILABLE" }`, registro diagnóstico sin reabrir el turno. Un fallo al guardar el resumen tampoco reenvía la respuesta. Backend conserva la respuesta, el resumen anterior y puede detectar resúmenes atrasados.

## Errores

`POST /v1/agent/incidents`: `workflow_id`, `execution_id` o null, `node` de lista permitida, `code`, `mensaje` fijo. Sin stack, URL de ejecución, prompt, texto del usuario ni error crudo. Deduplicar por ejecución/código y correlacionar con el claim. Si falta identificación, registrar incidente global de la demo; el watchdog cubre turnos estancados. No modifica un turno completado ni reenvía mensajes.

## Apertura simulada

`POST /v1/agent/events/:event_id/claim`: mismo cuerpo técnico que claim de turno. Respuesta `{ "claimed": true, "event_id": "...", "attempt_id": "...", "attempt_token": "..." }` o `{ "claimed": false, "event_id": "..." }`.

El evento debe existir en el espacio, haber sido creado por un operador autorizado y estar marcado `simulado:true`. No aceptar curso, destinatarios o permiso desde el webhook. Aplicar lease y reintentos acotados también a eventos.

`POST /v1/agent/events/:event_id/process`: `{ "attempt_id": "..." }` y token limitado al evento. El backend consulta las suscripciones vigentes, vuelve a comprobar consentimiento al insertar cada aviso, usa plantilla identificada como simulada y deduplica por `(event_id, subscription_id)`. En esta demo, procesar un lote acotado y completar el evento transaccionalmente; no abrir un ciclo n8n sin límites. La implementación local limita el evento a 500 suscripciones; si se supera devuelve `409 BATCH_LIMIT`. El procesamiento por lotes más grandes queda pendiente.

Respuesta: `{ "ok": true, "data": { "estado": "completado", "generados": 2, "omitidos": 1, "simulado": true } }`. Repetir devuelve resultado existente. Una cancelación anterior a generar el aviso lo excluye. No hay envíos externos.

## Qué garantizan las pruebas locales

Verifican funciones puras, artefactos reproducibles, conexiones y expresiones generadas, y recorridos simulados con respuestas HTTP/modelo ficticias. Las simulaciones de workflows no implementan autorización, persistencia ni transacciones por sí solas. Se agregaron pruebas HTTP y PostgreSQL del backend que verifican autorización, persistencia, transacciones e idempotencia. Las pruebas reales están registradas en [el informe de QA](pruebas-agente-2026-10-31/INFORME.txt): hay casos aprobados, parciales y fallidos; resta corregir y repetir los pendientes.
