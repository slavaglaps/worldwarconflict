// Фейк-хост (новый дельта-протокол): keyframe → дельты с растущей голдой и меняющимся городом 0.
const WebSocket = require('ws');
const room = process.argv[2] || 'gtest';
const ws = new WebSocket('ws://localhost:3001/?room=' + room);
let t = 0, tick = 0;
function res() { const g = [], p = [], m = []; for (let i = 0; i < 30; i++) { g.push(200 + tick * 8 + i); p.push(10 + i); m.push(50 + i); } return { g, p, m }; }
ws.on('open', () => console.log('fakehost2 on room', room));
ws.on('message', d => { const x = JSON.parse(d); if (x.t === 'joinInfo') console.log('guest announced fid', x.fid); });
// keyframe сразу + раз в 3с
function keyframe() { const c = []; for (let i = 0; i < 143; i++) c.push([i, i % 5, 20 + (i % 30), 0, 0, 0]); const r = res(); ws.send(JSON.stringify({ t: 'snap', time: t, over: 0, ...r, c })); }
setTimeout(keyframe, 300);
setInterval(() => {
  t += 0.14; tick++;
  if (tick % 21 === 0) { keyframe(); return; }
  const r = res();
  // дельта: город 0 меняет гарнизон (растёт), иногда спец
  const dc = [[0, 1, 100 + tick, (tick > 20 ? 1 : 0), 0, 0]];
  ws.send(JSON.stringify({ t: 'snap', time: t, over: 0, ...r, dc }));
}, 140);
console.log('broadcasting keyframe+deltas...');
