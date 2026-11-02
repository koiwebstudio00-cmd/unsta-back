import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEntry,validateConfig,validateClaim,prepareContext,prepareResponse,normalizeSummary,normalizeError} from '../runtime.mjs';
import {loadKnowledge,catalog,getRecords,searchKnowledge} from '../knowledge.mjs';
const turn='11111111-1111-4111-8111-111111111111';
const msg='22222222-2222-4222-8222-222222222222';
const kb=loadKnowledge();
const config={knowledge_version:kb.kb.version,knowledge_hash:kb.hash,timezone:'America/Argentina/Tucuman'};
const claim={turn_id:turn,attempt_id:'attempt-test',attempt_token:'test-token-not-a-secret',claimed:true};
const input={turn_id:turn,attempt_id:claim.attempt_id,conversation:{id:'conv-test',mode:'bot',control_version:7},knowledge_version:kb.kb.version,knowledge_hash:kb.hash,context_sequence:1,current_message:{id:msg,role:'user',text:'Quiero estudiar Psicología en Yerba Buena',sequence:1},messages:[],contact:{},catalog:catalog(kb),summary_due:false};
const context=()=>prepareContext(input,claim,config,'2026-10-31T15:00:00Z');
const success=()=>({ok:true,data:{turn_id:turn,attempt_id:claim.attempt_id,caso:{id:'case-test',estado:'pendiente'},conversation:{id:'conv-test',mode:'esperando_humano',control_version:8}}});
const handoff=(observation)=>({output:'Ya estás inscripto',intermediateSteps:[{action:{tool:'derivar_a_area'},observation}]});

