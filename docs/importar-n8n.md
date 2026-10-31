> Documento trasladado desde la demo. Para instalación y comandos actuales, consultar primero el README de este repositorio.

# Conectar la demo UNSTA con n8n, paso a paso

Esta guía conecta el panel de tu computadora con tu instancia de n8n: https://n8n.inmobiliarialyc.com.ar/.

Los archivos ya están preparados. **Importarlos agrega los workflows a n8n, pero para que respondan hay que asignarles credenciales y conectar el backend.**

## Antes de empezar: qué es cada cosa

| Parte | Dónde está | Qué hace |
| --- | --- | --- |
| Panel | `http://localhost:3000` | Donde escribís como interesado y gestionás contactos. |
| Backend o API | `http://127.0.0.1:4100` en tu computadora | Guarda mensajes y contactos; entrega la información de UNSTA al agente. |
| n8n | `https://n8n.inmobiliarialyc.com.ar/` | Ejecuta el agente y llama al modelo. |
| Túnel | Una URL HTTPS que vamos a generar | Permite que n8n llegue al backend de tu computadora. |

El recorrido será: **panel → backend → n8n → backend → respuesta visible en el panel**.

Usaremos un túnel temporal para esta prueba. No necesitás instalar otro n8n ni subir la base de conocimiento: la base ya la sirve el backend. La versión de tu instancia n8n todavía no se inspeccionó; si aparece un tipo de nodo desconocido, resolver esa compatibilidad antes de continuar.

## 1. Importar los tres archivos — EN N8N

Abrí tu instancia e ingresá con tu usuario.

Para importar el primer archivo:

1. Creá un **workflow nuevo y vacío**.
2. Abrí el menú de **tres puntos** del editor.
3. Elegí **Import from File**.
4. En el selector de archivos de macOS, podés usar `Cmd + Shift + G` y pegar esta carpeta:

   ```text
   /Users/dev0/koi/clients/unsta/backend/n8n
   ```

5. Elegí `unsta-demo-errores.json`.
6. Guardá el workflow. Su nombre debe ser **UNSTA · 02 Errores demo**.

Repetí el mismo procedimiento creando **otro workflow vacío para cada archivo**:

| Orden | Archivo | Nombre que debe aparecer en n8n | Para qué sirve |
| --- | --- | --- | --- |
| 1 | [unsta-demo-errores.json](../n8n/unsta-demo-errores.json) | UNSTA · 02 Errores demo | Registra fallos de los otros flujos. |
| 2 | [unsta-demo-conversacion.json](../n8n/unsta-demo-conversacion.json) | UNSTA · 01 Conversacion demo | Responde consultas y registra información del interesado. |
| 3 | [unsta-demo-apertura.json](../n8n/unsta-demo-apertura.json) | UNSTA · 03 Apertura simulada | Genera avisos internos de nuevas aperturas. |

**No importes `manifest.json`.** Es un archivo de control del proyecto, no un workflow. Los tres archivos se importan por separado, no uno encima de otro ni sobre workflows existentes de Lamelas.

**Comprobación:** tenés tres workflows UNSTA guardados. Por ahora pueden mostrar credenciales pendientes y permanecer sin publicar/activar.

