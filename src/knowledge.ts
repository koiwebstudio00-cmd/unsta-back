import {
  loadKnowledge,
  catalog,
  getRecords,
  searchKnowledge,
} from "../agent-contract/knowledge.mjs";
import { db, asJson } from "./db.js";
export const knowledge = loadKnowledge();
export const proposals = catalog(knowledge);
export const isProposal = (id: string) =>
  proposals.some((p: { id: string }) => p.id === id);
export { getRecords, searchKnowledge };
export async function importKnowledge() {
  const found = await db.knowledge.findUnique({
    where: { version: knowledge.kb.version },
  });
  if (found && found.hash !== knowledge.hash)
    throw new Error("La misma versión de conocimiento tiene otro hash");
  if (!found)
    await db.knowledge.create({
      data: {
        version: knowledge.kb.version,
        hash: knowledge.hash,
        document: asJson(knowledge.kb),
      },
    });
}