test('entrada mínima: rechaza texto, IDs extra y URLs controladas por cliente',()=>{
 assert.equal(validateEntry({body:{turn_id:turn}},'turn').valid,true);
 for(const body of [null,[],{}, {turn_id:'../other'}, {turn_id:turn,api_base_url:'https://evil.test'}, {turn_id:turn,contact_id:msg}])assert.equal(validateEntry({body},'turn').valid,false);
 assert.equal(validateEntry({body:{event_id:turn}},'event').valid,true);
});
test('config bloquea placeholder, HTTP, credenciales en URL y API Lamelas',()=>{
 for(const api_base_url of ['https://unsta-api.example.invalid','http://api.unsta-demo.test','https://user:password@unsta.test','https://api.inmobiliarialyc.com.ar','https://unsta.test/path','https://unsta.test?token=bad'])assert.throws(()=>validateConfig({api_base_url}));
 assert.equal(validateConfig({api_base_url:'https://api.unsta-demo.test/'}).api_base_url,'https://api.unsta-demo.test');
});
test('claim vinculado al ID recibido, duplicado termina sin token',()=>{
 assert.equal(validateClaim(claim,{turn_id:turn},'turn').claimed,true);
 assert.deepEqual(validateClaim({turn_id:turn,claimed:false,attempt_token:'bad'},{turn_id:turn},'turn'),{turn_id:turn,claimed:false});
 assert.throws(()=>validateClaim({...claim,turn_id:msg},{turn_id:turn},'turn'));
 assert.throws(()=>validateClaim({...claim,attempt_token:''},{turn_id:turn},'turn'));
});
test('contexto evita notas y tokens en prompt, fecha real y catálogo',()=>{
 const result=prepareContext({...input,attempt_token:'DO_NOT_SEND',internal_notes:'DO_NOT_SEND',contact:{nombre:'Ana',internal_notes:'DO_NOT_SEND'}},claim,config,'2026-11-02T15:00:00Z');
 assert.ok(!result.prompt_input.includes('DO_NOT_SEND'));
 assert.ok(result.prompt_input.includes('2026-11-02'));
 assert.equal(JSON.parse(result.prompt_input).catalogo.length,12);
});
test('cambio a humano detiene agente y versión equivocada de KB falla',()=>{
 assert.equal(prepareContext({...input,conversation:{...input.conversation,mode:'humano'}},claim,config,'now').can_run,false);
 assert.throws(()=>prepareContext({...input,knowledge_version:'other'},claim,config,'now'));
 assert.throws(()=>prepareContext({...input,context_sequence:0},claim,config,'now'));
});
test('respuesta vacía o demasiado larga se rechaza sin publicar',()=>{
 assert.throws(()=>prepareResponse({output:''},context()));
 assert.throws(()=>prepareResponse({output:'x'.repeat(6001)},context()));
});
test('handoff solo confirma mismo turno, intento, conversación y versión',()=>{
 const response=prepareResponse(handoff(JSON.stringify(success())),context());
 assert.equal(response.handoff_id,'case-test');assert.equal(response.control_version,8);
 assert.ok(response.texto.includes('equipo de esta demo'));assert.ok(!response.texto.includes('inscripto'));
 const mutations=[p=>p.data.turn_id='otro',p=>p.data.attempt_id='otro',p=>p.data.conversation.id='otro',p=>p.data.conversation.control_version=9,p=>p.data.caso.estado='tomado',p=>p.ok=false,p=>p.data.conversation.mode='humano'];
 for(const mutate of mutations){const p=success();mutate(p);const r=prepareResponse(handoff(p),context());assert.equal(r.handoff_id,null);assert.match(r.texto,/No pude confirmar/);}
});
test('handoff acepta envoltorio de herramienta y nunca reutiliza éxito anterior al último fallo',()=>{
 assert.equal(prepareResponse(handoff({content:[{type:'text',text:JSON.stringify(success())}]}),context()).handoff_id,'case-test');
 const steps=[...handoff(success()).intermediateSteps,...handoff({error:'timeout'}).intermediateSteps];
 assert.equal(prepareResponse({output:'ok',intermediateSteps:steps},context()).handoff_id,null);
});
test('referencias salen de búsquedas exitosas de esta versión, no del modelo',()=>{
 const r=prepareResponse({output:'Información',record_ids:['inventado'],intermediateSteps:[
  {action:{tool:'ver_propuesta'},observation:getRecords(kb,['carrera-psicologia'])},
  {action:{tool:'consultar_conocimiento'},observation:{ok:true,data:{knowledge_version:'otra',registros:[{id:'inventado'}]}}}
 ]},context());
 assert.deepEqual(r.record_ids,['carrera-psicologia']);
});
test('resumen defensivo: solo claves permitidas, límites, sin mutación',()=>{
 const raw={nombre:' Ana ',password:'bad',intereses:['Psicología','psicología',null],condicion:'admin',proximo_paso:'x'.repeat(500),hechos_declarados:Array(20).fill('Dijo algo')};
 const r=normalizeSummary(raw);assert.equal(r.password,undefined);assert.equal(r.condicion,undefined);assert.equal(r.nombre,'Ana');assert.equal(r.proximo_paso.length,300);assert.deepEqual(r.intereses,['Psicología']);assert.equal(raw.nombre,' Ana ');
 assert.equal(normalizeSummary('no json'),null);assert.equal(normalizeSummary('[]'),null);assert.equal(normalizeSummary('{}'),null);
 assert.equal(normalizeSummary('```json\n{"nombre":"Ana"}\n```').nombre,'Ana');
});
test('error de ejecución/trigger no filtra secretos ni mensajes de usuario',()=>{
 for(const input of [null,{execution:{id:'123',url:'https://secret.test/?token=DO_NOT_SEND',error:{message:'DO_NOT_SEND',stack:'DO_NOT_SEND'},lastNodeExecuted:'Agente UNSTA'},workflow:{id:'wf-1'}},{trigger:{error:{message:'DO_NOT_SEND',node:{name:'DO_NOT_SEND'}}},workflow:{id:'wf-2'}}])assert.ok(!JSON.stringify(normalizeError(input)).includes('DO_NOT_SEND'));
 assert.equal(normalizeError({trigger:{}}).code,'N8N_TRIGGER_FAILURE');
});
test('base: 40 registros, 19 fuentes y catálogo acotado de 12 propuestas',()=>{
 assert.equal(kb.records.size,40);assert.equal(kb.sources.size,19);assert.equal(catalog(kb).length,12);
});

