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
