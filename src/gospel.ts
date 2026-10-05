/* ============================================================
   THE LIVING BREAD MCP, the house's own words about the good news.

   These sentences are the ones the live pages carry: living-bread.org/the-gospel
   (scripts/build-landing.py, gospel_page) and living-bread.org/who-is-jesus
   (scripts/build-who-is.py, the first page). They are quoted here, not
   rewritten, so the assistant speaks with the house and never composes
   theology of its own. Every verse named here is READ from the stored King
   James text at call time (src/kjv.ts); none is typed.
   ============================================================ */

export const CONFESSION = 'The Living Bread confesses Jesus Christ as God and Lord; every answer points to Him and to loving one another.';

export interface GospelStep { heading: string; words: string; ref: string }

/** The four movements of /the-gospel, in the house's words. */
export const GOSPEL_STEPS: readonly GospelStep[] = [
  { heading: 'God made you and loves you', words: 'You are not an accident. God made you on purpose and loves you deeply.', ref: 'John 3:16' },
  { heading: 'We are separated from God by sin', words: 'All of us have turned from God and gone our own way. That separation is the deepest problem of the human heart.', ref: 'Romans 3:23' },
  { heading: 'Jesus died and rose to bring us back', words: 'Out of love, Jesus took our place. He died on the cross for our sins and rose again, defeating death. His resurrection is God\'s promise that the offer is real.', ref: 'Romans 5:8' },
  { heading: 'New life is a free gift, received by faith', words: 'You cannot earn it; you can only receive it. Turn to Jesus, trust Him, and you are forgiven and made new.', ref: 'Ephesians 2:8' },
];

/** From /who-is-jesus: who He is, and who Christians confess Him to be. */
export const WHO_IS_JESUS = {
  short: 'Jesus of Nazareth was a first-century Jewish teacher and healer from Galilee whom Christians confess to be the Son of God, the promised Messiah, and God come among us in human flesh. He was born in Bethlehem near the start of the first century, taught and healed across Galilee and Judea, was crucified under Pontius Pilate around AD 30, and, Christians believe, rose bodily from the dead on the third day.',
  confess: 'Christians go further than the historians. They confess that this same Jesus is the eternal Son of God, the Word who was with God and was God, who became flesh and lived among us. Not a lesser god, and not simply a great prophet, but the one God come near, fully God and fully human.',
  why: 'If Jesus was only a wise teacher, you can admire him and move on. If he is who Christians say he is, then he is the clearest picture the world has of what God is like, and the door through which anyone can come home to God. He met the sick, the doubting, and the guilty with mercy, and he still does. The only way to know is to come close and look at him yourself.',
  refs: ['John 1:1', 'John 1:14', 'John 14:6', 'Matthew 16:16'] as readonly string[],
};

/** The YES, as the app has it: say_yes_to_christ (migrations 0298, 0487) is said from the
    welcome (SoLoved), from Come and See and from Foundations; the web doors are these. */
export const THE_YES = {
  what: 'In the app, saying yes to Jesus is one plain act, "I say yes to Christ", said in your own words on the Come and See page or at the end of the welcome; a companion from the family is told that night, and the first steps open at Foundations.',
};
