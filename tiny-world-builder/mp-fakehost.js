// Фейковый хост: шлёт растущую голду + одну движущуюся армию, чтобы проверить,
// что реальный гость в браузере применяет снапшоты (gold растёт, появляется ghost).
const WebSocket = require('ws');
const room = process.argv[2] || 'live1';
const ws = new WebSocket('ws://localhost:3001/?room=' + room);
let t = 0, tick = 0;
ws.on('open', () => console.log('fakehost connected to room', room));
ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'hello') console.log('fakehost id', m.id, 'host?', m.host); });
setInterval(() => {
  t += 0.2; tick++;
  const g = [], p = [], mp = [];
  for (let i = 0; i < 30; i++) { g.push(100 + tick * 5 + i); p.push(10 + i); mp.push(50 + i); }
  // реальные 143 города: владелец/юниты/спец/тир/occ. Меняем спец и владельца со временем
  const c = [];
  for (let i = 0; i < 143; i++) {
    const owner = (i % 4 === 0) ? 5 : (i % 3 === 0 ? 19 : (i % 5));
    const spec = (tick > 10 && i % 7 === 0) ? ((Math.floor(tick / 10) % 3) + 1) : 0; // меняется → buildMeshes у гостя
    const tier = (tick > 15 && i % 11 === 0) ? 1 : 0;
    c.push([owner, 20 + (i % 30), spec, tier, 0]);
  }
  ws.send(JSON.stringify({ t: 'snap', time: t, over: 0, c, g, p, m: mp, rel: [['5_19', 'war']], ws: [['5_19', 1]] }));
  // одна армия фракции 19, едет по кругу
  const x = 70 + Math.cos(tick / 5) * 10, z = 70 + Math.sin(tick / 5) * 10;
  ws.send(JSON.stringify({ t: 'ent', e: [[1, 0, 19, x, 3, z, 25]] }));
}, 200);
console.log('fakehost broadcasting snap+ent every 200ms (gold growing)…');
