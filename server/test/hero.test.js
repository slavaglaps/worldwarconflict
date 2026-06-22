// ИСЧЕРПЫВАЮЩИЕ ТЕСТЫ ГЕРОЕВ: все страны (карта) × все герои пула × все скилы (пассивы + каждая
// активка с проверкой реального эффекта, кулдауна и блокировки повторного применения). Data-driven
// по DEFAULTS.heroes.pool — если добавишь/поменяешь героя в балансе, тесты подхватят автоматически.
const { Sim } = require('../sim/Sim');
const { DEFAULTS } = require('../sim/balance');
const map = require('../sim/map-data.json');
const { group, test, assert, eq, near, gt, lt, summary } = require('./harness');

const POOL = DEFAULTS.heroes.pool;
const MOD_BRANCHES = new Set(['atk', 'def', 'speed', 'eco', 'prod']);   // в techMul; прочие ключи (bd/ph/...) — в techVal
const acc = (s, fid, key) => (MOD_BRANCHES.has(key) ? s.techMul(fid, key) : s.techVal(fid, key));
// сим, где у фракции 0 ТОЛЬКО заданный герой, у фракции 1 — нет героев
const heroSim = (id, opts = {}) => new Sim({ factions: 2, cities: 4, warPrep: 0, ...opts, balance: { factionDefault: { heroes: [] }, factions: { 0: { heroes: [id] } } } });
const ownCities = (s, f) => s.cities.filter((c) => c.owner === f);
const enemyCity = (s, f) => s.cities.find((c) => c.owner !== f);

// ── ВСЕ СТРАНЫ ──────────────────────────────────────────────────────────────
group('Герои: ВСЕ страны (карта) получают валидных героев');
test('каждая из 24 стран авто-получает героев из пула, все id валидны', () => {
  const s = new Sim({ map });
  gt(s.factions, 20, 'страны на карте');
  for (let f = 0; f < s.factions; f++) {
    assert(s.heroSlots[f] && s.heroSlots[f].length > 0, `у страны ${f} есть герои`);
    for (const h of s.heroSlots[f]) assert(POOL[h.id], `страна ${f}: герой "${h.id}" есть в пуле`);
  }
});
test('у каждой страны пассивы её героев реально применяются', () => {
  const s = new Sim({ map });
  for (let f = 0; f < s.factions; f++) {
    const want = {};   // суммарные пассивы героев страны по ключам
    for (const h of s.heroSlots[f]) for (const ab of POOL[h.id].abilities) if (ab.kind === 'passive') for (const p of ab.pass) want[p.key] = (want[p.key] || 0) + p.add;
    for (const key in want) near(acc(s, f, key), 1 + want[key], 1e-6, `страна ${f}: пассив ${key} = +${want[key]}`);
  }
});

// ── ВСЕ ПАССИВЫ ─────────────────────────────────────────────────────────────
group('Герои: ВСЕ пассивы (по каждому герою)');
for (const [id, def] of Object.entries(POOL)) {
  const passes = def.abilities.filter((a) => a.kind === 'passive').flatMap((a) => a.pass || []);
  if (!passes.length) continue;
  test(`${id} (${def.name}): пассив(ы) ${passes.map((p) => p.key + '+' + p.add).join(', ')} — есть у своей страны, нет у чужой`, () => {
    const s = heroSim(id);
    for (const p of passes) {
      near(acc(s, 0, p.key), 1 + p.add, 1e-6, `своя страна: ${p.key} +${p.add}`);
      near(acc(s, 1, p.key), 1, 1e-6, `чужая страна (без героя): ${p.key} без бонуса`);
    }
  });
}

// ── ВСЕ АКТИВКИ ─────────────────────────────────────────────────────────────
group('Герои: ВСЕ активки (эффект + кулдаун + блок повтора), по каждому скилу');
for (const [id, def] of Object.entries(POOL)) {
  const actives = def.abilities.filter((a) => a.kind === 'active');
  actives.forEach((ab, ai) => {
    test(`${id} · «${ab.name}» (${ab.fx.type}) — эффект + КД`, () => {
      const s = heroSim(id);
      const cd0 = () => s.heroSlots[0][0].cd[ai];

      if (ab.fx.type === 'gold') {
        const g = s.gold[0];
        assert(s.cmdHeroAbility(0, 0, ai), 'применилась');
        eq(s.gold[0], g + ab.fx.amount, `+${ab.fx.amount} голды`);
        gt(cd0(), 0, 'КД выставлен'); eq(s.cmdHeroAbility(0, 0, ai), false, 'повтор на КД → отказ');

      } else if (ab.fx.type === 'manpower') {
        s.manpower[0] = 0;
        assert(s.cmdHeroAbility(0, 0, ai), 'применилась');
        near(s.manpower[0], s.manpowerCap(0), 1e-6, 'манпауэр до потолка');
        gt(cd0(), 0, 'КД'); eq(s.cmdHeroAbility(0, 0, ai), false, 'повтор → отказ');

      } else if (ab.fx.type === 'garrison') {
        const own = ownCities(s, 0); const before = own.map((c) => c.units);
        assert(s.cmdHeroAbility(0, 0, ai), 'применилась');
        own.forEach((c, i) => gt(c.units, before[i], `+гарнизон в город ${c.idx}`));
        gt(cd0(), 0, 'КД'); eq(s.cmdHeroAbility(0, 0, ai), false, 'повтор → отказ');

      } else if (ab.fx.type === 'buff') {
        const key = ab.fx.key, base = acc(s, 0, key);
        assert(s.cmdHeroAbility(0, 0, ai), 'применилась');
        near(acc(s, 0, key), base + ab.fx.add, 1e-6, `бафф +${ab.fx.add} к ${key}`);
        gt(cd0(), 0, 'КД'); eq(s.cmdHeroAbility(0, 0, ai), false, 'повтор → отказ');
        for (let t = 0; t < ab.fx.dur + 2; t++) s.tick(1.0);
        near(acc(s, 0, key), base, 1e-6, 'бафф истёк → вернулось к базе');

      } else if (ab.fx.type === 'airstrike') {
        eq(s.cmdHeroAbility(0, 0, ai), false, 'без войны → отказ');
        eq(cd0(), 0, 'без войны КД не потрачен');
        s.setWar(0, 1); const e = enemyCity(s, 0); const u = e.units;
        assert(s.cmdHeroAbility(0, 0, ai), 'в войне → применилась');
        lt(e.units, u, 'гарнизон врага упал');
        gt(cd0(), 0, 'КД'); eq(s.cmdHeroAbility(0, 0, ai), false, 'повтор → отказ');

      } else {
        assert(false, `неизвестный тип эффекта: ${ab.fx.type}`);
      }
    });
  });
}

// ── кулдаун истекает → можно снова ──
group('Герои: кулдаун истекает → активка снова доступна');
test('после истечения КД активку можно применить повторно', () => {
  const s = heroSim('gold');   // gold·Золотой дождь, cd 40
  assert(s.cmdHeroAbility(0, 0, 0), 'первый раз');
  eq(s.cmdHeroAbility(0, 0, 0), false, 'сразу — на КД');
  const cd = POOL.gold.abilities.filter((a) => a.kind === 'active')[0].cd;
  for (let t = 0; t < cd + 1; t++) s.tick(1.0);
  assert(s.cmdHeroAbility(0, 0, 0), 'после КД — снова можно');
});

summary('HEROES (все страны × все скилы)');
