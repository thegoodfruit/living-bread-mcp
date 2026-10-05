/* ============================================================
   THE LIVING BREAD MCP, visible answers (MCP Apps / OpenAI Apps SDK).

   Three small cards a client that renders MCP UI (ChatGPT today) can show
   under a tool's answer: a church card, a verse card, a prayer card. They
   are plain HTML served as MCP resources with the MCP Apps MIME type, and
   attached to tools through tool _meta. Every other client ignores _meta
   and keeps the text and structuredContent, which stay the real answer.

   Metadata keys used (developers.openai.com/apps-sdk/reference, read
   2026-10-04):
     tool:     _meta["openai/outputTemplate"] (ChatGPT's alias for _meta.ui.resourceUri),
               _meta.ui.resourceUri, _meta["openai/widgetAccessible"],
               _meta["openai/toolInvocation/invoking"], _meta["openai/toolInvocation/invoked"]
     resource: mimeType "text/html;profile=mcp-app" (the reference's MIME type; the older
               "text/html+skybridge" is not in the current reference), _meta.ui.csp
               {connectDomains, resourceDomains}, _meta["openai/widgetCSP"] {connect_domains,
               resource_domains, redirect_domains}, _meta["openai/widgetDescription"],
               _meta["openai/widgetPrefersBorder"], _meta.ui.prefersBorder
     widget:   window.openai.toolOutput (the tool's structuredContent) and the MCP Apps
               "ui/notifications/tool-result" message, both handled.
   The CSP names our own host only. No static map image is ever drawn: a
   place is text, and the live map is a link.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DOORS, SITE } from './doors';

export const WIDGET_MIME = 'text/html;profile=mcp-app';
const OWN_HOSTS = [SITE, 'https://mcp.living-bread.org'];

export type WidgetName = 'church-card' | 'verse-card' | 'prayer-card';
export const widgetUri = (name: WidgetName) => `ui://living-bread/${name}.html`;

/** What a tool declares so a rendering client shows the card. Harmless to every other client. */
export function widgetMeta(name: WidgetName, invoking: string, invoked: string): Record<string, unknown> {
  const uri = widgetUri(name);
  return {
    ui: { resourceUri: uri },
    'openai/outputTemplate': uri,
    'openai/widgetAccessible': false,
    'openai/toolInvocation/invoking': invoking.slice(0, 64),
    'openai/toolInvocation/invoked': invoked.slice(0, 64),
  };
}

const CSS = `
:root{--paper:#f7f4ec;--ink:#12222e;--muted:#5a6b78;--gold:#b8892f;--aqua:#0d7a72;--line:#e7e0d2}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:14px}
@media (prefers-color-scheme:dark){:root{--paper:#12222e;--ink:#eaf6f4;--muted:#b9c7cf;--line:#2a3b48}}
.eyebrow{color:var(--gold);font:700 11px/1 sans-serif;letter-spacing:.14em;text-transform:uppercase;margin:0 0 6px}
h1{font:600 20px/1.25 Georgia,'Times New Roman',serif;margin:0 0 8px}
.card{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:8px 0;background:rgba(255,255,255,.35)}
@media (prefers-color-scheme:dark){.card{background:rgba(255,255,255,.04)}}
.muted{color:var(--muted);font-size:13.5px}
.verse{font:italic 17px/1.5 Georgia,serif;margin:6px 0}
.ref{font-weight:600}
a.btn{display:inline-block;margin:8px 8px 0 0;background:var(--aqua);color:#fff;text-decoration:none;padding:8px 13px;border-radius:999px;font-weight:600;font-size:13.5px}
a.gold{background:var(--gold)}
.foot{margin-top:12px;color:var(--muted);font-size:12.5px}
`;

/* The same tiny runtime in every card: read structuredContent from window.openai.toolOutput
   (ChatGPT) or from the MCP Apps tool-result message, render, and open links through the host. */
const RUNTIME = `
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function openExt(e){var a=e.currentTarget;if(window.openai&&window.openai.openExternal){e.preventDefault();window.openai.openExternal({href:a.href});}}
function wire(){document.querySelectorAll('a').forEach(function(a){a.target='_blank';a.rel='noopener';a.addEventListener('click',openExt)});if(window.openai&&window.openai.notifyIntrinsicHeight){window.openai.notifyIntrinsicHeight(document.body.scrollHeight+8)}}
function boot(){var o=window.openai&&window.openai.toolOutput;if(o){render(o);wire();}}
window.addEventListener('message',function(e){var m=e.data;if(!m||typeof m!=='object')return;if(m.method==='ui/notifications/tool-result'){var p=m.params||{};var sc=p.structuredContent||(p.result&&p.result.structuredContent);if(sc){render(sc);wire();}}});
window.addEventListener('openai:set_globals',boot);
document.addEventListener('DOMContentLoaded',boot);boot();
`;

