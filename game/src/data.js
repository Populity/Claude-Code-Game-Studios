// Game data — all tuning values live here (data-driven, no magic numbers in logic).
// Heroes are ORIGINAL parody archetypes of viral Reels trends, not real people.

export const GRID = { w: 30, h: 20, tile: 2 };

export const HEROES = [
  { id: 'sigma', name: 'Сигма Мьюер', emoji: '🗿', model: 'assets/models/sigma.glb', color: 0x9aa7ff, accent: 0x22e6ff,
    desc: 'Снайпер. Молча мьюинг — и цель исчезает. Дальность огромная.',
    cost: 100, kind: 'sniper',
    levels: [ { dmg: 42, range: 11, rate: 1.1 }, { dmg: 85, range: 12.5, rate: 1.0 }, { dmg: 170, range: 14, rate: 0.85 } ],
    upg: [0, 120, 220] },
  { id: 'rizz', name: 'Королева Ризза', emoji: '💅', model: 'assets/models/rizz.glb', color: 0xff5fb0, accent: 0xff2e88,
    desc: 'Луч обаяния: замедляет и плавит врагов. Маги теряют щиты.',
    cost: 120, kind: 'beam',
    levels: [ { dmg: 22, range: 7, rate: 0.1, slow: 0.45 }, { dmg: 38, range: 8, rate: 0.1, slow: 0.55 }, { dmg: 66, range: 9, rate: 0.1, slow: 0.65 } ],
    upg: [0, 130, 240] },
  { id: 'giga', name: 'Гига Качок', emoji: '💪', color: 0xffa040, accent: 0xffd23f,
    desc: 'Удар гантелей об землю. Сплэш вокруг, оглушает пехоту.',
    cost: 150, kind: 'slam',
    levels: [ { dmg: 55, range: 4.5, rate: 1.4, splash: 4.5, stun: 0.4 }, { dmg: 100, range: 5, rate: 1.25, splash: 5, stun: 0.55 }, { dmg: 190, range: 5.5, rate: 1.1, splash: 5.5, stun: 0.75 } ],
    upg: [0, 160, 290] },
  { id: 'cat', name: 'Вайб Кот DJ', emoji: '😼', color: 0x8b5cff, accent: 0x22ffb0,
    desc: 'Басдроп волной по всем рядом + усиливает героев вокруг (+25% урона).',
    cost: 180, kind: 'pulse',
    levels: [ { dmg: 18, range: 6, rate: 0.9, buff: 0.25 }, { dmg: 34, range: 6.5, rate: 0.8, buff: 0.35 }, { dmg: 60, range: 7, rate: 0.7, buff: 0.5 } ],
    upg: [0, 170, 300] },
  { id: 'baba', name: 'Бабушка Шеф', emoji: '👵', color: 0xff6040, accent: 0xff3b1f,
    desc: 'Кидает горящие сковородки навесом. Взрыв + поджог. Против танков — топ.',
    cost: 220, kind: 'mortar',
    levels: [ { dmg: 70, range: 10, rate: 2.0, splash: 3.5, burn: 12 }, { dmg: 130, range: 11, rate: 1.8, splash: 4, burn: 22 }, { dmg: 250, range: 12, rate: 1.6, splash: 4.5, burn: 40 } ],
    upg: [0, 200, 360] },
];

export const ENEMIES = {
  soldier: { name: 'Солдат', hp: 70, speed: 3.2, armor: 0, reward: 8, dmg: 1, scale: 1 },
  runner:  { name: 'Спринтер', hp: 45, speed: 5.6, armor: 0, reward: 7, dmg: 1, scale: 0.85 },
  tank:    { name: 'Танк', hp: 420, speed: 1.6, armor: 0.4, reward: 30, dmg: 3, scale: 1.3 },
  mage:    { name: 'Маг', hp: 140, speed: 2.4, armor: 0, reward: 18, dmg: 2, scale: 1, shieldAura: 6, shieldAmt: 60, shieldCd: 5 },
  boss:    { name: 'Мега-Мех', hp: 3200, speed: 1.1, armor: 0.5, reward: 250, dmg: 10, scale: 2.2 },
};

