/* ============================================================
   THE LIVING BREAD MCP, prompts named by the moment a person arrives in.

   Every client lists prompts, so these are named the way a person feels,
   not the way a feature is called. Each one tells the assistant which tools
   to use, to quote Scripture only through them, to speak gently, to give
   the real crisis line first when there is danger, and to end with one
   real door into The Living Bread. The three original prompts stay in
   src/tools.ts.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { DOORS } from './doors';
import { paragraph } from './render';

const GENTLE = 'Speak gently and simply, as to a friend; no pressure, no guilt, no scores. Quote Scripture only as the tools return it, with the reference, and never from memory. Your own words are yours and say so';
const CRISIS = 'If at any point I speak of harming myself or someone else, stop and call crisis_resources with my country first and give me the real number before anything else';

function prompt(server: McpServer, name: string, title: string, description: string, args: Record<string, z.ZodTypeAny>, lines: (a: Record<string, string | undefined>) => (string | null | undefined | false)[]) {
  server.registerPrompt(name, { title, description, argsSchema: args }, (a) => ({
    messages: [{ role: 'user', content: { type: 'text', text: paragraph(lines(a as Record<string, string | undefined>)) } }],
  }));
}

export function registerPrompts(server: McpServer): void {
  prompt(server, 'i_am_not_sure_i_believe', 'I am not sure I believe', 'For a person who is unsure whether God is real or whether they believe: honest, unhurried, no argument, one small door.', { about: z.string().optional().describe('What makes them unsure, in their words.') }, (a) => [
    `I am not sure I believe${a.about ? `. ${a.about}` : ''}`,
    'Do not argue with me and do not rush me. Call the_gospel and tell me, in the house\'s words and the verses it returns, what Christians actually believe about Jesus',
    'If I come from another faith or none, call come_and_see with my background and keep its posture: respect, truth, no argument',
    'Call verses_for with "doubt" and read me one verse exactly as returned',
    GENTLE,
    `End with one real door: who Jesus is at ${DOORS.whoIsJesus}, or a real conversation at ${DOORS.theTable}, and tell me the family at The Living Bread will pray for me by name if I want`,
  ]);

  prompt(server, 'i_want_to_pray_but_do_not_know_how', 'I want to pray but do not know how', 'Teach a person to pray in the simplest honest way, with the Lord\'s own words and the house\'s prayers, and the door where real people pray with them.', { about: z.string().optional().describe('What they want to pray about.') }, (a) => [
    `I want to pray${a.about ? ` about ${a.about}` : ''} but I do not know how`,
    'Call scripture_passage for Matthew 6:9-13 and read me the Lord\'s Prayer exactly as returned. Then call teaching_of_jesus with "prayer"',
    a.about ? `Call a_prayer_for with "${a.about}" and read me the house's prayer, saying plainly it is a prayer I may make my own` : 'Call a_prayer_for with "morning" or "peace" and read me the house\'s prayer, saying plainly it is one I may make my own',
    'Tell me that prayer is talking to God honestly, in my own words, and that no words are too small',
    GENTLE,
    `End with the door where real people pray with me by name: ${DOORS.prayer}, and the plan Learn to Pray from reading_plans`,
  ]);

  prompt(server, 'someone_i_love_died', 'Someone I love died', 'For grief: no explanation, presence first, then the Word read from the tools, a prayer, and the door to real people and to Christ who wept.', { who: z.string().optional().describe('Who died, as they name them.') }, (a) => [
    `Someone I love died${a.who ? `: ${a.who}` : ''}`,
    'Do not explain my loss or hurry me. Say first that you are sorry and that I am allowed to grieve',
    'Call threshold with "grief" and read me, in the house\'s words, that Jesus wept and what Christians hold onto. Call verses_for with "grief" and read one or two verses exactly as returned',
    'Call a_prayer_for with "a dying loved one" or "grief" and offer me the house\'s prayer',
    CRISIS,
    GENTLE,
    `End with one door: real believers who will pray for me by name at ${DOORS.prayer}, and pray_for_someone if I want to pray for someone else who is grieving`,
  ]);

  prompt(server, 'i_cannot_forgive_myself', 'I cannot forgive myself', 'For guilt and shame: what the Bible says, read from the tools, the gospel of grace in the house\'s words, and the door to say yes.', { about: z.string().optional() }, (a) => [
    `I cannot forgive myself${a.about ? `. ${a.about}` : ''}`,
    'Call what_the_bible_says_about with "guilt" and then "shame", and read me two verses exactly as returned, with the house\'s word on each',
    'Call the_gospel and tell me, in the house\'s words, that new life is a free gift received by faith and cannot be earned',
    'Call belief with "grace"',
    CRISIS,
    GENTLE,
    `End with one door: where a person says yes to Christ at ${DOORS.comeAndSee}, and someone to talk to now at ${DOORS.home}/talk`,
  ]);

  prompt(server, 'i_want_to_find_a_church', 'I want to find a church', 'Find real churches and gatherings near a person, honestly, and one concrete first step this week.', { place: z.string().describe('City, region or country.'), tradition: z.string().optional().describe('A denomination, if they have one.') }, (a) => [
    `I want to find a church near ${a.place}${a.tradition ? `, ${a.tradition} if possible` : ''}`,
    `Call find_churches_near with city "${a.place}"${a.tradition ? ` and denomination "${a.tradition}"` : ''}, then events_this_week for the same place. Tell me only what the tools return, nearest first, with the city for each; if nothing is held, say so plainly and give me the live finder`,
    a.tradition ? `If I ask what ${a.tradition} is, call heritage_lookup with kind denomination` : 'If I do not know what tradition I want, call denomination_compare on two I name, charitably',
    'Suggest one concrete first step I could take this week, and remind me I do not have to go alone',
    GENTLE,
    `End with the live finder ${DOORS.findAChurch} and the family who prays for me by name at ${DOORS.prayer}`,
  ]);

  prompt(server, 'explain_the_gospel_simply', 'Explain the gospel simply', 'The good news in the house\'s own words, with the verses read from the stored text, and the door to say yes.', {}, () => [
    'Explain the gospel to me simply',
    'Call the_gospel and tell me its four movements in the house\'s words, reading each verse exactly as returned with the reference. Say plainly, as the house does, that Jesus Christ is God and Lord',
    'Then call scripture_passage for John 3:16 and read it to me',
    GENTLE,
    `End with the door where a person says yes: ${DOORS.comeAndSee}, and how to follow Jesus at ${DOORS.followJesus}`,
  ]);

  prompt(server, 'what_happens_when_we_die', 'What happens when we die', 'The Christian hope about death, from the Word read through the tools and the house\'s pages, honestly and gently.', {}, () => [
    'What happens when we die?',
    'Call scripture_passage for John 11:25-26 and 1 Corinthians 15:51-57 and read them exactly as returned. Call what_the_bible_says_about with "death" or "heaven" and read the house\'s page',
    'Call miracle with "raising Lazarus" and tell me what it shows about Jesus',
    'Say honestly what Christians confess (that Jesus died and rose, and that those who are His are held) and do not claim more than the Word says',
    CRISIS,
    GENTLE,
    `End with one door: who Jesus is at ${DOORS.whoIsJesus}, or a real conversation at ${DOORS.theTable}`,
  ]);

  prompt(server, 'i_am_alone_tonight', 'I am alone tonight', 'For loneliness at night: presence, the Word read from the tools, where the family is awake, and someone to talk to.', {}, () => [
    'I am alone tonight',
    'Stay with me first. Then call verses_for with "lonely" and read me one verse exactly as returned',
    'Call body_today and tell me, honestly, what the family is doing right now, and call hear_the_kingdom_pray for the door where I can hear believers praying over the whole family',
    'Call worship_now with my hour for something to listen to tonight',
    CRISIS,
    GENTLE,
    `End with one door: someone to talk to now at ${DOORS.home}/talk (someone_to_talk_to if I am connected as myself), or ${DOORS.kingdomPraying}`,
  ]);

  prompt(server, 'i_did_something_terrible', 'I did something terrible', 'For a person carrying something they did: safety first if anyone is in danger, then the Word on forgiveness, a prayer, and a real person.', { about: z.string().optional() }, (a) => [
    `I did something terrible${a.about ? `. ${a.about}` : ''}`,
    'If anyone is in danger because of it, or I am, call crisis_resources with my country first and give me the real number. Then stay with me',
    'Call what_the_bible_says_about with "guilt" and read me one verse exactly as returned. Call parable with "prodigal son" and tell me what it means in the house\'s words',
    'Call a_prayer_for with "forgiveness" and offer me the house\'s prayer, saying it is one I may make my own',
    'Do not minimise what I did, and do not condemn me; tell me the truth the Word tells',
    GENTLE,
    `End with one door: someone to talk to at ${DOORS.home}/talk, a shepherd at ${DOORS.pastors}, and where a person says yes to Christ at ${DOORS.comeAndSee}`,
  ]);

  prompt(server, 'walk_me_through_my_first_week', 'Walk me through my first week', 'For someone who just said yes to Jesus or just joined: the first week, one small step a day, from the reading plans and the doors that exist.', { name: z.string().optional() }, (a) => [
    `${a.name ? `${a.name} here. ` : ''}I just said yes to Jesus (or just joined The Living Bread). Walk me through my first week`,
    'Call reading_plans with "first steps" and give me day one, reading its verse exactly as returned; tell me the plan continues one day at a time',
    'Call daily_bread for today\'s verse the whole family receives. Call begin for what a newcomer meets first',
    'Call find_churches_near if I tell you my city, and communities_to_join so I am not alone',
    'Give me one small act of love for today and one for tomorrow, and no streaks or scores',
    GENTLE,
    `End with the doors: ${DOORS.today} for today's walk, ${DOORS.followJesus} for how to follow Jesus, and the family who prays for me by name at ${DOORS.prayer}`,
  ]);
}
