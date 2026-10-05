// Game data — all tuning values live here (data-driven, no magic numbers in logic).
// Heroes are ORIGINAL parody archetypes of viral Reels trends, not real people.

export const GRID = { w: 20, h: 12, tile: 2 };

export const HEROES = [
  { id: 'sigma', name: 'Сигма Мьюер', emoji: '🗿', color: 0x9aa7ff, accent: 0x22e6ff,
    desc: 'Снайпер. Молча мьюинг — и цель исчезает. Дальность огромная.',
    cost: 100, kind: 'sniper',
    levels: [ { dmg: 42, range: 11, rate: 1.1 }, { dmg: 85, range: 12.5, rate: 1.0 }, { dmg: 170, range: 14, rate: 0.85 } ],
    upg: [0, 120, 220] },
  { id: 'rizz', name: 'Королева Ризза', emoji: '💅', color: 0xff5fb0, accent: 0xff2e88,
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
  { id: 1, name: 'Неоновый Пригород', sky: 0x1a0b3a, ground: 0x2a6b3a, fog: 0x2a1250,
    startGold: 320, lives: 20,
    path: [[0,2],[6,2],[6,8],[12,8],[12,3],[17,3],[17,9],[19,9]],
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
  { id: 2, name: 'Пустыня Трендов', sky: 0x3a1a0b, ground: 0xb08a4a, fog: 0x5a2a20,
    startGold: 360, lives: 18,
    path: [[0,10],[4,10],[4,1],[9,1],[9,10],[14,10],[14,1],[19,1]],
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
  { id: 3, name: 'Цитадель Алгоритма', sky: 0x050a1f, ground: 0x283048, fog: 0x0a1a40,
    startGold: 400, lives: 15,
    path: [[0,5],[3,5],[3,1],[8,1],[8,6],[5,6],[5,10],[11,10],[11,4],[15,4],[15,10],[19,10]],
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
