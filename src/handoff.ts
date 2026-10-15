/* ============================================================
   THE LIVING BREAD MCP, the handoff: from an answer to the exact door.

   An assistant that finds a real community, a prayer door or a way to serve
   should be able to hand the person to THAT place, not to the home page, and
   say honestly what is there. Every relevant tool answer therefore carries a
   structured `handoff`, built here by ONE helper so the rules cannot drift:

     kind, id        the destination and its stable id (a community uuid, a
                     gathering id, a door name); never a person
     intent          one of five ids: find_family, share_prayer, open_word,
                     put_faith_into_action, bring_your_people
     invitation      one plain line worded from the real destination
                     ("Explore this prayer group on The Living Bread")
     what_you_can_do what is actually there, in one sentence
     url             a verified https address on living-bread.org. It carries
                     only fixed, non-sensitive parameters: src (the AI
                     surface, from the MCP client name when it announced one,
                     else "mcp"), utm_source, utm_medium, utm_campaign and
                     intent. NEVER any text the person wrote, a name, a place
                     they typed, or a prayer. The link works with analytics
                     off: every parameter is optional to the page.
     app_link        the livingbread:// address, for a phone that has the app
     fallback        where to go when the app is not installed (the page in a
                     browser, and the store door)
     requires_account whether the page can be read before signing up
     verified        "verified" | "on_record": whether Living Bread has
                     confirmed the thing is active; "on_record" never means
                     "meeting today"
     if_empty        present when nothing suitable exists: an honest sentence
                     and the alternatives (online options, start one)

   The per-call ?lbr= trace code is added after this, to every living-bread.org
   link, by src/telemetry.ts. Nothing here reads a prayer or a message.
   ============================================================ */
import { callStore } from './evidence';
import { DOORS, SITE } from './doors';

export const HANDOFF_INTENTS = ['find_family', 'share_prayer', 'open_word', 'put_faith_into_action', 'bring_your_people'] as const;
export type HandoffIntent = (typeof HANDOFF_INTENTS)[number];

export const HANDOFF_KINDS = [
  'community', 'church', 'gathering', 'prayer_request', 'prayer_room', 'scripture', 'reading_plan', 'serve_need', 'serve_network',
  'create_community', 'church_kit', 'begin', 'universities',
] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];

export interface HandoffEmpty {
  message: string;
  alternatives: { label: string; kind: HandoffKind; url: string }[];
}

export interface Handoff {
  kind: HandoffKind;
  id: string;
  intent: HandoffIntent;
  invitation: string;
  what_you_can_do: string;
  url: string;
  app_link: string | null;
  fallback: string;
  requires_account: boolean;
  verified: 'verified' | 'on_record';
  if_empty?: HandoffEmpty;
}

/** The AI surfaces a link may name, from the client name announced in initialize and nothing else. Anything else, and
 *  our own probes and evals, is "mcp". The order mirrors normalizeClient in src/telemetry.ts (a test holds them equal);
 *  it is repeated here, small, so this module stays free of the telemetry import cycle. */
export function srcFor(clientName: string | null | undefined): string {
  const raw = String(clientName ?? '').trim();
  const n = raw.toLowerCase();
  if (!n) return 'mcp';
  if (/^living-bread-(?!web$|ios$|android$).+|^(demo|x|test|probe|eval|smoke)$|.*[-_. ](probe|eval|test|tests|smoke)([-_. ].*)?$/i.test(raw)) return 'mcp';
  if (/openai|chatgpt/.test(n)) return 'chatgpt';
  if (/claude[-_ ]?code/.test(n)) return 'claude_code';
  if (/claude|anthropic/.test(n)) return 'claude';
  if (/gemini|google/.test(n)) return 'gemini';
  if (/cursor/.test(n)) return 'cursor';
  if (/visual studio code|vscode|vs code/.test(n)) return 'vscode';
  if (/windsurf|codeium/.test(n)) return 'windsurf';
  if (/glama/.test(n)) return 'glama';
  return 'mcp';
}

/** The client of the call in progress, when the server noted it (src/shared.ts sets it). */
export function currentSrc(): string {
  return srcFor(callStore.getStore()?.client ?? null);
}

