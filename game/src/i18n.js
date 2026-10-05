// Localization. Language resolution order (first match wins):
//   1. ?lang=xx in the URL (store pages / web portals can link a locale directly)
//   2. the player's saved choice from the in-game language menu
//   3. window.STORE_LANG — set by the platform wrapper (e.g. Steam's UI language via Steamworks)
//   4. the browser / OS language list (navigator.languages)
//   5. English
export const LANGS = { en: 'English', ru: 'Русский', es: 'Español', pt: 'Português (BR)' };

const STR = {
  en: {
    'menu.play': '▶ PLAY', 'menu.heroes': '🧬 HEROES', 'menu.howto': '❔ HOW TO PLAY', 'menu.lang': '🌐 LANGUAGE',
    'menu.footer': 'v0.2 · early build · 3 levels', 'menu.gfx': 'GRAPHICS: {q}', 'gfx.ultra': 'ULTRA 1080p+', 'gfx.high': 'HIGH',
    'levels.title': 'SELECT LEVEL', 'levels.diff': 'DIFFICULTY:', 'back': '← BACK', 'heroes.title': 'REELS HEROES', 'howto.title': 'HOW TO PLAY',
    'howto.list': '<li>Soldiers, tanks and mages march along the roads to your base. Every leak costs you followers ❤.</li><li>Pick a hero at the bottom and click the grass to place them. You pay in likes 👍.</li><li>Click a hero to upgrade (up to level 3) or sell.</li><li>Kill in streaks — the COMBO multiplies rewards.</li><li>The <b>VIRAL MOMENT</b> bar fills with kills — press <b>Q</b> to wipe the screen.</li><li>Sky allies (right side, <b>Z X C</b>): call them onto any point, each has a cooldown.</li><li>Space — next wave early (bonus likes). <b>F</b> — speed. Right mouse / wheel — camera.</li><li>Mages shield their allies, tanks shrug off part of the damage. Hardcore 10/10 is for legends.</li>',
    'hud.combo': 'COMBO x', 'hud.next': 'NEXT WAVE ⏭', 'hud.ult': 'VIRAL MOMENT [Q]',
    'pause.title': 'PAUSED', 'pause.resume': 'RESUME', 'pause.restart': 'RESTART', 'pause.quit': 'MAIN MENU', 'end.next': 'NEXT', 'end.menu': 'MAIN MENU',
    'lvl.banner': 'LEVEL {n}: {name}', 'wave.final': 'FINAL WAVE!', 'wave.n': 'WAVE {n}', 'boss': '⚠ BOSS ⚠', 'combo.pop': 'COMBO x{n}!',
    'ult.banner': '🔥 VIRAL MOMENT 🔥', 'wave.clear': 'WAVE CLEARED +{n}', 'ally.ready': 'READY [{k}]', 'sec': 's',
    'end.win': 'VIRAL VICTORY!', 'end.lose': 'YOU GOT UNFOLLOWED...', 'end.stats': 'Difficulty: {d} ({v}/10) · Kills: {k} · Leaks: {l}',
    'end.nextLevel': 'NEXT LEVEL', 'end.again': 'PLAY AGAIN', 'end.rematch': 'REMATCH',
    'sel.dmg': 'Damage', 'sel.range': 'Range', 'sel.buff': 'Buff', 'sel.perSec': '/s', 'sel.upgrade': 'UPGRADE {c}👍', 'sel.max': 'MAX', 'sel.sell': 'SELL {c}',
    'card.waves': '{w} waves · {p} entrances · {l} ❤', 'card.locked': '🔒 beat the previous level', 'card.price': 'Cost', 'card.dmg': 'Damage',
    'diff.info': 'Enemy HP x{hp} · speed x{sp} · reward x{rw}', 'diff.lives': ' · lives x0.5', 'loading': 'Loading…',
  },
  ru: {
    'menu.play': '▶ ИГРАТЬ', 'menu.heroes': '🧬 ГЕРОИ', 'menu.howto': '❔ КАК ИГРАТЬ', 'menu.lang': '🌐 ЯЗЫК',
    'menu.footer': 'v0.2 · ранняя сборка · 3 уровня', 'menu.gfx': 'ГРАФИКА: {q}', 'gfx.ultra': 'УЛЬТРА 1080p+', 'gfx.high': 'ВЫСОКАЯ',
    'levels.title': 'ВЫБОР УРОВНЯ', 'levels.diff': 'СЛОЖНОСТЬ:', 'back': '← НАЗАД', 'heroes.title': 'ГЕРОИ РИЛСОВ', 'howto.title': 'КАК ИГРАТЬ',
    'howto.list': '<li>Солдаты, танки и маги идут по дорогам к твоей базе. Каждый прорыв — минус подписчики ❤.</li><li>Выбери героя внизу и кликни по траве — он встанет на позицию. Платишь лайками 👍.</li><li>Кликни по герою — прокачка до 3 уровня или продажа.</li><li>Убивай сериями — КОМБО множит награду.</li><li>Шкала <b>ВИРУСНЫЙ МОМЕНТ</b> заполняется от убийств — жми <b>Q</b> и сноси всех.</li><li>Помощники с неба (справа, <b>Z X C</b>): сбрасываешь в любую точку, у каждого перезарядка.</li><li>Пробел — следующая волна раньше (бонус лайков). <b>F</b> — ускорение. ПКМ/колесо — камера.</li><li>Маги ставят щиты союзникам, танки игнорируют часть урона. Хардкор 10/10 — для легенд.</li>',
    'hud.combo': 'КОМБО x', 'hud.next': 'СЛЕД. ВОЛНА ⏭', 'hud.ult': 'ВИРУСНЫЙ МОМЕНТ [Q]',
    'pause.title': 'ПАУЗА', 'pause.resume': 'ПРОДОЛЖИТЬ', 'pause.restart': 'ЗАНОВО', 'pause.quit': 'В МЕНЮ', 'end.next': 'ДАЛЕЕ', 'end.menu': 'В МЕНЮ',
    'lvl.banner': 'УРОВЕНЬ {n}: {name}', 'wave.final': 'ФИНАЛЬНАЯ ВОЛНА!', 'wave.n': 'ВОЛНА {n}', 'boss': '⚠ БОСС ⚠', 'combo.pop': 'КОМБО x{n}!',
    'ult.banner': '🔥 ВИРУСНЫЙ МОМЕНТ 🔥', 'wave.clear': 'ВОЛНА ПРОЙДЕНА +{n}', 'ally.ready': 'ГОТОВ [{k}]', 'sec': 'с',
    'end.win': 'ВИРУСНАЯ ПОБЕДА!', 'end.lose': 'ТЕБЯ ОТПИСАЛИ...', 'end.stats': 'Сложность: {d} ({v}/10) · Убито: {k} · Прорвалось: {l}',
    'end.nextLevel': 'СЛЕДУЮЩИЙ УРОВЕНЬ', 'end.again': 'ЕЩЁ РАЗ', 'end.rematch': 'РЕВАНШ',
    'sel.dmg': 'Урон', 'sel.range': 'Дальность', 'sel.buff': 'Бафф', 'sel.perSec': '/с', 'sel.upgrade': 'ПРОКАЧАТЬ {c}👍', 'sel.max': 'МАКС', 'sel.sell': 'ПРОДАТЬ {c}',
    'card.waves': '{w} волн · входов: {p} · {l} ❤', 'card.locked': '🔒 пройди предыдущий', 'card.price': 'Цена', 'card.dmg': 'Урон',
    'diff.info': 'HP врагов x{hp} · скорость x{sp} · награда x{rw}', 'diff.lives': ' · жизни x0.5', 'loading': 'Загрузка…',
  },
  es: {
    'menu.play': '▶ JUGAR', 'menu.heroes': '🧬 HÉROES', 'menu.howto': '❔ CÓMO JUGAR', 'menu.lang': '🌐 IDIOMA',
    'menu.footer': 'v0.2 · versión temprana · 3 niveles', 'menu.gfx': 'GRÁFICOS: {q}', 'gfx.ultra': 'ULTRA 1080p+', 'gfx.high': 'ALTO',
    'levels.title': 'ELIGE NIVEL', 'levels.diff': 'DIFICULTAD:', 'back': '← ATRÁS', 'heroes.title': 'HÉROES DE REELS', 'howto.title': 'CÓMO JUGAR',
    'howto.list': '<li>Soldados, tanques y magos marchan por las carreteras hacia tu base. Cada fuga te cuesta seguidores ❤.</li><li>Elige un héroe abajo y haz clic en el césped para colocarlo. Pagas con likes 👍.</li><li>Haz clic en un héroe para mejorarlo (hasta nivel 3) o venderlo.</li><li>Mata en racha: el COMBO multiplica la recompensa.</li><li>La barra <b>MOMENTO VIRAL</b> se llena con las bajas: pulsa <b>Q</b> y arrasa con todo.</li><li>Aliados del cielo (a la derecha, <b>Z X C</b>): lánzalos sobre cualquier punto; cada uno tiene recarga.</li><li>Espacio: siguiente oleada antes (likes extra). <b>F</b>: velocidad. Botón derecho / rueda: cámara.</li><li>Los magos protegen a sus aliados y los tanques ignoran parte del daño. Hardcore 10/10 es para leyendas.</li>',
    'hud.combo': 'COMBO x', 'hud.next': 'SIG. OLEADA ⏭', 'hud.ult': 'MOMENTO VIRAL [Q]',
    'pause.title': 'PAUSA', 'pause.resume': 'CONTINUAR', 'pause.restart': 'REINICIAR', 'pause.quit': 'MENÚ', 'end.next': 'SIGUIENTE', 'end.menu': 'MENÚ',
    'lvl.banner': 'NIVEL {n}: {name}', 'wave.final': '¡OLEADA FINAL!', 'wave.n': 'OLEADA {n}', 'boss': '⚠ JEFE ⚠', 'combo.pop': '¡COMBO x{n}!',
    'ult.banner': '🔥 MOMENTO VIRAL 🔥', 'wave.clear': 'OLEADA SUPERADA +{n}', 'ally.ready': 'LISTO [{k}]', 'sec': 's',
    'end.win': '¡VICTORIA VIRAL!', 'end.lose': 'TE DEJARON DE SEGUIR...', 'end.stats': 'Dificultad: {d} ({v}/10) · Bajas: {k} · Fugas: {l}',
    'end.nextLevel': 'SIGUIENTE NIVEL', 'end.again': 'OTRA VEZ', 'end.rematch': 'REVANCHA',
    'sel.dmg': 'Daño', 'sel.range': 'Alcance', 'sel.buff': 'Bonus', 'sel.perSec': '/s', 'sel.upgrade': 'MEJORAR {c}👍', 'sel.max': 'MÁX', 'sel.sell': 'VENDER {c}',
    'card.waves': '{w} oleadas · {p} entradas · {l} ❤', 'card.locked': '🔒 supera el nivel anterior', 'card.price': 'Precio', 'card.dmg': 'Daño',
    'diff.info': 'Vida enemiga x{hp} · velocidad x{sp} · recompensa x{rw}', 'diff.lives': ' · vidas x0.5', 'loading': 'Cargando…',
  },
  pt: {
    'menu.play': '▶ JOGAR', 'menu.heroes': '🧬 HERÓIS', 'menu.howto': '❔ COMO JOGAR', 'menu.lang': '🌐 IDIOMA',
    'menu.footer': 'v0.2 · versão inicial · 3 fases', 'menu.gfx': 'GRÁFICOS: {q}', 'gfx.ultra': 'ULTRA 1080p+', 'gfx.high': 'ALTO',
    'levels.title': 'ESCOLHA A FASE', 'levels.diff': 'DIFICULDADE:', 'back': '← VOLTAR', 'heroes.title': 'HERÓIS DOS REELS', 'howto.title': 'COMO JOGAR',
    'howto.list': '<li>Soldados, tanques e magos marcham pelas estradas até a sua base. Cada vazamento custa seguidores ❤.</li><li>Escolha um herói embaixo e clique na grama para posicioná-lo. Você paga em likes 👍.</li><li>Clique num herói para evoluir (até o nível 3) ou vender.</li><li>Mate em sequência: o COMBO multiplica a recompensa.</li><li>A barra <b>MOMENTO VIRAL</b> enche com abates: aperte <b>Q</b> e limpe a tela.</li><li>Aliados do céu (à direita, <b>Z X C</b>): chame em qualquer ponto; cada um tem recarga.</li><li>Espaço: próxima onda antes (likes bônus). <b>F</b>: velocidade. Botão direito / roda: câmera.</li><li>Magos protegem aliados com escudos, tanques ignoram parte do dano. Hardcore 10/10 é para lendas.</li>',
    'hud.combo': 'COMBO x', 'hud.next': 'PRÓX. ONDA ⏭', 'hud.ult': 'MOMENTO VIRAL [Q]',
    'pause.title': 'PAUSA', 'pause.resume': 'CONTINUAR', 'pause.restart': 'REINICIAR', 'pause.quit': 'MENU', 'end.next': 'PRÓXIMO', 'end.menu': 'MENU',
    'lvl.banner': 'FASE {n}: {name}', 'wave.final': 'ONDA FINAL!', 'wave.n': 'ONDA {n}', 'boss': '⚠ CHEFÃO ⚠', 'combo.pop': 'COMBO x{n}!',
    'ult.banner': '🔥 MOMENTO VIRAL 🔥', 'wave.clear': 'ONDA CONCLUÍDA +{n}', 'ally.ready': 'PRONTO [{k}]', 'sec': 's',
    'end.win': 'VITÓRIA VIRAL!', 'end.lose': 'DEIXARAM DE TE SEGUIR...', 'end.stats': 'Dificuldade: {d} ({v}/10) · Abates: {k} · Vazamentos: {l}',
    'end.nextLevel': 'PRÓXIMA FASE', 'end.again': 'JOGAR DE NOVO', 'end.rematch': 'REVANCHE',
    'sel.dmg': 'Dano', 'sel.range': 'Alcance', 'sel.buff': 'Bônus', 'sel.perSec': '/s', 'sel.upgrade': 'EVOLUIR {c}👍', 'sel.max': 'MÁX', 'sel.sell': 'VENDER {c}',
    'card.waves': '{w} ondas · {p} entradas · {l} ❤', 'card.locked': '🔒 vença a fase anterior', 'card.price': 'Preço', 'card.dmg': 'Dano',
    'diff.info': 'Vida inimiga x{hp} · velocidade x{sp} · recompensa x{rw}', 'diff.lives': ' · vidas x0.5', 'loading': 'Carregando…',
  },
};

