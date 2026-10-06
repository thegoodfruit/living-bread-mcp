/* ============================================================
   THE LIVING BREAD MCP, the doors.

   Every link an assistant hands a person is listed here, and every one has
   been checked to resolve on the live web host. A label is a promise, so a
   door that does not open is never named. The store identifiers are the
   same ones lib/rateApp.ts uses (tests/mcp.test.ts holds them equal).
   ============================================================ */

export const SITE = 'https://living-bread.org';
export const KNOWLEDGE_API = 'https://discover.living-bread.org';
export const MCP_URL = 'https://mcp.living-bread.org/mcp';
export const SSE_URL = 'https://mcp.living-bread.org/sse';

export const APPLE_ID = '6780415830';
export const ANDROID_PKG = 'com.livingbread.app';

export const DOORS = {
  home: SITE,
  /** The composer: pray for someone in your own voice, or in writing, by name. */
  prayVoice: `${SITE}/pray/voice`,
  /** Believers from many nations praying out loud over the whole family. */
  kingdomPraying: `${SITE}/kingdom-praying`,
  findAChurch: `${SITE}/find-a-church`,
  events: `${SITE}/events`,
  communities: `${SITE}/communities`,
  prayer: `${SITE}/prayer`,
  daily: `${SITE}/daily`,
  bible: `${SITE}/bible`,
  whoIsJesus: `${SITE}/who-is-jesus`,
  getTheApp: `${SITE}/get-the-app`,
  appStore: `https://apps.apple.com/app/id${APPLE_ID}`,
  playStore: `https://play.google.com/store/apps/details?id=${ANDROID_PKG}`,
  support: `${SITE}/support`,
  privacy: `${SITE}/privacy`,
  /* The doors the signed-in acts and the wider read tools hand back. Each one answered 200 on the
     live web host when it was added here (static routes); a route with an id in it is the same
     screen the app opens from a notification, and the web shell for it ships with the web build. */
  today: `${SITE}/today`,
  prayersForMe: `${SITE}/prayers-for-me`,
  carrying: `${SITE}/carrying`,
  myYes: `${SITE}/my-yes`,
  yesFamily: `${SITE}/yes/family`,
  tables: `${SITE}/tables`,
  theTable: `${SITE}/the-table`,
  serve: `${SITE}/serve`,
  worship: `${SITE}/worship`,
  worshipTogether: `${SITE}/worship-together`,
  gospel: `${SITE}/the-gospel`,
  jesus: `${SITE}/jesus`,
  comeAndSee: `${SITE}/come-and-see`,
  followJesus: `${SITE}/follow-jesus`,
  shepherdCare: `${SITE}/shepherd/care`,
  pastors: `${SITE}/pastors`,
  /* Prayer in Place, around me. (/prayer-place alone answered 404 on the web host on 2026-10-06; only /prayer-place/<cell> exists.) */
  prayerPlace: `${SITE}/place-prayers`,
} as const;

/** The honest state of recording, in one sentence. Version 1.3.7 is the first store build that carries the recorder. */
export const RECORDING_TRUTH =
  'Recording a prayer in your own voice works on the web now, and in the app from version 1.3.7. On an older app build the same page offers a written prayer instead, and says why.';

export const INVITATION =
  'Meet Christ. Meet your family in Christ. The Living Bread is free, with no ads: a verse each morning, the whole Bible, prayer with real people who pray for you by name, a church near you, and ways to serve.';

/** What a newcomer meets first, stated as the app actually behaves. */
export const FIRST_STEPS: readonly string[] = [
  'A welcome, and John 3:16 spoken over them by their own name.',
  'The Daily Bread: the one verse the whole family receives that morning.',
  'A first small act: a prayer they can offer for someone, or a request they can bring.',
  'A companion for the first days, and real believers who pray for them by name.',
  'A church and gatherings near them, and communities they can join.',
];