test('consultas de ingreso recuperan requisitos confirmados y límites de casos especiales',()=>{
 for(const consulta of ['requisitos de inscripción documentos fotos DNI','ingreso mayores de 25 sin secundario','documentación extranjeros','equivalencias universidad institutos arancel']) {
  const r=searchKnowledge(kb,{consulta}).data.registros[0];
  assert.equal(r.id,'documentacion-general');
  assert.equal(r.validacion_institucional,true);
  assert.equal(r.estado,'confirmado');
  assert.equal(r.fuentes[0].url,'https://ingreso.unsta.edu.ar/documentacion-de-ingreso-unsta/');
  assert.match(r.datos.equivalencias_institutos_superiores.arancel,/20%/);
  assert.ok(r.condiciones_de_uso.some(c=>c.includes('numeración')&&c.includes('ambigua')));
  assert.ok(r.condiciones_de_uso.some(c=>c.includes('Preinscripción no equivale')));
 }
});
test('recuperación expande precios y horarios manteniendo restricciones y fuentes',()=>{
 const result=getRecords(kb,['curso-ingles-a1']);
 assert.ok(result.data.registros.length>=3);
 assert.ok(result.data.registros.every(r=>r.fuentes.every(s=>s.url.startsWith('https://'))));
 assert.ok(result.data.registros.some(r=>r.seccion==='horarios'&&r.condiciones_de_uso.length));
 assert.equal(getRecords(kb,['carrera-medicina']).data.registros[0].datos.arancel_cuota,null);
});
test('búsqueda conserva discrepancias de sede y alias, no inventa propuesta',()=>{
 assert.ok(searchKnowledge(kb,{consulta:'psico'}).data.registros.some(r=>r.id==='carrera-psicologia'));
 const result=searchKnowledge(kb,{consulta:'Abogacía',sede:'yerba_buena'}).data.registros;
 assert.ok(result.some(r=>r.id==='carrera-abogacia'&&r.condiciones_de_uso.some(c=>c.includes('Yerba Buena'))));
 assert.equal(searchKnowledge(kb,{consulta:'zzzzzzzzzzzz'}).data.registros.length,0);
});

test('fichas ampliadas recuperan planes por año y distinguen IA de Informática',()=>{
 const result=searchKnowledge(kb,{consulta:'quiero estudiar IA'}).data.registros;
 assert.equal(result[0].id,'carrera-inteligencia-artificial');
 assert.equal(result[0].datos.inicio_publicado,null);
 assert.match(result[0].datos.plan_resumido_por_anio['4'],/redes neuronales/);
 for(const [id,years] of [['inteligencia-artificial',5],['informatica',5],['contador',4],['abogacia',5],['medicina',6],['psicologia',5]]) {
  const r=getRecords(kb,['carrera-'+id]).data.registros[0];
  assert.equal(Object.keys(r.datos.plan_resumido_por_anio).length,years);
  assert.equal(r.datos.ingreso_general_ref,'documentacion-general');
  assert.ok(r.fuentes.some(s=>s.url===r.datos.web_carrera));
  assert.equal(r.datos.arancel_cuota,null);
 }
 const medical=getRecords(kb,['carrera-medicina']).data.registros[0].datos;
 assert.match(medical.ingreso_especifico.costo,/derecho de examen/);
 assert.equal(medical.ingreso_especifico.importe_derecho_examen,null);
 assert.equal(medical.ingreso_especifico.fecha_examen,null);
 assert.equal(getRecords(kb,['carrera-abogacia']).data.registros[0].datos.orientaciones_ultimo_anio.magistratura.includes('constitucional'),true);
});

