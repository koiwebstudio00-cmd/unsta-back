// Contract simulator, not n8n integration: executes generated Code nodes and
// expressions with HTTP/model fixtures. No network or LLM is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Script,createContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {buildArtifacts} from '../build-n8n.mjs';
import {verifyWorkflows} from '../verify-n8n.mjs';
import {loadKnowledge,catalog,getRecords} from '../knowledge.mjs';

const artifacts=buildArtifacts();
const kb=loadKnowledge();
const turn='11111111-1111-4111-8111-111111111111';
const message='22222222-2222-4222-8222-222222222222';
const attempt={claimed:true,turn_id:turn,attempt_id:'attempt-test',attempt_token:'test-attempt-token-only'};
const baseContext={turn_id:turn,attempt_id:attempt.attempt_id,conversation:{id:'conv-test',mode:'bot',control_version:1},knowledge_version:kb.kb.version,knowledge_hash:kb.hash,context_sequence:1,current_message:{id:message,role:'user',text:'Quiero Psicología en Yerba Buena',sequence:1},messages:[],contact:{},catalog:catalog(kb),summary_due:false};
const getWorkflow=name=>JSON.parse(artifacts.get(`n8n/unsta-demo-${name}.json`));
function evalIn(code,json,outputs,ai={}) {
 const ctx=createContext({$json:json,$:name=>({first:()=>({json:outputs[name]})}),$fromAI:(key,description,type,fallback)=>ai[key]??fallback,$execution:{id:'exec-test'},$workflow:{id:'workflow-test'},Date});
 return new Script(code).runInContext(ctx,{timeout:1000});
}
function expr(value,json,outputs,ai) {
 if(typeof value!=='string'||!value.startsWith('={{ ')||!value.endsWith(' }}'))return value;
 return evalIn(`(${value.slice(4,-3)})`,json,outputs,ai);
}
function simulate(name,options={}) {
 const w=getWorkflow(name),outputs={},visits=[],requests=[];
 let current=w.nodes.find(n=>n.type.endsWith('.webhook')||n.type.endsWith('.errorTrigger')).name;
 let input=options.input??{body:{[name==='apertura'?'event_id':'turn_id']:turn}};
 while(current){
  const n=w.nodes.find(n=>n.name===current);visits.push(current);assert.ok(visits.length<70,'Cycle');
  let output=input,branch=0;
  if(n.type.endsWith('.code')) {
   let js=n.parameters.jsCode;
   if(current==='Configuracion UNSTA')js=js.replace('https://unsta-api.example.invalid','https://api.unsta-demo.test');
   const items=evalIn(`(function(){${js}\n})()`,input,outputs);
   if(items.length===0)break;
   output=items[0].json;
  } else if(n.type.endsWith('.if')) {
   branch=expr(n.parameters.conditions.conditions[0].leftValue,input,outputs)===true?0:1;
  } else if(n.type.endsWith('.respondToWebhook')) {
   output=JSON.parse(expr(n.parameters.responseBody,input,outputs));
  } else if(n.type.endsWith('.httpRequest')) {
   const request={name:current,url:expr(n.parameters.url,input,outputs),body:n.parameters.jsonBody?JSON.parse(expr(n.parameters.jsonBody,input,outputs)):null};requests.push(request);
   if(current==='reclamar_turno')output=options.claim??attempt;
   else if(current==='obtener_contexto')output=options.context??baseContext;
   else if(current==='finalizar_turno')output=options.completion??{published:true,response_sequence:3};
   else if(current==='reclamar_evento')output={...attempt,event_id:turn};
   else output={ok:true};
  } else if(n.type.endsWith('.agent')) output=options.agent??{output:'Psicología: información publicada.',intermediateSteps:[{action:{tool:'ver_propuesta'},observation:getRecords(kb,['carrera-psicologia'])}]};
  else if(n.type.endsWith('.chainLlm'))output=options.summary??{text:'{"intereses":["Psicología"],"proximo_paso":"Consultar admisiones"}'};
  outputs[current]=output;
  const next=w.connections[current]?.main?.[branch]?.[0]?.node;
  current=next;input=output;
 }
 return {outputs,visits,requests};
}