/** A path made only of letters, digits and / _ . ~ - % : (an id or a fixed route), starting with one slash. */
const SAFE_PATH = /^\/[A-Za-z0-9/_.~%:-]{0,200}$/;
/** An id a handoff may carry: an identifier, never prose. */
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/~-]{0,159}$/;

export function safeSegment(id: string): string | null {
  return SAFE_ID.test(id) && !id.includes('..') ? id.split('/').map(encodeURIComponent).join('/') : null;
}

/** A living-bread.org address with the fixed attribution parameters and no free text. Null when the path is not plain. */
export function buildUrl(path: string, intent: HandoffIntent, src: string = currentSrc(), extra: Record<string, string> = {}): string | null {
  if (!SAFE_PATH.test(path) || path.startsWith('//') || path.includes('..')) return null;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) {
    if (/^[a-z_]{1,20}$/.test(k) && /^[A-Za-z0-9_.-]{1,40}$/.test(v)) q.set(k, v);
  }
  q.set('src', src);
  q.set('utm_source', src);
  q.set('utm_medium', 'ai_assistant');
  q.set('utm_campaign', `ai_${intent}`);
  q.set('intent', intent);
  return `${SITE}${path}?${q.toString()}`;
}

/** The livingbread:// address of the same screen. Never carries parameters. */
export function appLink(path: string): string | null {
  return SAFE_PATH.test(path) && !path.startsWith('//') && !path.includes('..') ? `livingbread://${path.slice(1)}` : null;
}

interface Spec {
  kind: HandoffKind;
  id: string;
  intent: HandoffIntent;
  invitation: string;
  what_you_can_do: string;
  /** The in-app and web route, e.g. "/community/<id>". */
  path: string;
  requires_account: boolean;
  verified?: boolean;
  /** Extra fixed parameters (for a page that reads them), e.g. { via: 'assistant' }. */
  extra?: Record<string, string>;
  if_empty?: HandoffEmpty;
  src?: string;
  /** Where to go with no app: defaults to the same page in a browser plus the store door. */
  fallback?: string;
}

/** Build one handoff, or null when the id or path is not plain (a handoff is never worth an unsafe link). */
export function makeHandoff(s: Spec): Handoff | null {
  const src = s.src ?? currentSrc();
  const url = buildUrl(s.path, s.intent, src, s.extra);
  if (!url || !SAFE_ID.test(s.id) || s.id.includes('..')) return null;
  return {
    kind: s.kind,
    id: s.id,
    intent: s.intent,
    invitation: s.invitation,
    what_you_can_do: s.what_you_can_do,
    url,
    app_link: appLink(s.path),
    fallback: s.fallback ?? (buildUrl('/get-the-app', s.intent, src) as string),
    requires_account: s.requires_account,
    verified: s.verified ? 'verified' : 'on_record',
    ...(s.if_empty ? { if_empty: s.if_empty } : {}),
  };
}

/* ---- the destinations, worded from what is actually there --------------------------------------- */

const KIND_WORDS: Record<string, { noun: string; verb: string }> = {
  prayer: { noun: 'prayer group', verb: 'Explore this prayer group' },
  study: { noun: 'study group', verb: 'Explore this study group' },
  bible: { noun: 'Bible study group', verb: 'Explore this Bible study group' },
};

export interface CommunityLike {
  id: string;
  name?: string;
  kind?: string | null;
  join?: string;
  people?: number;
  next_gathering?: string | null;
  verified?: boolean;
}

/** One community on Living Bread. The page is public to read; joining asks the person to Begin, then returns them here. */
export function communityHandoff(c: CommunityLike): Handoff | null {
  const w = KIND_WORDS[String(c.kind ?? '').toLowerCase()] ?? { noun: 'community', verb: 'Explore this community' };
  const open = c.join?.startsWith('open');
  return makeHandoff({
    kind: 'community', id: c.id, intent: 'find_family', path: `/community/${encodeURIComponent(c.id)}`,
    invitation: `${w.verb} on The Living Bread`,
    what_you_can_do: `Read about this ${w.noun} before signing up${open ? ', then join it (free)' : ', then ask its leaders to let you in (free)'}.${c.next_gathering ? ' Its next posted gathering is listed on the page.' : ''}`,
    requires_account: false,
    verified: Boolean(c.verified),
  });
}