function doc(title: string, body: string, render: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style></head><body>${body}<script>${render}${RUNTIME}</script></body></html>`;
}

const CHURCH_CARD = doc('Churches near you', '<p class="eyebrow">The Living Bread</p><h1 id="h">Churches near you</h1><div id="list"></div><p class="foot">City level by design. The live map and finder open on living-bread.org.</p>', `
function render(d){
  var rows=(d&&d.churches)||[];var h=document.getElementById('h');var list=document.getElementById('list');
  if(d&&d.name&&!rows.length){rows=[{name:d.name,where:[d.country].filter(Boolean).join(', '),denomination:d.denomination||null,url:d.url||null,on_living_bread:false}]}
  h.textContent=rows.length?(rows.length===1?'A church near '+(d.searched||'you'):rows.length+' churches near '+(d.searched||'you')):'No church held near '+(d.searched||'there')+' yet';
  list.innerHTML=rows.slice(0,8).map(function(c){return '<div class="card"><strong>'+esc(c.name)+'</strong>'+(c.on_living_bread?' <span class="muted">on Living Bread</span>':'')+'<div class="muted">'+esc(c.where||'')+(c.distance_km!=null?' \\u00b7 about '+Math.round(c.distance_km)+' km':'')+(c.denomination?' \\u00b7 '+esc(c.denomination):'')+'</div>'+(c.url?'<a class="btn" href="'+esc(c.url)+'">Open data</a>':'')+'</div>'}).join('')
    +(rows.length?'':'<div class="card muted">'+esc(d.honest||'')+'</div>')
    +'<a class="btn gold" href="${DOORS.findAChurch}">Live map and finder</a><a class="btn" href="${DOORS.events}">Gatherings this week</a>';
}`);

const VERSE_CARD = doc('A verse', '<p class="eyebrow" id="eye">Scripture</p><h1 id="h"></h1><div id="list"></div><p class="foot">King James Version, read from the text the app ships. The Living Bread, living-bread.org.</p>', `
function render(d){
  var eye=document.getElementById('eye'),h=document.getElementById('h'),list=document.getElementById('list');
  if(d&&d.verses&&d.verses.length){eye.textContent=d.date?'The Daily Bread':'Scripture'+(d.label?' for '+d.label.toLowerCase():'');h.textContent=d.lead||d.label||'';
    list.innerHTML=d.verses.slice(0,6).map(function(v){return '<div class="card"><p class="verse">\\u201c'+esc(v.text)+'\\u201d</p><div class="ref">'+esc(v.ref)+'</div>'+(v.why?'<div class="muted">'+esc(v.why)+'</div>':'')+'</div>'}).join('')+(d.page?'<a class="btn gold" href="'+esc(d.page)+'">The family prays over this</a>':'');
  } else if(d&&d.ref){eye.textContent=d.date?'The Daily Bread, '+d.date:(d.translation||'KJV');h.textContent=d.ref;
    list.innerHTML='<div class="card"><p class="verse">\\u201c'+esc(d.text)+'\\u201d</p><div class="ref">'+esc(d.ref)+(d.translation?' ('+esc(d.translation)+')':'')+'</div></div>'+(d.shared?'<p class="muted">'+esc(d.shared)+'</p>':'')+'<a class="btn gold" href="'+esc(d.page||d.read_more||'${DOORS.bible}')+'">Read it on The Living Bread</a>';
  } else {h.textContent='Scripture';list.innerHTML='<a class="btn" href="${DOORS.bible}">Open the Bible</a>'}
}`);

const PRAYER_CARD = doc('Prayers over you', '<p class="eyebrow">Prayed over you</p><h1 id="h"></h1><div id="list"></div><p class="foot">Open a prayer on living-bread.org to hear the voice and say Amen. An assistant cannot play it for you.</p>', `
var ACT={prayer:'prayed for you',encouragement:'sent you encouragement',forgiveness:'spoke forgiveness over you',blessing:'blessed you',thanks:'gave thanks for you'};
function render(d){
  var rows=(d&&d.prayers)||[];var h=document.getElementById('h'),list=document.getElementById('list');
  h.textContent=rows.length?(rows.length===1?'One prayer is waiting':rows.length+' prayers over you'):'Nothing is waiting unheard';
  list.innerHTML=rows.slice(0,6).map(function(p){return '<div class="card"><strong>'+esc(p.from)+'</strong> <span class="muted">'+esc(ACT[p.kind]||'prayed for you')+(p.heard?' \\u00b7 heard':' \\u00b7 not yet heard')+(p.amen?' \\u00b7 Amen said':'')+'</span>'+(p.words?'<p class="verse">\\u201c'+esc(p.words)+'\\u201d</p>':'')+(p.seconds?'<div class="muted">'+esc(p.seconds)+' seconds in their own voice</div>':'')+'<a class="btn gold" href="'+esc(p.hear_url)+'">'+(p.words&&!p.seconds?'Read it':'Hear it')+'</a></div>'}).join('')
    +'<a class="btn" href="${DOORS.prayVoice}">Pray for someone by name</a>';
}`);

const CARDS: Record<WidgetName, { title: string; description: string; html: string }> = {
  'church-card': { title: 'Church card', description: 'Real churches near a place as cards: name, place as text, denomination, and the link to the live map. No static map image.', html: CHURCH_CARD },
  'verse-card': { title: 'Verse card', description: 'A verse or a set of verses, read from the stored King James text, with the reference and the door to read more.', html: VERSE_CARD },
  'prayer-card': { title: 'Prayer card', description: 'The prayers waiting over the signed-in believer, each with the link where they hear the voice.', html: PRAYER_CARD },
};

export function registerWidgets(server: McpServer): void {
  for (const name of Object.keys(CARDS) as WidgetName[]) {
    const card = CARDS[name];
    const uri = widgetUri(name);
    const meta = {
      ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: OWN_HOSTS } },
      'openai/widgetDescription': card.description,
      'openai/widgetPrefersBorder': true,
      'openai/widgetCSP': { connect_domains: [], resource_domains: OWN_HOSTS, redirect_domains: OWN_HOSTS },
    };
    server.registerResource(name, uri, { title: card.title, description: card.description, mimeType: WIDGET_MIME, _meta: meta }, async () => ({
      contents: [{ uri, mimeType: WIDGET_MIME, text: card.html, _meta: meta }],
    }));
  }
}
