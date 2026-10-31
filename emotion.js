// Emotion helpers.
// 1. The AI is asked to start its reply with a tag like [EMOTION: happy].
// 2. If there is no tag, keywords in the reply (English and Hinglish) are used to guess the emotion.

export const EMOTIONS = ['neutral', 'happy', 'excited', 'sad', 'angry', 'surprised', 'confused', 'thinking'];

const RULES = [
  ['happy', /\b(khush|khushi|mast|badhiya|accha laga|happy|glad|good|nice|great|welcome|shukriya|thanks|dhanyavaad|love)\b/gi],
  ['excited', /\b(zabardast|shandaar|amazing|awesome|fantastic|wonderful|let'?s go|kamaal)\b/gi],
  ['sad', /\b(dukh|afsos|sad|sorry|bura|dard|unfortunately|maaf|miss)\b/gi],
  ['angry', /\b(gussa|angry|galat|nahi chalega|bekar|frustrat\w*)\b/gi],
  ['surprised', /\b(wow|arre|omg|really|sach me|seriously|kya baat)\b/gi],
  ['confused', /\b(samajh nahi|confused|pata nahi|kya matlab|unclear|not sure)\b/gi],
  ['thinking', /\b(hmm+|sochna|let me think|soch raha|analy[sz]e|dekhta hoon)\b/gi]
];

// Removes the leading [EMOTION: x] tag and returns the clean text with the emotion (or null)
export function parseEmotion(text) {
  const m = text.match(/^\s*\[\s*emotion\s*:\s*([a-z]+)\s*\]\s*/i);
  if (!m) return { text, emotion: null };
  const e = m[1].toLowerCase();
  return { text: text.slice(m[0].length), emotion: EMOTIONS.includes(e) ? e : null };
}

// Keyword guess. Returns the emotion with the highest score, or 'neutral'.
export function detectEmotion(text) {
  const scores = {};
  for (const [name, re] of RULES) {
    const count = (text.match(re) || []).length;
    if (count) scores[name] = (scores[name] || 0) + count;
  }
  if (text.includes('!')) scores.happy = (scores.happy || 0) + 0.5;
  if (text.includes('?')) scores.thinking = (scores.thinking || 0) + 0.5;

  let best = 'neutral';
  let max = 0;
  for (const [name, value] of Object.entries(scores)) {
    if (value > max) { max = value; best = name; }
  }
  return best;
}
