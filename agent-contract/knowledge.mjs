// Backend-independent retrieval core. n8n calls the future HTTP adapter; it does
// not load workstation files from the remote instance.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function loadKnowledge(path = new URL('../base-conocimiento/demo-v1/unsta-demo.json', import.meta.url)) {
  const bytes=readFileSync(path);const kb=JSON.parse(bytes);
  const records=new Map(kb.registros.map(r=>[r.id,r]));const sources=new Map(kb.fuentes.map(s=>[s.id,s]));
  if(records.size!==kb.registros.length||sources.size!==kb.fuentes.length)throw new Error('IDs de conocimiento duplicados');
  for(const r of records.values()) {
    for(const id of r.fuentes)if(!sources.has(id))throw new Error(`Fuente desconocida: ${id}`);
    for(const field of ['arancel_ref','horario_ref'])if(r.datos[field]&&!records.has(r.datos[field]))throw new Error(`Referencia desconocida: ${r.id}/${field}`);
  }
  return {kb,records,sources,hash:createHash('sha256').update(bytes).digest('hex')};
}
const normalize = v => String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const aliases = {'psico':'psicologia','compu':'informatica','computacion':'informatica','sove':'orientacion vocacional','cuota':'arancel','precio':'arancel','cuanto':'arancel','costos':'arancel','costo':'arancel','tesoreria':'tesoreria','feriados':'calendario'};
const stop=new Set('el la los las de del un una en por para que quiero saber estudiar sobre me mi tengo es se cuanto cuesta dia con y a al si no soy'.split(' '));
// Give the model a locale-safe rendering of monetary facts, alongside their
// original numeric value and scope. Counts/dates must never become money.
function monetaryReadings(datos) {
  const result=[];
  function visit(value,path=[]) {
    if(value && typeof value==='object') {
      for(const [key,item] of Object.entries(value))visit(item,[...path,key]);
    } else if(typeof value==='number' && /importe|pago_unico|matricula/.test(path.join('.'))) {
      result.push({campo:path.join('.'),valor:value,texto:`${datos.moneda??'ARS'} ${new Intl.NumberFormat('es-AR').format(value)}`});
    }
  }
  if(datos.moneda)visit(datos);
  return result;
}
export function getRecords(store,ids) {
  const collected=new Map();
  function visit(id) {
    if(collected.has(id))return;
    const r=store.records.get(id);if(!r)return;
    collected.set(id,{
      lectura:{titulo:r.titulo,periodo:r.periodo_publicado,condiciones:r.condiciones_de_uso,importes:monetaryReadings(r.datos)},
      ...r,fuentes:r.fuentes.map(id=>store.sources.get(id))
    });
    for(const field of ['arancel_ref','horario_ref'])if(r.datos[field])visit(r.datos[field]);
    if(r.seccion==='calendario' && id!=='calendario-marco')visit('calendario-marco');
  }
  ids.forEach(visit);
  return {ok:true,data:{knowledge_version:store.kb.version,knowledge_hash:store.hash,registros:[...collected.values()]}};
}
export function catalog(store) {
  return store.kb.registros.filter(r=>/^(carrera-|curso-|diplomatura-)/.test(r.id)).map(r=>({id:r.id,titulo:r.titulo,seccion:r.seccion}));
}
export function searchKnowledge(store,{consulta,categoria=undefined,propuesta_id=undefined,sede=undefined,periodo=undefined}) {
  // Read-only retrieval tolerates model spelling, but never invents a record.
  if(propuesta_id && store.records.has(propuesta_id))return getRecords(store,[propuesta_id]);
  const categoryAliases={curso:'cursos',idioma:'cursos',idiomas:'cursos',carrera:'carreras',arancel:'aranceles',precio:'aranceles',horario:'horarios',institucional:'institucion',universidad:'institucion',sede:'institucion',sedes:'institucion',contacto:'contactos',servicio:'servicios'};
  const requested=normalize(categoria).trim();
  const category=categoryAliases[requested]??requested;
  const knownCategory=[...store.records.values()].some(r=>r.seccion===category);
  const query=normalize(consulta);
  const terms=[...new Set(query.split(/[^a-z0-9]+/).filter(t=>t&&!stop.has(t)).flatMap(t=>(aliases[t]??t).split(' ')))];
  const ranked=store.kb.registros.map(r=>{
    const title=normalize(r.titulo+' '+r.id);const full=normalize(JSON.stringify(r.datos));
    let score=terms.reduce((n,t)=>n+(title.includes(t)?5:full.includes(t)?1:0),0);
    // Filters express preference, not exclusion: retain linked facts and caveats.
    if(score&&knownCategory&&r.seccion===category)score+=3;
    if(score&&sede&&r.sedes_en_demo.includes(sede))score+=1;
    if(score&&periodo&&normalize(r.periodo_publicado).includes(normalize(periodo)))score+=1;
    if(/\b(direccion|donde|ubicacion|queda|domicilio)\b/.test(query) && r.seccion==='institucion') {
      if((r.id==='sede-central'&&query.includes('central')) ||
         (r.id==='sede-yerba-buena'&&query.includes('yerba buena')))score+=25;
    }
    return {r,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.r.id.localeCompare(b.r.id));
  const ids=ranked.slice(0,5).map(x=>x.r.id);
  // A broad start-date question must include the scope of the calendar and all
  // career records, including those with no published start date.
  if(/\b(carreras|todas)\b/.test(query) && /\b(inicio|empiezan|comienzan|comienzo|calendario)\b/.test(query)) {
    ids.unshift('calendario-marco',...catalog(store).filter(r=>r.seccion==='carreras').map(r=>r.id));
  }
  return {...getRecords(store,ids),busqueda:{
    categoria_normalizada:knownCategory?category:null,
    identificador_no_encontrado:propuesta_id&&!store.records.has(propuesta_id)?propuesta_id:null,
    alcance:'Coincidencia temática; sede y período orientan el orden, no acreditan vigencia. Revisar condiciones de cada registro.'
  }};
}
