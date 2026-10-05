import { DEFAULT_RULES, newClip, statusOf, type ClipRecord } from "./core";

export interface TopicDef { id: string; e: string; ru: string; en: string; g: [string, string]; keywords: string[] }
export const TOPICS: TopicDef[] = [
  { id: "humor", e: "😂", ru: "Юмор", en: "Comedy", g: ["#f7971e", "#ffd200"], keywords: ["смешн", "юмор", "прикол", "funny", "meme", "мем"] },
  { id: "sport", e: "⚽", ru: "Спорт", en: "Sports", g: ["#00c6ff", "#0072ff"], keywords: ["спорт", "футбол", "goal", "sport"] },
  { id: "food", e: "🍜", ru: "Еда", en: "Food", g: ["#f12711", "#f5af19"], keywords: ["еда", "рецепт", "food", "cook", "вкусн"] },
  { id: "dance", e: "💃", ru: "Танцы", en: "Dance", g: ["#ee0979", "#ff6a00"], keywords: ["танц", "dance"] },
  { id: "travel", e: "✈️", ru: "Путешествия", en: "Travel", g: ["#43cea2", "#185a9d"], keywords: ["путеш", "travel", "море", "горы"] },
  { id: "beauty", e: "💄", ru: "Красота", en: "Beauty", g: ["#ff9a9e", "#fad0c4"], keywords: ["макияж", "beauty", "makeup"] },
  { id: "fashion", e: "👗", ru: "Мода", en: "Fashion", g: ["#8e2de2", "#4a00e0"], keywords: ["мода", "образ", "outfit", "fashion"] },
  { id: "music", e: "🎵", ru: "Музыка", en: "Music", g: ["#fc466b", "#3f5efb"], keywords: ["музык", "песн", "music", "song", "кавер"] },
  { id: "pets", e: "🐶", ru: "Животные", en: "Pets", g: ["#f6d365", "#fda085"], keywords: ["кот", "собак", "cat", "dog", "pet"] },
  { id: "gaming", e: "🎮", ru: "Игры", en: "Gaming", g: ["#11998e", "#38ef7d"], keywords: ["игр", "game", "gaming"] },
  { id: "fitness", e: "💪", ru: "Фитнес", en: "Fitness", g: ["#e52d27", "#b31217"], keywords: ["фитнес", "зал", "gym", "workout"] },
  { id: "art", e: "🎨", ru: "Искусство", en: "Art", g: ["#c471f5", "#fa71cd"], keywords: ["рису", "арт", "art", "draw"] },
  { id: "tech", e: "📱", ru: "Технологии", en: "Tech", g: ["#4b6cb7", "#182848"], keywords: ["техн", "гаджет", "tech"] },
  { id: "cars", e: "🏎️", ru: "Авто", en: "Cars", g: ["#232526", "#ff512f"], keywords: ["авто", "машин", "car", "дрифт"] },
  { id: "edu", e: "🧠", ru: "Обучение", en: "Learning", g: ["#56ab2f", "#a8e063"], keywords: ["урок", "learn", "факт", "лайфхак"] },
  { id: "life", e: "☕", ru: "Лайфстайл", en: "Lifestyle", g: ["#c79081", "#dfa579"], keywords: ["влог", "vlog", "утро", "день"] },
];
export const topicOf = (id: string) => TOPICS.find(t => t.id === id) ?? TOPICS[0];

/** A clip in the trial app: core battle record + presentation fields. */
export interface Clip extends ClipRecord {
  handle: string; caption: number | string; src: "demo" | "file" | "link";
  uri?: string; code?: string; fingerprint?: string; hist: (0 | 1)[]; ts: number;
}

const HANDLES = ["mila.vibes", "dan_runs", "katya.cooks", "max.moves", "travel.with.lia", "artem.art", "nika_style", "the.lev", "sasha.beats", "pixel.pasha", "olya.fit", "gleb.drive", "tanya.learns", "vova.lol", "yana.pets", "kirill.tech"];
export const CAPS = { ru: ["Ждали продолжение? 🔥", "Сняли с первого дубля", "Это надо видеть до конца", "Повторите, если сможете", "Мой лучший клип за месяц", "Без монтажа!"],
                      en: ["Waited for part 2? 🔥", "Shot in one take", "Watch till the end", "Try to repeat this", "My best clip this month", "No editing!"] };

/** Deterministic PRNG so the demo world is the same on every device. */
export function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function seedClips(): Clip[] {
  const rng = mulberry32(2026), out: Clip[] = [];
  TOPICS.forEach((tp, ti) => { for (let i = 0; i < 6; i++) {
    const handle = HANDLES[(ti * 5 + i) % HANDLES.length];
    const c: Clip = { ...newClip(`d-${tp.id}-${i}`, tp.id, handle), handle, caption: (ti + i) % 6, src: "demo", hist: [], ts: 0 };
    const n = Math.floor(rng() * 16), p = [0.85, 0.75, 0.55, 0.45, 0.3, 0.2][i];
    for (let k = 0; k < n && c.status !== "out"; k++) { const w = rng() < p; if (w) c.wins++; else c.losses++; c.hist.push(w ? 1 : 0); c.rating += w ? 14 : -14; c.status = statusOf(c, DEFAULT_RULES); }
    out.push(c);
  } });
  return out;
}