// Content names/descriptions per language, keyed by entity id. Russian lives in data.js.
const CONTENT = {
  en: {
    hero: { sigma: ['Sigma Mewer', 'Sniper. Silent mewing — and the target is gone. Huge range.'], rizz: ['Rizz Queen', 'Charm beam: slows and melts enemies. Strips mage shields.'], giga: ['Giga Gym Bro', 'Dumbbell ground slam. Area damage, stuns infantry.'], cat: ['Vibe Cat DJ', 'Bass drop hits everything nearby and buffs nearby heroes (+25% damage).'], baba: ['Babushka Chef', 'Lobs flaming frying pans. Explosion + burn. Great vs tanks.'] },
    level: { 1: 'Sunny Valley', 2: 'Trend Canyon', 3: 'Ice Citadel' },
    ally: { drone: ['Drone Operator', 'Hovers over a point for 14s and sprays everything nearby.'], llama: ['Para-Llama', 'Parachutes in: landing stuns everything around, then keeps spitting.'], meteor: ['Hype Meteor', 'A huge meteor: area blast and burn. Flattens even tanks.'] },
    diff: ['Chill', 'Light', 'Easy', 'Normal', 'Normal+', 'Tough', 'Painful', 'Nightmare', 'Hell', 'HARDCORE'],
  },
  es: {
    hero: { sigma: ['Sigma Mewer', 'Francotirador. Mewing en silencio y el objetivo desaparece. Alcance enorme.'], rizz: ['Reina del Rizz', 'Rayo de encanto: ralentiza y derrite enemigos. Quita escudos a los magos.'], giga: ['Giga Mamado', 'Golpe de mancuernas contra el suelo. Daño en área, aturde a la infantería.'], cat: ['Gato DJ Vibes', 'Drop de bajo a todo lo cercano y potencia a los héroes vecinos (+25% daño).'], baba: ['Abuela Chef', 'Lanza sartenes en llamas. Explosión + quemadura. Ideal contra tanques.'] },
    level: { 1: 'Valle Soleado', 2: 'Cañón de Tendencias', 3: 'Ciudadela de Hielo' },
    ally: { drone: ['Dron Operador', 'Sobrevuela un punto 14 s y dispara a todo lo cercano.'], llama: ['Llama Paracaidista', 'Cae en paracaídas: el aterrizaje aturde a todos y luego escupe.'], meteor: ['Meteoro Hype', 'Meteoro gigante: explosión en área y quemadura. Arrasa hasta tanques.'] },
    diff: ['Chill', 'Suave', 'Fácil', 'Normal', 'Normal+', 'Duro', 'Doloroso', 'Pesadilla', 'Infierno', 'HARDCORE'],
  },
  pt: {
    hero: { sigma: ['Sigma Mewer', 'Atirador. Mewing em silêncio e o alvo some. Alcance enorme.'], rizz: ['Rainha do Rizz', 'Raio de charme: desacelera e derrete inimigos. Remove escudos dos magos.'], giga: ['Giga Marombeiro', 'Pancada de halteres no chão. Dano em área, atordoa a infantaria.'], cat: ['Gato DJ Vibe', 'Drop de grave em tudo por perto e fortalece heróis vizinhos (+25% de dano).'], baba: ['Vovó Chef', 'Arremessa frigideiras em chamas. Explosão + queimadura. Ótima contra tanques.'] },
    level: { 1: 'Vale Ensolarado', 2: 'Cânion das Trends', 3: 'Cidadela de Gelo' },
    ally: { drone: ['Drone Operador', 'Paira sobre um ponto por 14 s e metralha tudo por perto.'], llama: ['Lhama Paraquedista', 'Desce de paraquedas: o pouso atordoa todos em volta e depois cospe.'], meteor: ['Meteoro do Hype', 'Meteoro gigante: explosão em área e queimadura. Destrói até tanques.'] },
    diff: ['Chill', 'Leve', 'Fácil', 'Normal', 'Normal+', 'Difícil', 'Dolorido', 'Pesadelo', 'Inferno', 'HARDCORE'],
  },
};

