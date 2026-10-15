/* ============================================================
   THE LIVING BREAD MCP, handoffs on the answers that already exist.

   One place adds the structured `handoff` to the answers of the existing
   tools (communities, churches, gatherings, Serve needs, the prayer doors,
   the Bible and plans, begin), so a tool's own code is untouched and the
   rules in src/handoff.ts cannot drift. Called from src/shared.ts after the
   answer has been cleaned, for successful answers only. A tool that already
   returned its own handoff (plan_my_next_step) is left alone.

   Everything added here is built from ids and fixed routes. No text a person
   wrote, and no text from a result, is ever placed in a link.
   ============================================================ */
import {
  beginHandoff, churchFinderHandoff, communitiesIfEmpty, communityHandoff, createCommunityHandoff, gatheringHandoff, handoffLine,
  prayerRequestHandoff, prayerRoomHandoff, readingPlanHandoff, scriptureHandoff, serveHandoff, type Handoff,
} from './handoff';

type S = Record<string, unknown>;
type R = { content?: { type: string; text?: string }[]; structuredContent?: S; isError?: boolean };

const rows = (v: unknown): S[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as S[]) : []);

function addLine(r: R, h: Handoff | null): void {
  const line = handoffLine(h);
  if (!line || !Array.isArray(r.content) || r.content[0]?.type !== 'text') return;
  r.content[0] = { type: 'text', text: `${r.content[0].text ?? ''}\n\n${line}` };
}

/** Add `handoff` (and a handoff on each listed item) to a successful answer of a known tool. Returns the handoff added, if any. */
export function applyHandoffs(name: string, r: R): Handoff | null {
  const s = r.structuredContent;
  if (!s || r.isError || s.handoff) return null;
  let top: Handoff | null = null;
  let line = true;
  switch (name) {
    case 'communities_to_join': {
      const items = rows(s.communities);
      for (const c of items) {
        const h = communityHandoff({ id: String(c.id ?? ''), kind: c.kind as string, join: c.join as string, people: c.people as number, next_gathering: c.next_gathering as string | null, verified: Boolean(c.verified) });
        if (h) c.handoff = h;
      }
      top = (items[0]?.handoff as Handoff | undefined) ?? null;
      if (!items.length) {
        top = createCommunityHandoff();
        if (top) top = { ...top, if_empty: communitiesIfEmpty() };
      }
      break;
    }
    case 'find_churches_near': {
      top = churchFinderHandoff();
      if (top && rows(s.churches).length === 0) top = { ...top, if_empty: { message: 'Living Bread holds no church near that place. That does not mean there is none.', alternatives: communitiesIfEmpty().alternatives.filter((a) => a.kind !== 'church') } };
      break;
    }
    case 'find_gatherings_near':
    case 'gatherings_tonight':
    case 'events_this_week': {
      const items = rows(s.gatherings);
      for (const g of items) {
        const h = gatheringHandoff(String(g.id ?? ''), Boolean(g.online), typeof g.title === 'string' ? g.title : null);
        if (h) g.handoff = h;
      }
      top = (items[0]?.handoff as Handoff | undefined) ?? null;
      if (!items.length) {
        const alt = communitiesIfEmpty();
        const base = createCommunityHandoff();
        top = base ? { ...base, if_empty: { message: 'No gathering is posted there in that window. Online gatherings and communities can be joined from anywhere.', alternatives: alt.alternatives } } : null;
      }
      break;
    }
    case 'needs_near':
    case 'where_can_i_serve_publicly': {
      const items = rows(s.needs);
      for (const n of items) {
        const h = serveHandoff(typeof n.id === 'string' ? n.id : null);
        if (h) n.handoff = h;
      }
      top = (items[0]?.handoff as Handoff | undefined) ?? serveHandoff(null);
      if (top && !items.length) top = { ...top, if_empty: { message: 'No verified open need matches that place right now. That means the network has none there yet, not that nobody is in need.', alternatives: [{ label: top.invitation, kind: top.kind, url: top.url }] } };
      break;
    }
    case 'the_open_chair': {
      top = prayerRequestHandoff(s.open === true);
      break;
    }
    case 'a_person_now':
    case 'real_people_will_pray':
    case 'the_watch_tonight': {
      const fresh = s.freshness as { available_now?: boolean } | undefined;
      top = prayerRoomHandoff(fresh?.available_now === true);
      break;
    }
    case 'reading_plans':
      top = readingPlanHandoff();
      break;
    case 'begin':
      top = beginHandoff();
      break;
    case 'scripture_passage':
    case 'scripture_context':
    case 'verses_for':
    case 'daily_bread':
      /* data only: a Scripture answer is never followed by an invitation in its text */
      top = scriptureHandoff(null);
      line = false;
      break;
    default:
      return null;
  }
  if (!top) return null;
  s.handoff = top;
  if (line) addLine(r, top);
  return top;
}
