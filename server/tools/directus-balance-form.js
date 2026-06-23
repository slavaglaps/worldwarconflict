#!/usr/bin/env node
// Генератор формы баланса в Directus: создаёт collapsible-группы + поля (числа/слайдеры) из balance-fields.js.
// Колонки создаёт сам Directus (POST /fields с schema.default_value). Идемпотентно (DELETE→POST).
// Аргумент: фильтр секции (pol|ai|tune) — для проверки на маленьком объёме. Без аргумента — все.
'use strict';
const F = require('../balance-fields');
const URL = process.env.DIRECTUS_URL || 'https://wwc-directus.onrender.com';
const TOK = process.env.DIRECTUS_TOKEN;   // НИКОГДА не хардкодим токен (был утечён → ОБЯЗАТЕЛЬНО ротировать в Directus). Только env.
if (!TOK) { console.error('✗ DIRECTUS_TOKEN не задан. Запуск: DIRECTUS_TOKEN=<token> node tools/directus-balance-form.js'); process.exit(1); }
const only = process.argv[2];   // 'pol' | 'ai' | 'tune' | undefined

const GID = {
  'Дипломатия': 'diplomacy', 'Поведение ИИ': 'ai_behavior', 'Карта / прочее': 'misc', 'Лимиты': 'caps',
  'Найм / манпауэр': 'recruit', 'Флот': 'navy', 'Авиация': 'air', 'Герои': 'heroes',
  'Стройка / прокачка': 'building', 'Башни atk-городов': 'towers', 'ПВО': 'aa_def',
  'Город (экономика/ёмкость)': 'city', 'Бой / осада': 'combat',
};
const gid = (g) => GID[g] || g.replace(/\W+/g, '_').toLowerCase();

async function api(method, path, body) {
  const r = await fetch(URL + path, { method, headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
  return { ok: r.ok, status: r.status, j, txt };
}
async function ensure(def) {
  await api('DELETE', '/fields/balance/' + def.field);                 // снести старое (нет — 404, игнор)
  const r = await api('POST', '/fields/balance', def);
  if (!r.ok) console.log('  ✗', def.field, r.status, (r.txt || '').replace(/\s+/g, ' ').slice(0, 140));
  return r.ok;
}

(async () => {
  const fields = F.ALL.filter((f) => !only || f.section === only);
  const groups = [...new Set(fields.map((f) => f.group))];
  console.log(`Directus: ${URL} | секций=${only || 'все'} | групп=${groups.length} полей=${fields.length}`);

  let sort = 1, okG = 0;
  for (const g of groups) {                                            // 1) группы-аккордеоны
    if (await ensure({ field: gid(g), type: 'alias', meta: { interface: 'group-detail', special: ['alias', 'no-data', 'group'], sort: sort++, note: g, options: { start: 'open' } } })) okG++;
  }
  console.log(`группы: ${okG}/${groups.length}`);

  let okF = 0;
  for (const f of fields) {                                            // 2) поля параметров
    const ok = await ensure({
      field: f.col, type: f.type,
      schema: { default_value: f.def },
      meta: { interface: f.interface, options: f.options || {}, group: gid(f.group), sort: f.sort, note: f.note, width: 'half' },
    });
    if (ok) okF++;
  }
  console.log(`поля: ${okF}/${fields.length}`);
})();