function detect(saved) {
  const ok = l => l && LANGS[l] ? l : null;
  const fromUrl = (() => { try { return new URLSearchParams(location.search).get('lang'); } catch { return null; } })();
  const nav = (navigator.languages || [navigator.language || 'en']).map(l => String(l).slice(0, 2).toLowerCase()).find(l => LANGS[l]);
  return ok(fromUrl) || ok(saved) || ok(window.STORE_LANG) || nav || 'en';
}

let lang = 'en';
export const getLang = () => lang;
export function initLang(saved) { lang = detect(saved); document.documentElement.lang = lang; return lang; }
export function setLang(l) { if (LANGS[l]) { lang = l; document.documentElement.lang = l; } }

export function t(key, vars = {}) {
  const s = (STR[lang] && STR[lang][key]) ?? STR.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
// Localized content: falls back to the Russian source text in data.js.
export const heroName = h => CONTENT[lang]?.hero[h.id]?.[0] ?? h.name;
export const heroDesc = h => CONTENT[lang]?.hero[h.id]?.[1] ?? h.desc;
export const levelName = l => CONTENT[lang]?.level[l.id] ?? l.name;
export const allyName = a => CONTENT[lang]?.ally[a.id]?.[0] ?? a.name;
export const allyDesc = a => CONTENT[lang]?.ally[a.id]?.[1] ?? a.desc;
export const diffName = (d, ruName) => CONTENT[lang]?.diff[d - 1] ?? ruName;

// Static markup: data-i18n → textContent, data-i18n-html → innerHTML.
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
}
