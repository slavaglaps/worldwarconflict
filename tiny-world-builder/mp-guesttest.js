// Node-гость: подключается к ЖИВОМУ браузерному хосту, объявляет фракцию 19,
// шлёт команды upg/buy/war и проверяет результат по снапшотам хоста.
const WebSocket = require('ws');
const MYFID = 19, CITY = 108;
const ws = new WebSocket('ws://localhost:3001/?room=testh');
let snap = null, init = {}, warTarget = null;

ws.on('message', d => {
  const m = JSON.parse(d);
  if (m.t === 'hello') { console.log('guest hello id', m.id, 'host?', m.host);
    ws.send(JSON.stringify({ t: 'joinInfo', fid: MYFID, country: 'Россия' })); }
  if (m.t === 'snap') snap = m;
});

setTimeout(() => {
  if (!snap) { console.log('❌ НЕТ СНАПШОТА — хост не вещает'); process.exit(1); }
  init.gold = snap.g[MYFID]; init.tier = snap.c[CITY][3]; init.units = snap.c[CITY][1]; init.spec = snap.c[CITY][2];
  const owners = new Set(snap.c.map(x => x[0]));
  const atWarWith = new Set();
  snap.rel.forEach(([k, v]) => { if (v === 'war') { const ns = k.match(/\d+/g).map(Number); if (ns.includes(MYFID)) atWarWith.add(ns.find(x => x !== MYFID)); } });
  warTarget = [...owners].find(f => f !== MYFID && !atWarWith.has(f));
  console.log('init city108:', init, '| warTarget:', warTarget);
  ws.send(JSON.stringify({ t: 'cmd', cmd: 'upg', c: CITY, track: 'prod' }));
  ws.send(JSON.stringify({ t: 'cmd', cmd: 'buy', c: CITY, spec: '10' }));
  if (warTarget != null) ws.send(JSON.stringify({ t: 'cmd', cmd: 'war', tg: warTarget }));
  console.log('→ отправлены команды: upg(prod), buy(10), war(' + warTarget + ')');
}, 1800);

setTimeout(() => {
  const s = snap;
  const tierNow = s.c[CITY][3], unitsNow = s.c[CITY][1], goldNow = s.g[MYFID];
  let warNow = false;
  s.rel.forEach(([k, v]) => { if (v === 'war') { const ns = k.match(/\d+/g).map(Number); if (ns.includes(MYFID) && ns.includes(warTarget)) warNow = true; } });
  console.log('\n=== РЕЗУЛЬТАТ КОМАНД ГОСТЯ (через хоста) ===');
  console.log('UPGRADE  тир', init.tier, '->', tierNow, tierNow > init.tier ? '✅' : '❌');
  console.log('BUY      гарнизон', init.units, '->', unitsNow, '| голда', init.gold, '->', goldNow, goldNow < init.gold ? '✅' : '⚠');
  console.log('WAR      vs ' + warTarget + ':', warNow ? 'ВОЙНА ✅' : 'нет ❌');
  const ok = tierNow > init.tier && warNow;
  console.log(ok ? '\nКОМАНДЫ ГОСТЯ ПРИМЕНЯЮТСЯ ХОСТОМ ✅' : '\nЕСТЬ ПРОБЛЕМА ❌');
  ws.close(); process.exit(ok ? 0 : 1);
}, 6500);
