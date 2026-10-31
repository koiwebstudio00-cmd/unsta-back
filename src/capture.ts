import { normalize } from "./common.js";
import { proposals } from "./knowledge.js";

const words = (value: string) =>
  normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
// Only unique contiguous catalog matches are resolved. "Marketing" is
// ambiguous (degree/course); an unknown proposal remains free text.
export function catalogMatches(
  value: string,
): Array<{ id: string; titulo: string }> {
  const q = words(value);
  if (q.length < 3) return [];
  const exact = proposals.filter(
    (p: { id: string; titulo: string }) =>
      words(p.id) === q || words(p.titulo) === q,
  );
  if (exact.length) return exact;
  return proposals.filter((p: { titulo: string }) =>
    ` ${words(p.titulo)} `.includes(` ${q} `),
  );
}

// Conservative extraction of self-declared contact values. Bare numbers,
// questions, negation, third-party data and conflicting values are left to
// clarification, rather than treating every number/email as personal data.
export function declaredContact(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const clauses = text.split(/(?<=[!?;\n])|(?<=\.)(?=\s|$)/);
  const patterns = {
    telefono:
      /\bmi\s+(?:nuevo\s+)?(?:telefono|celular|whatsapp|numero)(?:\s+(?:ficticio|de prueba|de contacto))*\s*(?:es\s*|:\s*|=\s*)?(\+?\d[\d ()-]{5,30}\d)(?!\d)/gi,
    email:
      /\bmi\s+(?:nuevo\s+)?(?:email|correo|e-mail)(?:\s+(?:ficticio|de prueba|de contacto))*\s*(?:es\s*|:\s*|=\s*)?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi,
  };
  for (const [field, pattern] of Object.entries(patterns)) {
    const values = new Set<string>();
    for (const clause of clauses) {
      const n = normalize(clause);
      if (
        /\b(no|nunca|tampoco|quizas|si|o|ejemplo|ejemplos|dice|dijo|tercero|tercera)\b/.test(
          n,
        ) ||
        /[?¿]/.test(clause)
      )
        continue;
      for (const match of n.matchAll(pattern)) {
        // Use the original spelling/format from the user's message.
        const offset = match.index! + match[0].lastIndexOf(match[1]);
        const value = clause.slice(offset, offset + match[1].length).trim();
        if (
          field === "telefono" &&
          !/^\d{8,15}$/.test(value.replace(/\D/g, ""))
        )
          continue;
        values.add(value);
      }
    }
    if (values.size === 1) result[field] = [...values][0];
  }
  return result;
}

// Auto-capture only an explicit first-person interest in one unambiguous
// catalog proposal per clause. Questions, alternatives and negations stay
// with the conversational tools. Never infer an unknown/free proposal.
export function declaredInterests(text: string): Array<Record<string, string>> {
  const result: Array<Record<string, string>> = [];
  for (const clause of text.split(/(?<=[.!?;\n])|\s+y\s+también\s+/i)) {
    const n = words(clause);
    if (
      /\b(no|nunca|tampoco|quizas|si|o|dice|dijo|ejemplo)\b/.test(n) ||
      /[¿?]/.test(clause)
    )
      continue;
    const match = n.match(
      /\b(?:me interesan?|quiero (?:estudiar|cursar|inscribirme en|anotarme en))\s+(.+)/,
    );
    if (!match) continue;
    const body = ` ${match[1]} `;
    const matches = proposals.filter((p: { id: string; titulo: string }) => {
      const aliases = [
        words(p.titulo),
        words(p.id.replace(/^(carrera|curso|diplomatura)-/, "")),
      ];
      return aliases.some(
        (alias) =>
          body.includes(` ${alias} `) && catalogMatches(alias).length === 1,
      );
    });
    if (matches.length !== 1) continue;
    const data: Record<string, string> = { propuesta_id: matches[0].id };
    if (/\ben yerba buena\b/.test(n)) data.sede = "yerba_buena";
    else if (/\ben (?:sede )?central\b/.test(n)) data.sede = "central";
    result.push(data);
  }
  return result;
}
