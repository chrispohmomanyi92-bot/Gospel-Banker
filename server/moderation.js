// Two-layer abusive-language filter.
//  1. A fast local filter (always on): normalises leetspeak and spacing tricks,
//     masks profanity and blocks threats / harassment patterns.
//  2. An optional AI check with Claude (on when ANTHROPIC_API_KEY is set) that
//     catches insults, harassment and hate the word list misses.
// The AI layer fails open to the local verdict so chat never stalls.
import { readFileSync, existsSync } from 'node:fs';

const BASE_PROFANITY = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bastard', 'asshole',
  'dick', 'pussy', 'cunt', 'whore', 'slut', 'damn', 'crap', 'piss', 'wanker', 'twat', 'bollocks',
  'idiot', 'stupid', 'moron', 'dumbass', 'retard', 'imbecile', 'fool',
];

// Phrases that are blocked outright rather than masked.
const BLOCK_PATTERNS = [
  /\b(i('| a)?m going to|i will|gonna|i'll)\s+(kill|hurt|beat|rape|shoot|stab)\s+(you|u|him|her|them)\b/i,
  /\bkill\s+your\s*self\b/i,
  /\bkys\b/i,
  /\bgo\s+die\b/i,
  /\byou\s+(should|deserve to)\s+die\b/i,
];

const extraFile = new URL('../moderation-words.txt', import.meta.url);
const EXTRA = existsSync(extraFile)
  ? readFileSync(extraFile, 'utf8').split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => w && !w.startsWith('#'))
  : [];
const WORDS = [...new Set([...BASE_PROFANITY, ...EXTRA])];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '+': 't' };

function normalise(word) {
  return word
    .toLowerCase()
    .replace(/[0134578@$!+]/g, (ch) => LEET[ch] || ch)
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1'); // "fuuuuck" -> "fuuck"
}

const WORD_SET = new Set(WORDS);
function isBad(token) {
  if (/[*]/.test(token) && /[a-z]/i.test(token)) {
    // "f*ck", "sh*t": treat * as a single hidden letter
    const pat = new RegExp('^' + token.toLowerCase().replace(/[0134578@$!+]/g, (ch) => LEET[ch] || ch)
      .replace(/[^a-z*]/g, '').replace(/\*/g, '[a-z]') + '$');
    if (WORDS.some((w) => pat.test(w))) return true;
  }
  const n = normalise(token);
  if (!n) return false;
  if (WORD_SET.has(n)) return true;
  const squeezed = n.replace(/(.)\1+/g, '$1'); // "fuuck" -> "fuck"
  return WORD_SET.has(squeezed);
}

export function localModerate(text) {
  const joined = text.replace(/\b(\w)[\s.\-_*]+(?=\w\b)/g, '$1'); // "f u c k" -> "fuck"
  for (const p of BLOCK_PATTERNS) {
    if (p.test(text) || p.test(joined)) {
      return { allowed: false, text, flagged: true, reason: 'Threatening or harmful language is not allowed.' };
    }
  }
  let flagged = false;
  const masked = text.replace(/[\p{L}\p{N}@$!+*]+/gu, (tok) => {
    if (isBad(tok)) { flagged = true; return tok[0] + '*'.repeat(Math.max(tok.length - 1, 2)); }
    return tok;
  });
  // spaced-out words like "s h i t"
  if (!flagged) {
    const spaced = text.match(/\b(?:\w[\s.\-_*]+){2,}\w\b/g) || [];
    for (const s of spaced) {
      if (isBad(s.replace(/[\s.\-_*]/g, ''))) {
        return { allowed: true, text: text.replace(s, s[0] + '***'), flagged: true, reason: 'Inappropriate language was hidden.' };
      }
    }
  }
  return { allowed: true, text: masked, flagged, reason: flagged ? 'Inappropriate language was hidden.' : null };
}

const AI_MODEL = process.env.MODERATION_MODEL || 'claude-haiku-5-5';
const AI_SYSTEM = `You moderate a Seventh-day Adventist Christian community app (chat, posts, comments).
Classify the user's text. Reply with only JSON: {"verdict":"allow"|"block","category":"none"|"insult"|"harassment"|"hate"|"threat"|"sexual"|"profanity"|"spam","reason":"<short, kind explanation for the sender>"}.
Block insults aimed at people, harassment, hate speech, threats, sexual content, mocking of faith or of others, and spam/scams.
Allow normal conversation, disagreement expressed respectfully, Bible quotations (including words like "hell" or "damnation" in a theological sense), and prayer requests about hard topics.`;

async function aiModerate(text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.MODERATION_TIMEOUT_MS || 4000));
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 120,
        system: AI_SYSTEM,
        messages: [{ role: 'user', content: text.slice(0, 4000) }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.content?.find((b) => b.type === 'text')?.text || '';
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    return json;
  } catch {
    return null; // fail open to the local verdict
  } finally {
    clearTimeout(timer);
  }
}

export async function moderate(text) {
  const clean = String(text ?? '').trim();
  const local = localModerate(clean);
  if (!local.allowed) return local;
  const ai = await aiModerate(clean);
  if (ai && ai.verdict === 'block') {
    return { allowed: false, text: clean, flagged: true, reason: ai.reason || `Message blocked (${ai.category}).` };
  }
  return local;
}

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
