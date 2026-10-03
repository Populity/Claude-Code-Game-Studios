/** Save data: shape, defaults, corrupt-storage fallback, persistence on progress events. */
const fs = require('fs'), path = require('path');
const { makeEngine } = require('../lib/engine');
const { test, assert, report } = require('../lib/harness');
const KEY = 'tessera_save_v1';
function boot(storage) {
  const quiet = { log() {}, warn() {}, error: console.error };
  const eng = makeEngine({ storage, console: quiet, extra: ['world/drone.js', 'world/party.js', 'ui/dialogue.js', 'ui/menu.js', 'ui/puzzles.js', 'story/script.js'] });
  for (const f of fs.readdirSync(path.join(__dirname, '../../src/js/levels'))) if (f !== 'order.js') eng.load('levels/' + f);
  eng.load('levels/order.js');
  eng.load('game.js');
  return eng;
}
const flush = (G, n = 200) => { for (let i = 0; i < n; i++) G.App.update(1 / 60); };

test('fresh save has the documented shape and defaults', () => {
  const { G } = boot({});
  assert.eq(JSON.stringify(Object.keys(G.save).sort()), JSON.stringify(['abilities', 'best', 'current', 'deaths', 'party', 'shards', 'unlocked']));
  assert.eq(G.save.unlocked, 0); assert.eq(G.save.current, 0); assert.eq(G.save.deaths, 0);
  assert.eq(typeof G.save.shards, 'object'); assert.eq(typeof G.save.best, 'object');
});
test('corrupt JSON in storage falls back to defaults (no crash)', () => {
  const { G } = boot({ [KEY]: '{not json' });
  assert.eq(G.save.unlocked, 0);
});
test('partial old save is merged with defaults', () => {
  const { G } = boot({ [KEY]: JSON.stringify({ unlocked: 4, current: 3 }) });
  assert.eq(G.save.unlocked, 4); assert(G.save.shards && G.save.best && G.save.deaths === 0);
});
test('persist() writes JSON round-trippable save', () => {
  const st = {}; const { G } = boot(st);
  G.save.deaths = 7; G.persist();
  const back = JSON.parse(st[KEY]); assert.eq(back.deaths, 7);
  assert(st.tessera_settings_v1, 'settings persisted too');
});
test('LEVEL_ORDER has all 15 campaign levels in order with 5 cutscenes', () => {
  const { G } = boot({});
  assert.eq(G.LEVEL_ORDER.map((e) => e.id).join(','), 'p1,p2,l01,l02,l03,l04,l05,l06,l07,l08,l09,l10,l11,l12,l13');
  assert.eq(G.LEVEL_ORDER.filter((e) => e.before || e.after).map((e) => e.before || e.after).join(','), 'intro,crash,ending,ch2_intro,ch2_end');
  for (const c of ['intro', 'crash', 'ending', 'ch2_intro', 'ch2_end']) assert(G.Cutscenes[c] && G.Cutscenes[c].length, 'cutscene ' + c);
});
test('afterLevel(i) unlocks/advances and persists; final level leads to credits', () => {
  const st = {}; const { G } = boot(st);
  G.App.setNow(new G.TitleScene());
  for (let i = 0; i < G.LEVEL_ORDER.length; i++) {
    G.App.afterLevel(i);
    assert.eq(G.save.current, i + 1, 'current after ' + i); assert(G.save.unlocked >= i + 1, 'unlocked after ' + i);
    assert.eq(JSON.parse(st[KEY]).current, i + 1, 'persisted current ' + i);
    flush(G);
    const sc = G.App.scene;
    const entry = G.LEVEL_ORDER[i];
    if (i === G.LEVEL_ORDER.length - 1) { assert(sc instanceof G.CutsceneScene, 'ending cutscene expected'); sc.cs.end(); flush(G); assert(G.App.scene instanceof G.CreditsScene, 'credits'); }
    else if (entry.after || G.LEVEL_ORDER[i + 1].before) {
      assert(sc instanceof G.CutsceneScene, 'cutscene after ' + entry.id); sc.cs.end(); flush(G);
      if (entry.after && G.LEVEL_ORDER[i + 1].before) { assert(G.App.scene instanceof G.CutsceneScene, 'second cutscene'); G.App.scene.cs.end(); flush(G); }
      assert(G.App.scene instanceof G.GameScene && G.App.scene.index === i + 1, 'level after cutscene');
    }
    else assert(sc instanceof G.GameScene && sc.index === i + 1, `level ${i + 1} expected after ${entry.id}, got ${sc && sc.constructor.name}`);
  }
});
test('collectShard and completeLevel record shards/best time', () => {
  const st = {}; const { G } = boot(st);
  const gs = new G.GameScene(2);
  const s = gs.level.entities.find((e) => e.type === 'shard');
  gs.collectShard(s); gs.collectShard(s);
  assert.eq(JSON.stringify(G.save.shards.l01), JSON.stringify([s.index]), 'no duplicate shard');
  gs.time = 42; gs.completeLevel();
  assert.eq(G.save.best.l01, 42); assert.eq(JSON.parse(st[KEY]).best.l01, 42);
  const gs2 = new G.GameScene(2);
  assert(gs2.level.entities.find((e) => e.type === 'shard' && e.index === s.index).collected, 'collected shard stays collected on replay');
});
test('Continue resumes saved level; New Game resets current to 0', () => {
  const { G } = boot({ [KEY]: JSON.stringify({ unlocked: 5, current: 5 }) });
  const t = new G.TitleScene();
  assert.eq(t.menu.items[0].label, 'Продолжить');
  t.menu.items[1].action(); assert.eq(G.save.current, 0);
});
report('save');