export const START_ONE: { label: string; kind: HandoffKind; url: string } = { label: 'Start a community of your own', kind: 'create_community', url: `${SITE}/communities/new` };

/** The honest answer when no community matches, with the online options and the choice to start one. */
export function communitiesIfEmpty(): HandoffEmpty {
  return {
    message: 'Living Bread holds no community that matches this yet. That is the truth, not a failure: you can still pray with the family online, find a church, or start a community and invite people.',
    alternatives: [
      { label: 'Ask the family to pray for you, online, no account', kind: 'prayer_request', url: buildUrl('/open-chair', 'share_prayer', undefined, { via: 'assistant' }) ?? `${SITE}/open-chair` },
      { label: 'Find a church near you', kind: 'church', url: buildUrl('/find-a-church', 'find_family') ?? DOORS.findAChurch },
      { label: START_ONE.label, kind: START_ONE.kind, url: buildUrl('/communities/new', 'bring_your_people') ?? START_ONE.url },
    ],
  };
}

export function createCommunityHandoff(): Handoff | null {
  return makeHandoff({
    kind: 'create_community', id: 'create_community', intent: 'bring_your_people', path: '/communities/new',
    invitation: 'Create a space for your church or friends on The Living Bread',
    what_you_can_do: 'Give a group a name and a purpose, choose whether anyone may join or people ask first, and get a link to invite people. Free; you begin an account first and are returned here.',
    requires_account: true,
  });
}

export function churchKitHandoff(): Handoff | null {
  return makeHandoff({
    kind: 'church_kit', id: 'church_kit', intent: 'bring_your_people', path: '/church-kit',
    invitation: 'See the Church Kit for pastors and leaders',
    what_you_can_do: 'See how a church or group can bring its people together on Living Bread: an invitation to share, a simple setup, prayer and gatherings. Nothing is created until you begin.',
    requires_account: false,
  });
}

export function pastorsHandoff(): Handoff | null {
  return makeHandoff({
    kind: 'church_kit', id: 'pastors', intent: 'bring_your_people', path: '/pastors',
    invitation: 'See Living Bread for pastors',
    what_you_can_do: 'Read how pastors use Living Bread to be reachable, pray with people and gather a congregation. Nothing is created until you begin.',
    requires_account: false,
  });
}

export function prayerRequestHandoff(open: boolean): Handoff | null {
  return makeHandoff({
    kind: 'prayer_request', id: 'open_chair', intent: 'share_prayer', path: '/open-chair', extra: { via: 'assistant' },
    invitation: 'Ask the family on The Living Bread to pray for you',
    what_you_can_do: 'Write your own words on that page, choose whether your name is kept from the believers, and see truthfully whether anyone has taken the chair. No account is needed. Prayer is a gift, not a promise about what will happen.',
    requires_account: false,
    verified: false,
    ...(open ? {} : { if_empty: { message: 'The Open Chair is not open just now, and nothing was sent.', alternatives: [{ label: 'The prayer page', kind: 'prayer_room' as HandoffKind, url: buildUrl('/prayer', 'share_prayer') ?? DOORS.prayer }] } }),
  });
}

export function prayerRoomHandoff(verifiedLive: boolean): Handoff | null {
  return makeHandoff({
    kind: 'prayer_room', id: 'prayer_watch', intent: 'share_prayer', path: '/prayer',
    invitation: 'Pray with the family on The Living Bread',
    what_you_can_do: verifiedLive ? 'Believers are keeping the prayer watch right now; the page shows where a person answers.' : 'See where believers pray by name and when the watch is kept. It is a door, not a promise that someone is there this minute.',
    requires_account: false,
    verified: verifiedLive,
  });
}

export function scriptureHandoff(reference: string | null): Handoff | null {
  return makeHandoff({
    kind: 'scripture', id: 'bible', intent: 'open_word', path: '/bible',
    invitation: reference ? `Keep reading ${reference.replace(/[^A-Za-z0-9 :.,;-]/g, '').slice(0, 60)} in The Living Bread Bible` : 'Open the Bible on The Living Bread',
    what_you_can_do: 'Read the whole Bible in the app and on the web, choose a translation, and, when you want, read it together with someone.',
    requires_account: false,
  });
}