test('búsqueda tolera categorías del modelo e IDs incorrectos sin perder fuentes relacionadas',()=>{
 for(const args of [
  {consulta:'Italiano A1 horario sede Central',categoria:'curso',sede:'central',periodo:'2026'},
  {consulta:'Italiano A1 horario',categoria:'idiomas',propuesta_id:'italiano_a1'},
  {consulta:'Italiano A1',categoria:'categoria-inexistente'},
 ]) {
  const r=searchKnowledge(kb,args).data.registros;
  assert.ok(r.some(x=>x.id==='curso-italiano-a1'));
  assert.ok(r.some(x=>x.id==='horario-italiano-a1'));
  assert.ok(r.find(x=>x.id==='horario-italiano-a1').condiciones_de_uso.length);
 }
 const english=searchKnowledge(kb,{consulta:'Cuánto cuesta Inglés A1 para público general',categoria:'curso'}).data.registros;
 assert.ok(english.some(x=>x.id==='aranceles-idiomas'));
 assert.equal(searchKnowledge(kb,{consulta:'zzzzzzzzzz',propuesta_id:'inventado'}).data.registros.length,0);
});
test('dirección Central y calendario general conservan contexto y límites de cobertura',()=>{
 assert.equal(searchKnowledge(kb,{consulta:'Dónde queda la sede Central'}).data.registros[0].id,'sede-central');
 const result=searchKnowledge(kb,{consulta:'fecha inicio todas las carreras 2027'}).data.registros;
 assert.ok(result.some(x=>x.id==='calendario-marco'));
 assert.equal(result.filter(x=>x.seccion==='carreras').length,7);
 assert.ok(getRecords(kb,['cal-segundo-cuatrimestre']).data.registros.some(x=>x.id==='calendario-marco'));
});

test('lectura de aranceles conserva unidades, cero y condiciones sin convertir cantidades en precios',()=>{
 const social=getRecords(kb,['curso-social-media']).data.registros.find(r=>r.id==='arancel-social-media');
 assert.deepEqual(social.lectura.importes,[{campo:'importe_pago_unico',valor:130000,texto:'ARS 130.000'}]);
 assert.deepEqual(social.lectura.condiciones,social.condiciones_de_uso);
 const idiomas=getRecords(kb,['aranceles-idiomas']).data.registros[0];
 assert.ok(idiomas.lectura.importes.some(x=>x.valor===90251&&x.texto==='ARS 90.251'));
 assert.ok(idiomas.lectura.importes.some(x=>x.campo==='matricula_publicada'&&x.texto==='ARS 0'));
 assert.ok(!idiomas.lectura.importes.some(x=>x.campo==='cantidad_cuotas'));
 const nutrition=getRecords(kb,['diplomatura-nutricion-deportiva']).data.registros[0];
 assert.match(nutrition.lectura.condiciones.join(' '),/tampoco suma/);
 assert.equal(nutrition.lectura.importes.length,0);
});

test('foco inmediato conserva los últimos dos mensajes sin duplicar el mensaje actual',()=>{
 const history=[{id:'old',role:'user',text:'Inglés',sequence:1},{id:'q',role:'user',text:'Social Media y Nutrición',sequence:2},{id:'a',role:'assistant',text:'Dos propuestas',sequence:3},{id:msg,role:'user',text:'El curso',sequence:4}];
 const r=prepareContext({...input,context_sequence:4,current_message:history[3],messages:history},claim,config,'now');
 assert.deepEqual(JSON.parse(r.prompt_input).ultimo_intercambio.map(m=>m.id),['q','a']);
});

test('aviso genérico tras varias propuestas pide elegir sin autorizar ni seleccionar un curso',()=>{
 const prior={id:'prior',role:'assistant',text:'Social Media Marketing y Nutrición Deportiva tienen fechas publicadas pasadas.',sequence:1};
 const build=text=>prepareContext({...input,context_sequence:2,current_message:{...input.current_message,text,sequence:2},messages:[prior]},claim,config,'now');
 const ambiguous=build('Avisame cuando abra el curso.');
 assert.equal(ambiguous.aviso_aclaracion.length,2);
 assert.match(prepareResponse({output:'Confirmá Inglés A1'},ambiguous).texto,/Social Media.*Nutrición/);
 assert.deepEqual(build('Autorizo el aviso de Inglés A1 en el panel').aviso_aclaracion,[]);
 assert.deepEqual(build('Cuánto cuesta el curso').aviso_aclaracion,[]);
});

test('configuración permite un backend UNSTA dedicado en el VPS y bloquea otros servicios',()=>{
 assert.equal(validateConfig({api_base_url:'https://unsta-api.inmobiliarialyc.com.ar/'}).api_base_url,'https://unsta-api.inmobiliarialyc.com.ar');
 for (const host of ['api','n8n','evoapi']) assert.throws(()=>validateConfig({api_base_url:`https://${host}.inmobiliarialyc.com.ar`}));
});
