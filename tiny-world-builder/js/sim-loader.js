/* ── Загрузчик серверного симулятора в браузере (Фаза 2) ──────────────────
   Соло гоняет НАСТОЯЩИЙ server/sim/ (синканный в tiny-world-builder/sim/).
   CSP-safe: НЕ eval/new Function — модули склеиваются в один инлайн-<script>
   с мини-CommonJS-обёрткой (как игровой бандл, 'unsafe-inline' разрешён).
   Возвращает {Sim, makeBalance, makeConstants, factionBal, water, tech}.
   Вызывается лениво (только когда соло реально стартует локальный сим). */
async function loadServerSim(base) {
  if (window.__WWCSim) return window.__WWCSim;
  base = base || 'sim/';
  // порядок = граф require (зависимости раньше зависимых)
  const ORDER = ['constants', 'tech-data', 'water-data.json', 'water', 'tech',
                 'balance', 'SpatialGrid', 'Squad', 'Ship', 'Plane', 'City', 'Sim'];
  const parts = [
    '(function(){',
    'var __M={};',
    'function __req(p){var k=p.replace(/^\\.\\//,"").replace(/\\.js$/,"");if(k in __M)return __M[k];throw new Error("sim require: "+p+" не найден");}',
  ];
  for (const name of ORDER) {
    const isJson = /\.json$/.test(name);
    const url = base + name + (isJson ? '' : '.js');
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
    const text = await r.text();
    if (isJson) {
      parts.push('__M[' + JSON.stringify(name) + ']=(' + text + ');');
    } else {
      // CommonJS-обёртка: module/exports/require внедряются; require резолвит из уже собранных __M
      parts.push('__M[' + JSON.stringify(name) + ']=(function(){var module={exports:{}};(function(module,exports,require){\n'
        + text + '\n})(module,module.exports,__req);return module.exports;})();');
    }
  }
  parts.push('window.__WWCSim={Sim:__M["Sim"].Sim,makeBalance:__M["balance"].makeBalance,'
    + 'makeConstants:__M["balance"].makeConstants,factionBal:__M["balance"].factionBal,'
    + 'deepMerge:__M["balance"].deepMerge,water:__M["water"],tech:__M["tech"]};');
  parts.push('})();');

  const s = document.createElement('script');
  s.textContent = parts.join('\n');     // инлайн-скрипт исполняется синхронно при append
  document.head.appendChild(s);
  if (!window.__WWCSim) throw new Error('serverSim: сборка не дала window.__WWCSim (см. консоль)');
  return window.__WWCSim;
}