export function readingPlanHandoff(): Handoff | null {
  return makeHandoff({
    kind: 'reading_plan', id: 'plans', intent: 'open_word', path: '/plans',
    invitation: 'Open a reading plan on The Living Bread',
    what_you_can_do: 'Choose a plan, read one day at a time, and, if you like, read it with a friend or a group.',
    requires_account: false,
  });
}

export function gatheringHandoff(id: string, online: boolean, title: string | null): Handoff | null {
  return makeHandoff({
    kind: 'gathering', id, intent: 'find_family', path: `/gathering/${encodeURIComponent(id)}`,
    invitation: online ? 'See this online gathering on The Living Bread' : 'See this gathering on The Living Bread',
    what_you_can_do: `Read what ${title ? 'this gathering' : 'it'} is, when its host posted it and how to let them know you are coming. The time is what the host posted; it is not a confirmation that it is happening.`,
    requires_account: false,
  });
}

export function serveHandoff(id: string | null): Handoff | null {
  if (id && SAFE_ID.test(id)) {
    return makeHandoff({
      kind: 'serve_need', id, intent: 'put_faith_into_action', path: `/serve/${encodeURIComponent(id)}`,
      invitation: 'See how to support this ministry need on The Living Bread',
      what_you_can_do: 'Read what is needed, who posted it and how it can be met (in person, remotely or by funding) before you commit to anything.',
      requires_account: true,
      verified: true,
    });
  }
  return makeHandoff({
    kind: 'serve_network', id: 'serve', intent: 'put_faith_into_action', path: '/serve',
    invitation: 'See open needs from verified ministries on The Living Bread',
    what_you_can_do: 'Browse needs posted by verified partner ministries and choose one you can meet.',
    requires_account: false,
  });
}

export function beginHandoff(): Handoff | null {
  return makeHandoff({
    kind: 'begin', id: 'begin', intent: 'find_family', path: '/get-the-app',
    invitation: 'Begin on The Living Bread, free',
    what_you_can_do: 'Get the app or open it in a browser. It is free, with no ads.',
    requires_account: false,
  });
}

/** One line for the text of an answer, so a client that shows only text still gets the door. */
export function handoffLine(h: Handoff | null): string | null {
  return h ? `Next step, only if it fits what they asked: ${h.invitation}: ${h.url}` : null;
}

/** The fixed audit shape recorded when a handoff is shown: type and id only, never any text. */
export function handoffAudit(h: Handoff): { kind: HandoffKind; id: string; intent: HandoffIntent; verified: string } {
  return { kind: h.kind, id: h.id, intent: h.intent, verified: h.verified };
}

export function churchFinderHandoff(): Handoff | null {
  return makeHandoff({
    kind: 'church', id: 'find_a_church', intent: 'find_family', path: '/find-a-church',
    invitation: 'See these churches on The Living Bread map',
    what_you_can_do: 'Open the church finder to see churches on a map, read about each, and find the gatherings near you. Churches here are listed from public directories; a listing is not a confirmation of service times or of who is welcome.',
    requires_account: false,
  });
}

/** What the arrival funnel may record about a handoff that was shown: type and id only, never any text. */
export interface HandoffShown { kind: string; dest_id: string; intent: string; verified: string; empty: boolean }

/** The handoffs an answer carried (the top one and up to three experiences), reduced to the audit shape. Pure. */
export function handoffsShown(structured: Record<string, unknown> | undefined | null): HandoffShown[] {
  if (!structured) return [];
  const out: HandoffShown[] = [];
  const take = (h: unknown) => {
    if (!h || typeof h !== 'object') return;
    const x = h as Partial<Handoff>;
    if (typeof x.kind !== 'string' || typeof x.id !== 'string' || typeof x.intent !== 'string') return;
    if (!SAFE_ID.test(x.id)) return;
    if (out.some((o) => o.kind === x.kind && o.dest_id === x.id)) return;
    out.push({ kind: x.kind, dest_id: x.id, intent: x.intent, verified: x.verified === 'verified' ? 'verified' : 'on_record', empty: Boolean(x.if_empty) });
  };
  take(structured.handoff);
  const ex = structured.experiences;
  if (Array.isArray(ex)) for (const e of ex.slice(0, 3)) take((e as { handoff?: unknown } | null)?.handoff);
  return out.slice(0, 4);
}
