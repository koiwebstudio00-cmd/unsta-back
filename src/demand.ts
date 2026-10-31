import { z } from "zod";
import { scoped, type Tx } from "./db.js";
import type { Actor } from "./auth.js";
import { proposals, isProposal } from "./knowledge.js";
import { fail } from "./common.js";

export const demandFilters = z.object({
  days: z.enum(["all", "7", "30", "90"]).default("all"),
  sede: z.enum(["all", "central", "yerba_buena"]).default("all"),
  kind: z.enum(["all", "carreras", "cursos"]).default("all"),
});
export const demandDetailFilters = demandFilters.extend({
  proposal_id: z.string().min(1).max(100),
  pending: z.enum(["true", "false"]).default("false"),
});
type Filters = z.infer<typeof demandFilters>;
const pendingStages = new Set(["nuevo", "seguimiento"]);

async function matching(tx: Tx, filters: Filters, now: Date) {
  const since =
    filters.days === "all"
      ? undefined
      : new Date(now.getTime() - Number(filters.days) * 86400000);
  const interests = await tx.interest.findMany({
    where: since ? { createdAt: { gte: since, lte: now } } : {},
    select: { contactId: true, data: true },
  });
  const contacts = await tx.contact.findMany({
    select: { id: true, pipelineStage: true },
  });
  const stages = new Map(contacts.map((c) => [c.id, c.pipelineStage]));
  const catalog = new Map<
    string,
    { id: string; titulo: string; seccion: string }
  >(proposals.map((p: any) => [p.id, p]));
  const unknown = new Set<string>();
  const matched = interests.flatMap((i) => {
    const data = i.data as { propuesta_id?: string; sede?: string };
    if (
      !stages.has(i.contactId) ||
      (filters.sede !== "all" && data.sede !== filters.sede)
    )
      return [];
    const proposal = data.propuesta_id
      ? catalog.get(data.propuesta_id)
      : undefined;
    if (!proposal) {
      if (filters.kind === "all") unknown.add(i.contactId);
      return [];
    }
    if (filters.kind !== "all" && proposal.seccion !== filters.kind) return [];
    return [
      {
        contactId: i.contactId,
        proposal,
        pending: pendingStages.has(stages.get(i.contactId)!),
      },
    ];
  });
  return { matched, unknown };
}
export const getDemand = (actor: Actor, filters: Filters, now = new Date()) =>
  scoped(actor.workspaceId, async (tx) => {
    const { matched, unknown } = await matching(tx, filters, now);
    const grouped = new Map<
      string,
      {
        proposalId: string;
        title: string;
        kind: string;
        people: Set<string>;
        pending: Set<string>;
      }
    >();
    for (const row of matched) {
      const p = row.proposal;
      const group = grouped.get(p.id) ?? {
        proposalId: p.id,
        title: p.titulo,
        kind: p.seccion,
        people: new Set<string>(),
        pending: new Set<string>(),
      };
      group.people.add(row.contactId);
      if (row.pending) group.pending.add(row.contactId);
      grouped.set(p.id, group);
    }
    const rows = [...grouped.values()].map((g) => ({
      proposalId: g.proposalId,
      title: g.title,
      kind: g.kind,
      interested: g.people.size,
      pending: g.pending.size,
    }));
    rows.sort(
      (a, b) =>
        b.interested - a.interested ||
        b.pending - a.pending ||
        a.title.localeCompare(b.title, "es"),
    );
    return {
      filters,
      generatedAt: now.toISOString(),
      people: new Set(matched.map((r) => r.contactId)).size,
      unmappedPeople: unknown.size,
      rows,
    };
  });
export const getDemandContacts = (
  actor: Actor,
  filters: z.infer<typeof demandDetailFilters>,
  now = new Date(),
) =>
  scoped(actor.workspaceId, async (tx) => {
    if (!isProposal(filters.proposal_id))
      fail(400, "PROPOSAL", "Propuesta fuera del catálogo");
    const { matched } = await matching(tx, filters, now);
    const ids = [
      ...new Set(
        matched
          .filter(
            (r) =>
              r.proposal.id === filters.proposal_id &&
              (filters.pending !== "true" || r.pending),
          )
          .map((r) => r.contactId),
      ),
    ];
    // The drill-down uses the same selection as the ranking, without the
    // directory's 200-contact cap, so its count and the ranking agree.
    return {
      contacts: await tx.contact.findMany({
        where: { id: { in: ids } },
        orderBy: { updatedAt: "desc" },
      }),
      interests: await tx.interest.findMany({
        where: { contactId: { in: ids } },
      }),
      conversations: await tx.conversation.findMany({
        where: { contactId: { in: ids } },
        orderBy: { updatedAt: "desc" },
      }),
    };
  });
