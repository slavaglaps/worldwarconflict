// E2E-тест транспорта: эмулируем хоста и гостя как ws-клиентов релея.
// Проверяем: hello, широковещание snap (host→guest), команда (guest→host).
const WebSocket = require('ws');
const URL = 'ws://localhost:3001/?room=testroom';
const log = (who, ...a) => console.log(`[${who}]`, ...a);
let hostGotCmd = false, guestGotSnap = false, guestGotEnt = false;

const host = new WebSocket(URL);
const guest = new WebSocket(URL);

host.on('message', d => {
  const m = JSON.parse(d);
  if (m.t === 'hello') log('HOST', 'hello id=' + m.id + ' hostId=' + m.hostId);
  if (m.t === 'cmd') { hostGotCmd = true; log('HOST', '✅ получил команду:', JSON.stringify({cmd:m.cmd,tg:m.tg,from:m.from})); }
});
guest.on('message', d => {
  const m = JSON.parse(d);
  if (m.t === 'hello') log('GUEST', 'hello id=' + m.id + ' hostId=' + m.hostId);
  if (m.t === 'snap') { guestGotSnap = true; log('GUEST', '✅ получил snap, g=' + JSON.stringify(m.g)); }
  if (m.t === 'ent')  { guestGotEnt = true;  log('GUEST', '✅ получил ent, сущностей=' + m.e.length); }
});

// host вещает снапшот и сущности (как браузерный хост)
setTimeout(() => {
  host.send(JSON.stringify({ t: 'snap', time: 5, over: 0, g: [10, 20, 30], p: [1,2,3], m: [4,5,6], c: [], rel: [], ws: [] }));
  host.send(JSON.stringify({ t: 'ent', e: [[1, 0, 19, 5, 1, 6, 12]] }));
  log('HOST', 'отправил snap + ent (broadcast)');
}, 600);

// guest шлёт команду войны (как браузерный гость — широковещательно)
setTimeout(() => {
  guest.send(JSON.stringify({ t: 'cmd', cmd: 'war', tg: 5 }));
  guest.send(JSON.stringify({ t: 'joinInfo', fid: 7, country: 'Германия' }));
  log('GUEST', 'отправил cmd war + joinInfo');
}, 1100);

setTimeout(() => {
  console.log('\n=== РЕЗУЛЬТАТ ===');
  console.log('guest получил snap:', guestGotSnap ? 'ДА ✅' : 'НЕТ ❌');
  console.log('guest получил ent :', guestGotEnt ? 'ДА ✅' : 'НЕТ ❌');
  console.log('host получил cmd  :', hostGotCmd ? 'ДА ✅' : 'НЕТ ❌');
  const ok = guestGotSnap && guestGotEnt && hostGotCmd;
  console.log(ok ? '\nТРАНСПОРТ РАБОТАЕТ ✅' : '\nТРАНСПОРТ СЛОМАН ❌');
  host.close(); guest.close(); process.exit(ok ? 0 : 1);
}, 2000);
