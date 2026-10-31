#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {buildArtifacts} from './build-n8n.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function verifyWorkflows() {
  let count=0;
  for(const [path,expected] of buildArtifacts()) {
    const actual=readFileSync(root+path,'utf8');
    assert.equal(actual,expected,`${path} quedó desactualizado: npm run workflows:build`);
    if(path.endsWith('manifest.json'))continue;
    const w=JSON.parse(actual);count++;
    assert.equal(w.active,false);
    assert.equal(w.id,undefined,'No debe transportar IDs de la instancia');
    assert.deepEqual(w.pinData,{});
    const names=new Set(w.nodes.map(n=>n.name));
    assert.equal(names.size,w.nodes.length,'Nombres duplicados');
    assert.equal(new Set(w.nodes.map(n=>n.id)).size,w.nodes.length);
    for(const n of w.nodes) {
      assert.equal(n.credentials,undefined,'Credenciales deben asignarse al importar');
      if(n.type.endsWith('.code'))new Script(`(function(){${n.parameters.jsCode}\n})`);
      if(n.type.endsWith('.webhook'))assert.equal(n.parameters.authentication,'headerAuth');
      if(/\.httpRequest(?:Tool)?$/.test(n.type)) {
        assert.equal(n.parameters.genericAuthType,'httpHeaderAuth');
        assert.ok(n.parameters.url.includes("$('Configuracion UNSTA')"));
        assert.ok(n.parameters.options.timeout>0);
        if(n.parameters.url.includes("'/v1/agent/turns/'")&&!n.name.includes('reclamar'))assert.equal(n.parameters.headerParameters.parameters[0].name,'X-UNSTA-Attempt-Token');
      }
      for(const match of JSON.stringify(n.parameters).matchAll(/\$\('([^']+)'\)/g))assert.ok(names.has(match[1]),`Referencia inexistente ${match[1]}`);
    }
    for(const [source,kinds] of Object.entries(w.connections)) {
      assert.ok(names.has(source));
      for(const [kind,outputs] of Object.entries(kinds))for(const output of outputs)for(const edge of output) {
        assert.ok(names.has(edge.node));assert.equal(edge.type,kind);
      }
    }
    if(path.includes('conversacion')) {
      const agent=w.nodes.find(n=>n.name==='Agente UNSTA');
      assert.equal(agent.parameters.options.maxIterations,6);
      const toolNames=w.nodes.filter(n=>n.type.endsWith('.httpRequestTool')).map(n=>n.name);
      assert.equal(toolNames.length,6);
      for(const n of toolNames)assert.equal(w.connections[n].ai_tool[0][0].node,agent.name);
      assert.equal(w.connections.preparar_respuesta.main[0][0].node,'finalizar_turno');
      assert.equal(w.connections.finalizar_turno.main[0][0].node,'resumen_necesario');
      assert.equal(w.nodes.find(n=>n.name==='Resumir conversacion').onError,'continueRegularOutput');
    }
  }
  return count;
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(`${verifyWorkflows()} workflows verificados: generación reproducible, referencias, conexiones y controles estructurales.`);
