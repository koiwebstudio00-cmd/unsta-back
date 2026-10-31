// Read-only audit of the workspace created for browser acceptance. No secrets printed.
import {db,scoped} from '../../src/db.js';
import assert from 'node:assert/strict';
const workspaceId=process.argv[2];
if(!workspaceId)throw new Error('Indicar workspace_id de prueba');
const evidence=await scoped(workspaceId,async tx=>{
 const contacts=await tx.contact.findMany();
 const messages=await tx.message.findMany();
 const notes=await tx.note.findMany();
 const tasks=await tx.task.findMany();
 const events=await tx.openingEvent.findMany();
 assert.ok(contacts.some(c=>(c.fields as any).nombre==='Lucía Demo'));
 assert.ok(messages.some(m=>m.role==='user'));
 assert.ok(messages.some(m=>m.role==='operator'));
 assert.ok(notes.some(n=>!messages.some(m=>m.text===n.text)));
 assert.ok(tasks.some(t=>t.status==='completada'));
 assert.ok(events.some(e=>e.status==='encolado'));
 return {contacts:contacts.length,messages:messages.length,notes:notes.length,tasks:tasks.length,events:events.length,verified:true};
});
console.log(JSON.stringify(evidence));
await db.$disconnect();