// Waypoints are grid cells (col,row); path tiles are traced between them.
export const LEVELS = [
  { id: 1, name: 'Солнечная Долина', theme: 'meadow', emoji: '🌳',
    startGold: 420, lives: 20,
    paths: [
      [[0,2],[8,2],[8,8],[3,8],[3,15],[14,15],[14,6],[20,6],[20,10],[29,10]],
      [[16,0],[16,3],[25,3],[25,17],[22,17],[22,10],[29,10]],
    ],
    waves: [
      [['soldier', 8, 0.9]],
      [['soldier', 10, 0.7], ['runner', 5, 0.5]],
      [['soldier', 8, 0.6], ['mage', 2, 2.0]],
      [['runner', 12, 0.4], ['tank', 1, 1]],
      [['soldier', 12, 0.5], ['mage', 3, 1.6], ['tank', 2, 3]],
      [['tank', 4, 2.2], ['runner', 14, 0.35]],
      [['soldier', 16, 0.4], ['mage', 4, 1.2], ['tank', 3, 2]],
      [['boss', 1, 1], ['soldier', 14, 0.5], ['mage', 3, 2]],
    ] },
  { id: 2, name: 'Каньон Трендов', theme: 'canyon', emoji: '🏜️',
    startGold: 520, lives: 18,
    paths: [
      [[0,3],[6,3],[6,16],[11,16],[11,10],[15,10]],
      [[29,4],[22,4],[22,15],[18,15],[18,10],[15,10]],
      [[12,0],[12,6],[19,6],[19,8],[15,8],[15,10]],
    ],
    waves: [
      [['runner', 12, 0.5]],
      [['soldier', 12, 0.6], ['mage', 2, 2]],
      [['tank', 3, 2.5], ['soldier', 8, 0.6]],
      [['mage', 5, 1.2], ['runner', 14, 0.35]],
      [['tank', 5, 2], ['mage', 3, 1.5]],
      [['runner', 24, 0.25], ['soldier', 14, 0.4]],
      [['tank', 6, 1.6], ['mage', 6, 1.2]],
      [['boss', 1, 1], ['tank', 4, 3], ['runner', 16, 0.3]],
      [['boss', 2, 6], ['mage', 6, 1.5], ['soldier', 20, 0.3]],
    ] },
  { id: 3, name: 'Ледяная Цитадель', theme: 'glacier', emoji: '🏔️',
    startGold: 650, lives: 15,
    paths: [
      [[0,1],[10,1],[10,5],[2,5],[2,12],[8,12],[8,17],[15,17],[15,19]],
      [[29,1],[19,1],[19,5],[27,5],[27,12],[21,12],[21,17],[15,17],[15,19]],
      [[0,19],[5,19],[5,15],[8,15],[8,17],[15,17],[15,19]],
      [[15,0],[15,9],[12,9],[12,14],[15,14],[15,17],[15,19]],
    ],
    waves: [
      [['soldier', 14, 0.5], ['mage', 2, 2]],
      [['runner', 18, 0.3], ['tank', 2, 3]],
      [['mage', 6, 1], ['soldier', 12, 0.4]],
      [['tank', 6, 1.5], ['runner', 14, 0.3]],
      [['boss', 1, 1], ['mage', 5, 1.4]],
      [['soldier', 30, 0.25], ['mage', 6, 1]],
      [['tank', 10, 1.2], ['mage', 6, 1.4]],
      [['runner', 40, 0.15], ['boss', 1, 4]],
      [['boss', 2, 5], ['tank', 8, 1.5], ['mage', 8, 1]],
      [['boss', 4, 4], ['tank', 10, 1.2], ['mage', 10, 0.9], ['runner', 30, 0.2]],
    ] },
];

// Difficulty slider 1..10. 10 = HARDCORE.
export function difficulty(d) {
  const names = ['Чилл', 'Лайт', 'Изи', 'Норм', 'Норм+', 'Жёстко', 'Больно', 'Кошмар', 'Ад', 'ХАРДКОР'];
  return {
    name: names[d - 1],
    hp: 0.55 + 0.2 * (d - 1) + (d === 10 ? 0.6 : 0),
    speed: 0.9 + 0.035 * (d - 1),
    reward: 1.25 - 0.06 * (d - 1),
    lives: d >= 9 ? 0.5 : 1,
    countMul: 1 + 0.07 * (d - 1),
    ultCharge: 1.2 - 0.06 * (d - 1),
  };
}

export const ULT = { killsNeeded: 40, dmg: 600, stun: 2.5 };
export const COMBO = { window: 1.6, step: 5, max: 5 };
export const EARLY_WAVE_BONUS = 25;
export const SELL_RATIO = 0.7;

// Sky allies: called in from the sky onto a clicked point, each on its own cooldown.
// Cooldowns scale with power: cheap support ~25s, area control ~35s, nuke ~50s.
export const ALLIES = [
  { id: 'drone', name: 'Дрон-Оператор', emoji: '🚁', key: 'Z', cd: 25, life: 14, dmg: 30, rate: 0.35, range: 9,
    desc: 'Зависает над точкой 14с и поливает всех рядом очередями.' },
  { id: 'llama', name: 'Десант-Лама', emoji: '🦙', key: 'X', cd: 35, life: 12, dmg: 140, stun: 2.5, radius: 6, spit: 45, rate: 0.8, range: 7,
    desc: 'Падает на парашюте: удар при приземлении оглушает всех вокруг, потом плюётся.' },
  { id: 'meteor', name: 'Метеор Хайпа', emoji: '☄️', key: 'C', cd: 50, dmg: 900, radius: 7, burn: 60,
    desc: 'Огромный метеор: взрыв по площади и поджог. Сносит даже танки.' },
];
