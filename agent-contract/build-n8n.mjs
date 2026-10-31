#!/usr/bin/env node
// Local-only generator. No network, deployment, credentials or instance IDs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as runtime from './runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(root + path, 'utf8');
const config = JSON.parse(read('agent-contract/config.json'));
const tools = JSON.parse(read('agent-contract/tools.json')).tools;
const prompt = read('agent-contract/system-prompt.md').trim();
const summaryPrompt = read('agent-contract/prompt-summary.md').trim();
const hash = value => createHash('sha256').update(value).digest('hex');
config.knowledge_hash = hash(read('base-conocimiento/demo-v1/unsta-demo.json'));
const expression = js => `={{ ${js} }}`;
const from = name => `$('${name}').first().json`;
const C = from('Configuracion UNSTA');
const claim = from('validar_claim');
const ctx = from('preparar_contexto');

function workflow(name, description) {
  return {
    name, active: false, nodes: [], connections: {}, pinData: {},
    settings: {
      executionOrder: 'v1', timezone: config.timezone,
      executionTimeout: config.workflow_timeout_seconds,
      saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none',
      saveExecutionProgress: false, saveManualExecutions: false
    },
    meta: { templateCredsSetupCompleted: false },
    _description: description
  };
}
function node(w, name, type, typeVersion, parameters, x, y, extra = {}) {
  const result = { id: hash(`${w.name}/${name}`).slice(0,32), name, type, typeVersion, position: [x,y], parameters, ...extra };
  w.nodes.push(result); return result;
}
function connect(w, a, b, output = 0, type = 'main') {
  w.connections[a] ??= {};
  w.connections[a][type] ??= [];
  while (w.connections[a][type].length <= output) w.connections[a][type].push([]);
  w.connections[a][type][output].push({ node: b, type, index: 0 });
}
const code = (w,n,js,x,y,extra={}) => node(w,n,'n8n-nodes-base.code',2,{mode:'runOnceForAllItems',jsCode:js},x,y,extra);
const run = (fn,args) => `(${fn.toString()})(${args})`;
const gate = (w,n,test,x,y) => node(w,n,'n8n-nodes-base.if',2.2,{
  conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},
    conditions:[{id:hash(n).slice(0,16),leftValue:expression(test),rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}
},x,y);
const noop = (w,n,x,y) => node(w,n,'n8n-nodes-base.noOp',1,{},x,y);
function http(w,n,method,path,body,x,y,{scoped=false,tool=false,description='',extra={}}={}) {
  return node(w,n,`n8n-nodes-base.${tool?'httpRequestTool':'httpRequest'}`,tool?4.3:4.2,{
    ...(tool?{toolDescription:description}:{}),method,
    url: expression(`${C}.api_base_url + ${path}`),
    authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',
    ...(scoped?{sendHeaders:true,headerParameters:{parameters:[{name:'X-UNSTA-Attempt-Token',value:expression(`${claim}.attempt_token`)}]}}:{}),
    ...(body?{sendBody:true,specifyBody:'json',jsonBody:expression(`JSON.stringify(${body})`)}:{}),
    options:{timeout:config.request_timeout_ms}
  },x,y,{notes:'Asignar credencial Header Auth propia de UNSTA (Authorization: Bearer <secreto>). No usar credenciales de Lamelas.',...extra});
}
function configure(w,x,y) {
  code(w,'Configuracion UNSTA',`const config = ${JSON.stringify(config,null,2)};\nreturn [{json: ${run(runtime.validateConfig,'config')}}];`,x,y,
    {notes:'Origen del backend UNSTA. El placeholder .invalid bloquea la ejecución hasta configurar. No recibe URLs del webhook.',notesInFlow:true});
}
function incoming(w,kind,path) {
  const field=kind==='event'?'event_id':'turn_id';
  node(w,'Entrada','n8n-nodes-base.webhook',2.1,{httpMethod:'POST',path,authentication:'headerAuth',responseMode:'responseNode',options:{}},0,0,
    {webhookId:hash(path).slice(0,32),notes:'Asignar Header Auth UNSTA Entradas: X-UNSTA-Webhook-Key. Solo invoca el backend, nunca el navegador.'});
  code(w,'validar_entrada',`return [{json: ${run(runtime.validateEntry,`$json, '${kind}'`)}}];`,220,0);
  gate(w,'entrada_valida','$json.valid === true',440,0);
  node(w,'rechazar_entrada','n8n-nodes-base.respondToWebhook',1.1,{
    respondWith:'json',responseBody:JSON.stringify({accepted:false,error:'Entrada inválida'}),options:{responseCode:400}
  },660,220);
  configure(w,660,0);
  node(w,'aceptar_entrada','n8n-nodes-base.respondToWebhook',1.1,{
    respondWith:'json',responseBody:expression(`JSON.stringify({accepted:true,${field}:${from('validar_entrada')}.${field}})`),options:{responseCode:202}
  },880,0);
  connect(w,'Entrada','validar_entrada');connect(w,'validar_entrada','entrada_valida');
  connect(w,'entrada_valida','Configuracion UNSTA');connect(w,'entrada_valida','rechazar_entrada',1);
  connect(w,'Configuracion UNSTA','aceptar_entrada');
}
function claiming(w,kind) {
  const isEvent=kind==='event';const field=isEvent?'event_id':'turn_id';const path=isEvent?'events':'turns';const n=isEvent?'reclamar_evento':'reclamar_turno';
  const route=`'/v1/agent/${path}/' + ${from('validar_entrada')}.${field} + '/claim'`;
  http(w,n,'POST',route,`{execution_id:String($execution.id),workflow_id:String($workflow.id),contract_version:${C}.contract_version}`,1100,0);
  code(w,'validar_claim',`return [{json: ${run(runtime.validateClaim,`$json, ${from('validar_entrada')}, '${kind}'`)}}];`,1320,0);
  gate(w,'claim_adquirido','$json.claimed === true',1540,0);
  noop(w,'ya_procesado_o_no_disponible',1760,240);
  connect(w,'aceptar_entrada',n);connect(w,n,'validar_claim');connect(w,'validar_claim','claim_adquirido');
  connect(w,'claim_adquirido','ya_procesado_o_no_disponible',1);
}
function model(w,name,x,y,temperature) {
  node(w,name,'@n8n/n8n-nodes-langchain.lmChatOpenAi',1.2,{
    model:{__rl:true,mode:'list',value:config.model},options:{temperature,maxTokens:1800,timeout:45000,maxRetries:0}
  },x,y,{notes:'Asignar credencial OpenAI UNSTA en n8n. Modelo inicial de comparación heredado de Lamelas; validar calidad y disponibilidad.'});
}
function conversation() {
  const w=workflow('UNSTA · 01 Conversacion demo','Agente + herramientas + finalización transaccional + resumen opcional. Requiere backend UNSTA.');
  incoming(w,'turn','unsta-demo-conversacion-v1');claiming(w,'turn');
  http(w,'obtener_contexto','GET',`'/v1/agent/turns/' + ${claim}.turn_id + '/context'`,null,1760,0,{scoped:true});
  code(w,'preparar_contexto',`const input = {...$json, summary: ${run(runtime.normalizeSummary,'$json.summary')} ?? {}};\nreturn [{json: ${run(runtime.prepareContext,`input, ${claim}, ${C}, new Date().toISOString()`)}}];`,1980,0);
  gate(w,'bot_activo','$json.can_run === true',2200,0);
  http(w,'cancelar_turno','POST',`'/v1/agent/turns/' + ${claim}.turn_id + '/cancel'`,
    `{attempt_id:${claim}.attempt_id,reason:'control_humano'}`,2420,220,{scoped:true});
  node(w,'Agente UNSTA','@n8n/n8n-nodes-langchain.agent',2.2,{
    promptType:'define',text:expression(`${ctx}.prompt_input`),
    options:{systemMessage:prompt,returnIntermediateSteps:true,maxIterations:config.max_iterations}
  },2460,-40);
  model(w,'Modelo conversacion',2300,-300,0.2);
  connect(w,'Modelo conversacion','Agente UNSTA',0,'ai_languageModel');
  for(const [i,t] of tools.entries()) {
    // Expose primitive fields to the model: fromAI(json) emits an opaque schema
    // on some n8n versions and can produce empty datos before any HTTP call.
    const fields=Object.entries(t.inputSchema.properties).map(([key,schema])=>{
      const required=t.inputSchema.required.includes(key);
      const description=`${key}. ${schema.description??''} ${required?'Obligatorio.':'Opcional; usar el valor vacío si no fue declarado.'} ${schema.enum?`Valores permitidos: ${schema.enum.join(', ')}.`:''} ${key==='mensaje_evidencia_id'?'ID real del mensaje de usuario del contexto; nunca inventar.':''} ${key==='preinscripcion_declarada'?'true solo con declaración explícita; false en otro caso.':''}`;
      const fallback=required?'':`, ${schema.type==='boolean'?'false':"''"}`;
      return `${JSON.stringify(key)}:$fromAI(${JSON.stringify(key)},${JSON.stringify(description)},${JSON.stringify(schema.type)}${fallback})`;
    });
    const data=`Object.fromEntries(Object.entries({${fields.join(',')}}).filter(([key,value])=>value!=='' && value!==null && value!==undefined))`;
    http(w,t.name,'POST',`'/v1/agent/turns/' + ${claim}.turn_id + '/tools/${t.name}'`,
      `{attempt_id:${claim}.attempt_id,datos:${data}}`,2180+i*220,-560,
      {scoped:true,tool:true,description:t.description});
    connect(w,t.name,'Agente UNSTA',0,'ai_tool');
  }
  code(w,'preparar_respuesta',`return [{json: ${run(runtime.prepareResponse,`$json, ${ctx}`)}}];`,2740,0);
  http(w,'finalizar_turno','POST',`'/v1/agent/turns/' + ${claim}.turn_id + '/complete'`,'$json',2960,0,{scoped:true});
  gate(w,'resumen_necesario',`$json.published === true && ${ctx}.summary_due === true`,3180,0);
  noop(w,'fin',3400,220);
  node(w,'Resumir conversacion','@n8n/n8n-nodes-langchain.chainLlm',1.7,{
    promptType:'define',text:expression(`JSON.stringify({contexto:JSON.parse(${ctx}.prompt_input),respuesta_publicada:${from('preparar_respuesta')}.texto})`),
    messages:{messageValues:[{message:summaryPrompt,type:'SystemMessagePromptTemplate'}]},batching:{batchSize:1}
  },3400,0,{onError:'continueRegularOutput',notes:'Resumen posterior a publicación. Su fallo no reabre ni reenvía el turno.'});
  model(w,'Modelo resumen',3400,-240,0);
  connect(w,'Modelo resumen','Resumir conversacion',0,'ai_languageModel');
  code(w,'normalizar_resumen',`const resumen = $json.error ? null : ${run(runtime.normalizeSummary,'$json.text ?? $json.output ?? $json')};\nreturn [{json: {resumen}}];`,3640,0);
  gate(w,'resumen_valido','$json.resumen !== null',3860,0);
  http(w,'guardar_resumen','PUT',`'/v1/agent/turns/' + ${claim}.turn_id + '/summary'`,
    `{attempt_id:${claim}.attempt_id,resumen:$json.resumen,through_sequence:${ctx}.summary_through_sequence,control_version:${ctx}.control_version}`,4080,0,
    {scoped:true,extra:{onError:'continueRegularOutput'}});
  http(w,'registrar_resumen_omitido','POST',`'/v1/agent/turns/' + ${claim}.turn_id + '/summary-skipped'`,
    `{attempt_id:${claim}.attempt_id,code:'SUMMARY_UNAVAILABLE'}`,4080,220,{scoped:true,extra:{onError:'continueRegularOutput'}});
  connect(w,'claim_adquirido','obtener_contexto');connect(w,'obtener_contexto','preparar_contexto');connect(w,'preparar_contexto','bot_activo');
  connect(w,'bot_activo','Agente UNSTA');connect(w,'bot_activo','cancelar_turno',1);
  connect(w,'Agente UNSTA','preparar_respuesta');connect(w,'preparar_respuesta','finalizar_turno');connect(w,'finalizar_turno','resumen_necesario');
  connect(w,'resumen_necesario','Resumir conversacion');connect(w,'resumen_necesario','fin',1);
  connect(w,'Resumir conversacion','normalizar_resumen');connect(w,'normalizar_resumen','resumen_valido');
  connect(w,'resumen_valido','guardar_resumen');connect(w,'resumen_valido','registrar_resumen_omitido',1);
  return w;
}
function errors() {
  const w=workflow('UNSTA · 02 Errores demo','Reporte interno mínimo, sin texto de errores, credenciales, notas o conversaciones.');
  node(w,'Error Trigger','n8n-nodes-base.errorTrigger',1,{},0,0);
  configure(w,220,0);
  code(w,'normalizar_error',`return [{json:${run(runtime.normalizeError,`${from('Error Trigger')}`)}}];`,440,0);
  http(w,'reportar_incidente','POST',"'/v1/agent/incidents'",'$json',660,0);
  connect(w,'Error Trigger','Configuracion UNSTA');connect(w,'Configuracion UNSTA','normalizar_error');connect(w,'normalizar_error','reportar_incidente');
  return w;
}
function opening() {
  const w=workflow('UNSTA · 03 Apertura simulada','Procesa un evento autorizado y genera avisos demo internos; no envía correo ni WhatsApp.');
  incoming(w,'event','unsta-demo-apertura-v1');claiming(w,'event');
  http(w,'procesar_apertura','POST',`'/v1/agent/events/' + ${claim}.event_id + '/process'`,
    `{attempt_id:${claim}.attempt_id}`,1760,0,{scoped:true});
  connect(w,'claim_adquirido','procesar_apertura');
  return w;
}
export function buildArtifacts() {
  const outputs = new Map();
  for(const [filename,w] of [
    ['unsta-demo-conversacion.json',conversation()],['unsta-demo-errores.json',errors()],['unsta-demo-apertura.json',opening()]
  ]) {
    const description=w._description;delete w._description;
    node(w,'Leer antes de importar','n8n-nodes-base.stickyNote',1,{
      content:`## UNSTA · Demo v${config.contract_version}\n${description}\n\nConfigurar backend y credenciales UNSTA. No publicar antes de conectar el backend.\nConsultar docs/importar-n8n.md. Los IDs de workflows son nuevos al importar.`,height:240,width:540
    },0,-340);
    outputs.set(`n8n/${filename}`,JSON.stringify(w,null,2)+'\n');
  }
  const knowledge=read('base-conocimiento/demo-v1/unsta-demo.json');
  outputs.set('n8n/manifest.json',JSON.stringify({
    contract_version:config.contract_version,
    knowledge:{version:config.knowledge_version,sha256:hash(knowledge),path:'base-conocimiento/demo-v1/unsta-demo.json'},
    prompt_sha256:hash(prompt),tools_sha256:hash(read('agent-contract/tools.json')),
    n8n_instance_target:'https://n8n.inmobiliarialyc.com.ar/',
    imported:false,live_tested:false,
    files:[...outputs].map(([path,body])=>({path,sha256:hash(body)})),
    compatibility:'Node versions taken from the reviewed Lamelas workflows; Basic LLM Chain 1.7 replaces the tool-less summary agent. Verify instance version on manual import.'
  },null,2)+'\n');
  return outputs;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(root+'n8n',{recursive:true});
  for(const [path,body] of buildArtifacts()) writeFileSync(root+path,body);
  console.log('Generados 3 workflows inactivos y manifest local. No se contactó ninguna instancia.');
}
