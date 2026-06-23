// GUARD: клиентская карта (CITY_LIST в js/data.js, проекция lon/lat→грид + вывод
// столиц/верфей) обязана совпадать с серверной map-data.json (cities). Две карты
// держатся раздельно (клиент — гео-источник lon/lat; сервер — спроецированный
// рантайм-меш + дорожный граф), поэтому НЕ codegen, а сверка: тест падает, если
// города/координаты/размеры/страны/столицы/верфи разошлись.
//
// ⚠️ НЕ покрывает дорожный граф (edges): клиент строит свой в roads.js,
//    сервер хранит 240 рёбер в map-data.json — независимые построения, отдельная фаза.
const { group, test, assert, eq, summary } = require('./harness');
const fs = require('fs');
const path = require('path');
const MAP = require('../sim/map-data.json');

group('Single-source карты (client CITY_LIST ⟷ server map-data.json)');

// ── извлечь CITY_LIST и проекцию из клиентского data.js ──
const dataJs = fs.readFileSync(path.join(__dirname, '..', '..', 'tiny-world-builder', 'js', 'data.js'), 'utf8');
const P = 0, N = 0, E = 0;                                       // плейсхолдеры колонки владельца в CITY_LIST
const CITY_LIST = eval(dataJs.match(/const\s+CITY_LIST\s*=\s*(\[[\s\S]*?\n\];)/)[1].replace(/;$/, ''));
const num = (name) => Number(dataJs.match(new RegExp(name + '\\s*=\\s*(-?\\d+(?:\\.\\d+)?)'))[1]);
const LON0 = num('LON0'), LON1 = num('LON1'), LAT0 = num('LAT0'), LAT1 = num('LAT1'), GRID = 256;
const proj = (c) => [Math.round((c[1] - LON0) / (LON1 - LON0) * GRID), Math.round((LAT1 - c[2]) / (LAT1 - LAT0) * GRID)];

// клиентские деривации (как в коде): столица = первый город страны; верфь/аэропорт — по имени
const SHIPYARD_NAMES = new Set(['Верфь Бордо']);
const AIRPORT_NAMES = new Set(['Аэропорт Париж']);
const seenCountry = new Set();
const clientCities = CITY_LIST.map((c) => {
  const [gx, gz] = proj(c);
  const capital = !seenCountry.has(c[5]); seenCountry.add(c[5]);
  return { name: c[0], gx, gz, size: c[3], country: c[5], capital, shipyard: SHIPYARD_NAMES.has(c[0]), airport: AIRPORT_NAMES.has(c[0]) };
});

test('одинаковое число городов', () => eq(clientCities.length, MAP.cities.length));

test('проекция/имена/размеры/страны/столицы/верфи совпадают город-в-город', () => {
  const pick = (s) => ({ name: s.name, gx: s.gx, gz: s.gz, size: s.size, country: s.country, capital: !!s.capital, shipyard: !!s.shipyard, airport: !!s.airport });
  const diffs = [];
  for (let i = 0; i < MAP.cities.length; i++) {
    const a = JSON.stringify(pick(clientCities[i] || {})), b = JSON.stringify(pick(MAP.cities[i] || {}));
    if (a !== b) diffs.push(`[${i}] client ${a} vs server ${b}`);
  }
  assert(diffs.length === 0, 'карта разошлась (обнови CITY_LIST в data.js ИЛИ server/sim/map-data.json):\n  ' + diffs.slice(0, 8).join('\n  '));
});

test('порядок стран (= faction id) совпадает', () => {
  const clientOrder = [...new Set(CITY_LIST.map((c) => c[5]))];
  const serverOrder = MAP.factions.map((f) => f.country);
  eq(JSON.stringify(clientOrder), JSON.stringify(serverOrder));
});

summary('MAP-SYNC (client ⟷ server map)');
