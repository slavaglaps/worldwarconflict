// Персистентный Node-гость (фракция 19). Подключается, объявляет фракцию,
// шлёт команды и ОСТАЁТСЯ онлайн, чтобы хост можно было инспектировать вживую.
const WebSocket = require('ws');
const MYFID = 19;
const ws = new WebSocket('ws://localhost:3001/?room=testh');
ws.on('open', () => console.log('guest connecting...'));
ws.on('message', d => {
  const m = JSON.parse(d);
  if (m.t === 'hello') {
    console.log('guest hello id', m.id);
    ws.send(JSON.stringify({ t: 'joinInfo', fid: MYFID, country: 'Россия' }));
    console.log('→ joinInfo fid=19 отправлен');
    setTimeout(() => { ws.send(JSON.stringify({ t: 'cmd', cmd: 'war', tg: 5 })); console.log('→ cmd war vs 5'); }, 2500);
    setTimeout(() => { ws.send(JSON.stringify({ t: 'cmd', cmd: 'upg', c: 108, track: 'prod' })); console.log('→ cmd upg city108'); }, 3000);
    setTimeout(() => { ws.send(JSON.stringify({ t: 'cmd', cmd: 'army', a: 108, b: 117, pct: 50 })); console.log('→ cmd army 108→117'); }, 3500);
  }
});
ws.on('close', () => { console.log('guest closed'); process.exit(0); });
console.log('persistent guest running (60s)...');
setTimeout(() => { ws.close(); }, 60000);
