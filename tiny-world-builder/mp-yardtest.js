// Node-гость (фракция 19): шлёт команды постройки верфи+аэропорта, ловит newcity.
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/?room=buildtest');
let newcities = [];
ws.on('message', d => {
  const m = JSON.parse(d);
  if (m.t === 'hello') { console.log('guest id', m.id); ws.send(JSON.stringify({ t: 'joinInfo', fid: 19, country: 'Россия' }));
    setTimeout(() => { ws.send(JSON.stringify({ t: 'cmd', cmd: 'yard', c: 117, kind: 'ship' })); console.log('→ cmd yard ship @117'); }, 2000);
    setTimeout(() => { ws.send(JSON.stringify({ t: 'cmd', cmd: 'yard', c: 108, kind: 'plane' })); console.log('→ cmd yard plane @108'); }, 2600);
  }
  if (m.t === 'newcity') { newcities.push(m); console.log('✅ newcity:', m.name, 'idx', m.idx, 'owner', m.owner, 'kind', m.kind); }
});
setTimeout(() => { console.log('\nполучено newcity-сообщений:', newcities.length); ws.close(); process.exit(0); }, 7000);
console.log('yard-test guest running...');