Referencia: [importar archivos desde el editor de n8n](https://docs.n8n.io/build/manage-workflows/export-and-import.md).

## 2. Abrir el archivo que contiene las claves — EN TU COMPUTADORA

Abrí este archivo con tu editor:

```text
/Users/dev0/koi/clients/unsta/backend/.env.local
```

Es el archivo de la **raíz del proyecto**, no `el .env.local del repositorio frontend`.

Si no aparece en Finder, `Cmd + Shift + .` muestra los archivos ocultos. Buscá estas dos líneas:

```dotenv
N8N_WEBHOOK_KEY=...
AGENT_SERVICE_KEY=...
```

Los valores reales ya están generados. **Copiá solamente lo que está después del signo `=`**, sin el nombre de la variable. No los reemplaces por los puntos del ejemplo ni generes otros valores.

Dejá el archivo abierto. Lo vas a usar para crear dos credenciales. Estos valores se pegan en n8n, no en el chat ni dentro de los nodos de código.

## 3. Crear las tres credenciales — EN N8N

Una credencial es un dato de acceso guardado por n8n. Primero la creás una vez; después la seleccionás en todos los nodos que la necesitan.

### A. Credencial que permite al backend iniciar los workflows

1. Abrí **UNSTA · 01 Conversacion demo**.
2. Abrí el nodo **Entrada**.
3. En **Authentication**, seleccioná **Header Auth** si no está seleccionado.
4. En el selector de credencial, elegí **Create New Credential**.
5. Poné como nombre de la credencial: **UNSTA · Entrada webhook**.
6. Completá los campos:

| Campo dentro de la credencial | Qué poner |
| --- | --- |
| **Name** | `X-UNSTA-Webhook-Key` |
| **Value** | El valor real de `N8N_WEBHOOK_KEY` del archivo local. |

7. Guardá la credencial y dejala seleccionada en **Entrada**.
8. Abrí **UNSTA · 03 Apertura simulada → Entrada** y seleccioná **esa misma credencial**. No crees una segunda.

**Comprobación:** los dos nodos Entrada tienen seleccionada `UNSTA · Entrada webhook`.

### B. Credencial que permite a n8n leer y guardar datos en el backend

1. Volvé al workflow de conversación.
2. Abrí **reclamar_turno**.
3. En **Authentication**, seleccioná **Generic Credential Type**.
4. En **Generic Auth Type**, seleccioná **Header Auth**.
5. Creá una credencial nueva con nombre **UNSTA · Backend agente**.
6. Completá:

| Campo dentro de la credencial | Qué poner |
| --- | --- |
| **Name** | `Authorization` |
| **Value** | La palabra `Bearer`, un espacio y el valor real de `AGENT_SERVICE_KEY`. |

La forma del valor es:

```text
Bearer TU_CLAVE_REAL
```

`TU_CLAVE_REAL` es un marcador explicativo: reemplazalo por el contenido de `AGENT_SERVICE_KEY`, sin comillas ni los signos `< >`. No pegues literalmente el nombre `AGENT_SERVICE_KEY`.

7. Guardá la credencial y dejala seleccionada en `reclamar_turno`.

**La credencial no se aplica automáticamente al workflow entero.** En el paso 4 vas a seleccionarla en los demás nodos.

Referencia: [Header Auth en HTTP Request](https://docs.n8n.io/integrations/builtin/credentials/httprequest).

### C. Credencial del modelo de IA

1. En el workflow de conversación, abrí **Modelo conversacion**.
2. En el selector de credencial OpenAI, elegí crear una nueva.
3. Nombrala **UNSTA · Modelo**.
4. Pegá tu API Key de OpenAI en **API Key**. Es una clave distinta de las dos claves internas anteriores.
5. Guardá y seleccioná la credencial.
6. Abrí **Modelo resumen** y seleccioná la misma credencial.
7. Conservá `gpt-4.1-mini` como modelo en ambos nodos para la primera prueba. La cuenta de API debe tener acceso y cuota disponibles.

**Comprobación:** los dos nodos de modelo tienen seleccionada `UNSTA · Modelo`.

Referencia: [credencial OpenAI de n8n](https://docs.n8n.io/integrations/builtin/credentials/openai).

## 4. Asignar la credencial de backend a todos sus nodos — EN N8N

En cada nodo de la siguiente tabla elegí:

```text
Authentication: Generic Credential Type
Generic Auth Type: Header Auth
Credencial: UNSTA · Backend agente
```

Estos ajustes de autenticación ya están preparados en los JSON; normalmente solo falta elegir la credencial guardada.

| Workflow | Nodos que deben usar UNSTA · Backend agente |
| --- | --- |
| Conversación: llamadas de control | `reclamar_turno`, `obtener_contexto`, `cancelar_turno`, `finalizar_turno`, `guardar_resumen`, `registrar_resumen_omitido`. |
| Conversación: herramientas del agente | `consultar_conocimiento`, `ver_propuesta`, `actualizar_contacto`, `registrar_interes`, `gestionar_aviso`, `derivar_a_area`. |
| Apertura | `reclamar_evento`, `procesar_apertura`. |
| Errores | `reportar_incidente`. |

Son **15 nodos en total**. Las seis herramientas también son nodos HTTP, aunque aparezcan conectadas debajo del agente.

No cambies sus URLs, cuerpos ni expresiones. No agregues manualmente `X-UNSTA-Attempt-Token`: el flujo ya obtiene ese valor durante cada ejecución.

**Comprobación:** hay una credencial de backend seleccionada en cada uno de los 15 nodos. Guardá los tres workflows.

## 5. Crear la dirección HTTPS del backend — EN TU COMPUTADORA

n8n corre en un servidor diferente. Por eso, si le damos `localhost:4100`, no puede llegar a tu computadora. El túnel le da una dirección HTTPS que sí puede alcanzar.

### 5.1. Comprobar que el backend está encendido

Abrí en el navegador:

```text
http://127.0.0.1:4100/health
```

Debe responder:

```json
{"ok":true,"service":"unsta-demo-api"}
```

Si ya responde, no inicies una segunda API. Si no responde, usá el apartado “Si los servicios locales están apagados” al final de esta guía.

### 5.2. Instalar cloudflared, una sola vez

En Terminal de macOS, si tenés Homebrew:

```sh
brew install cloudflared
```

Si no tenés Homebrew, usá la descarga para macOS de la [página oficial de Cloudflare](https://developers.cloudflare.com/tunnel/downloads/).

### 5.3. Iniciar el túnel

En una terminal nueva ejecutá:

```sh
cloudflared tunnel --url http://127.0.0.1:4100
```

Buscá en la salida una URL que termine en `.trycloudflare.com`, por ejemplo:

```text
https://nombre-aleatorio.trycloudflare.com
```

**Copiá la URL real que imprimió el comando.** El texto de arriba es solo un ejemplo. Dejá esa terminal abierta durante la prueba.

El túnel hace accesible la API por Internet; las rutas que leen o escriben datos siguen requiriendo las credenciales de la aplicación. El panel continúa local en el puerto 3000.

### 5.4. Comprobar el túnel

Abrí la URL real agregando `/health`. Debe devolver el mismo JSON del paso 5.1.

Para comprobar también el acceso desde el servidor n8n, podés crear un workflow de diagnóstico separado con un nodo **HTTP Request**, método **GET**, URL `https://TU-URL-REAL/health`, sin autenticación. Ejecutá ese nodo: debe devolver `ok: true`. No cambies los nodos de los tres workflows UNSTA para hacer esta comprobación.

**Comprobación:** tenés una URL HTTPS que permite consultar la salud de la API. Cuando se apaga el túnel deja de funcionar, y al crear otro cambia el nombre. [Quick Tunnels de Cloudflare](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## 6. Pegar esa dirección en los tres workflows — EN N8N

Hacé esto en **conversación, apertura y errores**, uno por uno:

1. Abrí el nodo **Configuracion UNSTA**.
2. Dentro del código, buscá esta línea:

   ```js
   "api_base_url": "https://unsta-api.example.invalid",
   ```

3. Reemplazá únicamente el valor entre comillas por la URL real del túnel:

   ```js
   "api_base_url": "https://TU-URL-REAL.trycloudflare.com",
   ```

4. Conservá la coma y el resto del código.
5. Guardá el workflow.

Pegá **solo el origen HTTPS**: sin `/health`, `/v1`, `/v1/agent` ni la URL de un webhook.

No va acá `https://n8n.inmobiliarialyc.com.ar/`: ese es el servidor que ejecuta los flujos, no el backend. La validación bloquea el dominio raíz y los hosts conocidos `api`, `n8n` y `evoapi` de `inmobiliarialyc.com.ar`. Permite un host dedicado al backend UNSTA, por ejemplo `unsta-api.inmobiliarialyc.com.ar`. Ese ejemplo no está desplegado por esta separación.

**Comprobación:** los tres nodos Configuracion UNSTA tienen exactamente la misma URL de backend.

## 7. Seleccionar el workflow de errores y publicar — EN N8N

Primero abrí **UNSTA · 01 Conversacion demo**:

1. Abrí el menú del workflow y entrá en **Settings**.
2. En **Error workflow**, seleccioná **UNSTA · 02 Errores demo**.
3. Guardá.

Repetí esos tres pasos en **UNSTA · 03 Apertura simulada**. El workflow de errores no debe elegirse como manejador de sí mismo. [Configuración oficial de errores](https://docs.n8n.io/build/flow-logic/handle-errors-gracefully.md).

Después publicá **conversación** y **apertura** con **Publish**, o activalos con **Active** si tu versión usa ese control. El workflow de errores debe quedar guardado y seleccionado como manejador; no tiene un webhook público.

Si n8n marca una credencial pendiente al publicar, abrí el nodo señalado y seleccioná la credencial correspondiente de los pasos anteriores.

**Comprobación:** conversación y apertura están publicados/activos y usan el manejador de errores UNSTA.

## 8. Copiar las dos URLs de entrada — EN N8N

En **conversación**:

1. Abrí **Entrada**.
2. Elegí la pestaña **Production URL**.
3. Copiá esa dirección.

Hacé lo mismo en **apertura**. Conservá cada URL identificada: una es para conversaciones y otra para aperturas.

Las direcciones previstas son:

```text
Conversación:
https://n8n.inmobiliarialyc.com.ar/webhook/unsta-demo-conversacion-v1

Apertura:
https://n8n.inmobiliarialyc.com.ar/webhook/unsta-demo-apertura-v1
```

Usá las URLs que muestre tu editor si son diferentes. **No copies Test URL ni una dirección que contenga `/webhook-test/`.** Las Production URLs funcionan con el workflow publicado; no requieren dejar el editor escuchando. [Documentación del Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook).

**Comprobación:** tenés dos Production URLs. No hace falta abrirlas en el navegador: reciben solicitudes POST generadas por el backend.

## 9. Activar el envío desde el panel — EN TU COMPUTADORA

Volvé al archivo:

```text
/Users/dev0/koi/clients/unsta/backend/.env.local
```

Editá **las líneas existentes** para que queden así, usando las URLs reales del paso 8:

```dotenv
N8N_CONVERSATION_URL=https://n8n.inmobiliarialyc.com.ar/webhook/unsta-demo-conversacion-v1
N8N_OPENING_URL=https://n8n.inmobiliarialyc.com.ar/webhook/unsta-demo-apertura-v1
DISPATCH_ENABLED=true
```

No dupliques las líneas al final del archivo. Conservá `AGENT_SERVICE_KEY` y `N8N_WEBHOOK_KEY` con los mismos valores usados en n8n. Tampoco cambies `PANEL_ORIGIN`, `APP_ORIGIN` ni el archivo de configuración del panel.

Guardá y **reiniciá la API** para que lea los cambios. Si está en una terminal, detenela con `Ctrl+C` y arrancala otra vez desde la carpeta del proyecto:

```sh
cd /Users/dev0/koi/clients/unsta/backend
npm start
```

No inicies una segunda copia si la API sigue ocupando el puerto 4100. Si el proceso está en una sesión iniciada por Codex, pedile a Codex que lo reinicie con la nueva configuración.

El mensaje de arranque debe indicar **despacho n8n activo**. El proceso que envía los mensajes a n8n arranca dentro de la API; no requiere otra terminal. El panel no necesita recompilarse.

Al habilitar el envío también se procesan los mensajes y aperturas que quedaron encolados anteriormente. Si no querés procesar los mensajes de un chat viejo, tomalo o cerralo desde Equipo antes de activar: eso cancela sus turnos pendientes.

## 10. Hacer la primera prueba — EN EL PANEL

1. Abrí `http://localhost:3000` con tu sesión de evaluación.
2. Entrá en **Probar asistente**.
3. Tocá **Nueva persona de prueba**. Así empezás una conversación en modo Asistente, sin una toma humana anterior.
4. En la pestaña **Interesado**, enviá:

   > Hola, soy Martina Demo. Me interesa Psicología en Yerba Buena. ¿Cuánto dura la carrera?

5. Esperá a que aparezca la respuesta del asistente.
6. Comprobá que se vean las fuentes consultadas y que se hayan guardado el nombre y el interés, si el agente realizó esas acciones. Recargá para confirmar que persisten.

**La prueba pasó cuando el asistente responde dentro del panel.** Importar, publicar o recibir un `202` del webhook no significa por sí solo que la respuesta esté terminada.

Después probá estas situaciones:

| Acción | Qué comprobar |
| --- | --- |
| Preguntar cuánto cuesta Medicina | Reconoce que el arancel no está confirmado; no inventa un precio. |
| Pedir hablar con una persona | Aparece la derivación; Equipo puede tomar el chat y responder. |
| Tomar el chat desde Equipo | El asistente queda pausado. |
| Devolver al asistente y enviar un mensaje nuevo | Vuelve a responder automáticamente. |
| Pedir “Avisame cuando abra una nueva edición de Inglés A1” | Tras confirmar el registro, aparece la suscripción en Seguimiento. |
| Crear una apertura simulada de Inglés A1 | Aparece un aviso interno para la suscripción activa. No envía WhatsApp ni email. |

En Estado de la demo, **“Verificación del agente en vivo” todavía es un indicador fijo pendiente**; no cambia automáticamente. El resultado se comprueba con la respuesta y los registros persistidos. Los 15 casos de conocimiento están en `base-conocimiento/demo-v1/casos-demo.json`. La evaluación real, junto con cinco casos de flujo/seguridad, está registrada en `docs/pruebas-agente-2026-10-31/10-matriz-casos.json`; falta repetir los fallidos y parciales después de corregirlos.

## Si no funciona: encontrar en qué paso se corta

Para esta primera prueba, los JSON traen desactivado el guardado de ejecuciones. Si necesitás inspeccionar una falla, en Settings del workflow activá temporalmente **Save failed production executions**; para ver también respuestas y herramientas, **Save successful production executions**. Usá datos ficticios y volvé a desactivarlo al terminar. Luego revisá **Executions** y el nodo que falló.

| Lo que ves | Qué revisar primero |
| --- | --- |
| El panel dice que n8n está pendiente | Las dos URLs en `.env.local`, `DISPATCH_ENABLED=true` y reinicio de la API. |
| No se inicia una ejecución en n8n | Production URL correcta, workflow publicado y Header Auth de Entrada. |
| 401/403 en Entrada | Su credencial debe contener el mismo `N8N_WEBHOOK_KEY` que el backend. |
| 401 en un nodo HTTP o herramienta | Seleccionar UNSTA · Backend agente y revisar `Bearer ` + clave real, con un espacio. |
| 404 del webhook | No usar Test URL; verificar path y publicación. |
| `CONFIGURAR_BACKEND_UNSTA` | Corregir `api_base_url` en los tres workflows. Debe ser el origen HTTPS válido del backend. |
| Error de conexión con el backend | Mantener API y túnel encendidos; probar `/health`. |
| 404 del turno o turno no disponible | Usar el backend conectado a la misma base del panel y empezar una conversación nueva. Un turno cancelado o ya procesado no se vuelve a ejecutar. |
| Falla Modelo conversacion o Modelo resumen | Revisar credencial OpenAI, acceso a `gpt-4.1-mini` y cuota de API. |
| Se guarda el mensaje, pero no responde el bot | Confirmar modo Asistente, revisar la ejecución y, si el turno falló, corregir la causa antes de usar Reintentar. |
| Un nodo aparece como desconocido | Revisar la versión de n8n; no reemplazar ese nodo por uno distinto sin validar la compatibilidad. |

## Si los servicios locales están apagados

Esto es para volver a encender la instalación existente. Si ya funciona, no repitas los arranques.

Abrí Docker Desktop. En una terminal, desde la carpeta del proyecto:

```sh
cd /Users/dev0/koi/clients/unsta/backend
docker compose --env-file .env.local up -d postgres
npm start
```

Dejá esa terminal abierta. En otra, iniciá el panel compilado:

```sh
cd /Users/dev0/koi/clients/unsta/backend
npm run panel:start
```

En otra, mantené el túnel del paso 5. La base de datos se conserva en el volumen de Docker. Los detalles de instalación inicial están en [backend-local.md](backend-local.md).

## Para la siguiente sesión de prueba

Si cerrás el túnel, su URL deja de funcionar. Al iniciar uno nuevo, repetí los pasos **5, 6 y publicación de los cambios del 7**. Las credenciales y las Production URLs de n8n se conservan mientras no las cambies.

Para pausar nuevas llamadas al modelo, poné `DISPATCH_ENABLED=false` y reiniciá la API. Una ejecución ya iniciada puede seguir; tomar o cerrar su chat invalida ese turno.

## Nota para mantener los archivos del proyecto

Esta guía permite configurar los flujos directamente en el editor. Para conservar la misma URL en la próxima exportación, actualizar también `api_base_url` en `agent-contract/config.json` y ejecutar:

```sh
npm run workflows:build
npm run check
```

Los tres JSON son generados. Las credenciales se asignan en la instancia y no se guardan en el contrato local. No editar solo un JSON derivado como fuente permanente.

Versiones de nodos usadas: Webhook 2.1; HTTP Request 4.2; HTTP Request Tool 4.3; AI Agent 2.2; OpenAI Chat Model 1.2; IF 2.2; Code 2; Basic LLM Chain 1.7 para el resumen. Se tomaron como referencia de los artefactos Lamelas revisados, sin certificar aún la ejecución en tu instancia.