test('archivos en disco reproducibles y estructura válida',()=>assert.equal(verifyWorkflows(),3));
test('recorrido feliz: 202, claim, contexto, agente, complete; sin resumen prematuro',()=>{
 const r=simulate('conversacion');
 assert.ok(r.visits.indexOf('aceptar_entrada')<r.visits.indexOf('Agente UNSTA'));
 assert.ok(!r.visits.includes('guardar_resumen'));
 const body=r.requests.find(x=>x.name==='finalizar_turno').body;
 assert.equal(body.turn_id,turn);assert.equal(body.attempt_id,attempt.attempt_id);assert.deepEqual(body.record_ids,['carrera-psicologia']);
 assert.ok(r.requests.every(x=>x.url.startsWith('https://api.unsta-demo.test/v1/agent/')));
});
test('entrada inválida no llega a configuración, API ni modelo',()=>{
 const r=simulate('conversacion',{input:{body:{turn_id:turn,api_base_url:'https://evil.test'}}});
 assert.equal(r.requests.length,0);assert.ok(r.visits.includes('rechazar_entrada'));
});
test('turno duplicado no ejecuta agente ni publica respuesta',()=>{
 const r=simulate('conversacion',{claim:{claimed:false,turn_id:turn}});
 assert.equal(r.requests.length,1);assert.ok(!r.visits.includes('Agente UNSTA'));
});
test('toma humana anterior al contexto cancela sin usar modelo',()=>{
 const r=simulate('conversacion',{context:{...baseContext,conversation:{...baseContext.conversation,mode:'humano'}}});
 assert.ok(r.visits.includes('cancelar_turno'));assert.ok(!r.visits.includes('Agente UNSTA'));assert.ok(!r.visits.includes('finalizar_turno'));
});
test('backend rechaza publicación tardía y workflow no genera resumen',()=>{
 const r=simulate('conversacion',{context:{...baseContext,summary_due:true},completion:{published:false,reason:'human_control'}});
 assert.ok(r.visits.includes('finalizar_turno'));assert.ok(!r.visits.includes('Resumir conversacion'));
});
test('resumen usa horizonte de contexto, sin saltar mensajes concurrentes',()=>{
 const r=simulate('conversacion',{context:{...baseContext,summary_due:true}});
 const body=r.requests.find(x=>x.name==='guardar_resumen').body;
 assert.equal(body.through_sequence,1);assert.notEqual(body.through_sequence,r.outputs.finalizar_turno.response_sequence);
 assert.ok(r.visits.indexOf('finalizar_turno')<r.visits.indexOf('Resumir conversacion'));
});
test('fallo o JSON inválido del resumen no reintenta respuesta ni guarda resumen vacío',()=>{
 for(const summary of [{error:'timeout'},{text:'malformed'},{text:'{}'}]) {
  const r=simulate('conversacion',{context:{...baseContext,summary_due:true},summary});
  assert.ok(r.visits.includes('registrar_resumen_omitido'));assert.ok(!r.visits.includes('guardar_resumen'));
  assert.equal(r.visits.filter(x=>x==='finalizar_turno').length,1);
 }
});
test('derivación confirmada usa mensaje canónico y actualiza resumen post-handoff',()=>{
 const agent={output:'mensaje arbitrario',intermediateSteps:[{action:{tool:'derivar_a_area'},observation:{ok:true,data:{turn_id:turn,attempt_id:attempt.attempt_id,caso:{id:'case-test',estado:'pendiente'},conversation:{id:'conv-test',mode:'esperando_humano',control_version:2}}}}]};
 const r=simulate('conversacion',{context:{...baseContext,summary_due:true},agent});
 assert.equal(r.outputs.preparar_respuesta.handoff_id,'case-test');assert.ok(r.visits.includes('Resumir conversacion'));
});
test('6 herramientas fijan URL, token e intento fuera del control del modelo',()=>{
 const w=getWorkflow('conversacion');
 const outputs={'Configuracion UNSTA':{api_base_url:'https://api.unsta-demo.test'},validar_claim:attempt};
 const malicious={turn_id:'other',attempt_id:'other',attempt_token:'evil',api_base_url:'https://evil.test'};
 for(const n of w.nodes.filter(n=>n.type.endsWith('.httpRequestTool'))){
  const url=expr(n.parameters.url,{},outputs,malicious);
  assert.equal(url,`https://api.unsta-demo.test/v1/agent/turns/${turn}/tools/${n.name}`);
  const body=JSON.parse(expr(n.parameters.jsonBody,{},outputs,malicious));
  assert.equal(body.attempt_id,attempt.attempt_id);assert.equal(body.datos.turn_id,undefined);assert.equal(body.datos.attempt_token,undefined);
  assert.equal(expr(n.parameters.headerParameters.parameters[0].value,{},outputs,malicious),attempt.attempt_token);
 }
});
test('error workflow reporta solo metadatos seguros',()=>{
 const r=simulate('errores',{input:{execution:{id:'123',error:{message:'SECRET'},lastNodeExecuted:'Agente UNSTA'},workflow:{id:'wf-test'}}});
 assert.equal(r.requests[0].body.execution_id,'123');assert.ok(!JSON.stringify(r.requests).includes('SECRET'));
});
test('apertura exige claim y llama a procesamiento interno, sin modelo ni canal externo',()=>{
 const r=simulate('apertura');
 assert.deepEqual(r.requests.map(x=>x.name),['reclamar_evento','procesar_apertura']);
 assert.equal(r.requests[1].body.attempt_id,attempt.attempt_id);
});
test('modelo no puede seleccionar IDs de espacio/contacto en contratos de herramienta',()=>{
 const tools=JSON.parse(readFileSync(new URL('../tools.json',import.meta.url))).tools;
 for(const t of tools) {
  assert.equal(t.inputSchema.additionalProperties,false);
  for(const key of ['workspace_id','contact_id','conversation_id','turn_id','attempt_id','attempt_token'])assert.equal(t.inputSchema.properties[key],undefined);
 }
});

test('herramientas exponen argumentos primitivos y omiten opcionales vacíos',()=>{
 const w=getWorkflow('conversacion');
 const outputs={'Configuracion UNSTA':{api_base_url:'https://api.unsta-demo.test'},validar_claim:attempt};
 const contact=w.nodes.find(n=>n.name==='actualizar_contacto');
 const body=JSON.parse(expr(contact.parameters.jsonBody,{},outputs,{email:'qa@example.test',mensaje_evidencia_id:message}));
 assert.deepEqual(body,{attempt_id:attempt.attempt_id,datos:{email:'qa@example.test',mensaje_evidencia_id:message}});
 const interest=w.nodes.find(n=>n.name==='registrar_interes');
 const data=JSON.parse(expr(interest.parameters.jsonBody,{},outputs,{propuesta_id:'medicina',mensaje_evidencia_id:message})).datos;
 assert.equal(data.propuesta_libre,undefined);assert.equal(data.preinscripcion_declarada,false);
 for(const n of w.nodes.filter(n=>n.type.endsWith('.httpRequestTool'))) {
  assert.ok(!n.parameters.jsonBody.includes("$fromAI('datos'"));
  assert.ok(!n.parameters.jsonBody.includes(',"json"'));
 }
});
