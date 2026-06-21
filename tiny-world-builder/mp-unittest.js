// Node-гость (фракция 19): ловит id корабля из ent, шлёт приказ движения + приказ бомбить.
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/?room=unittest');
let shipId = null, sentMove = false, sentAir = false;
ws.on('message', d => {
  const m = JSON.parse(d);
  if (m.t === 'hello') { console.log('guest id', m.id); ws.send(JSON.stringify({ t: 'joinInfo', fid: 19, country: 'Россия' })); }
  if (m.t === 'ent') {
    const ship = m.e.find(x => x[1] === 1 && x[2] === 19); // kind=1 (корабль), owner=19
    if (ship && !shipId) { shipId = ship[0]; console.log('нашёл корабль id', shipId, 'на', ship[3].toFixed(1), ship[5].toFixed(1)); }
  }
});
setTimeout(() => {
  if (shipId == null) { console.log('❌ корабль не виден в ent'); }
  else { ws.send(JSON.stringify({ t: 'cmd', cmd: 'shipmove', ids: [shipId], x: 213, z: 174 })); sentMove = true; console.log('→ cmd shipmove → (213,174)'); }
  ws.send(JSON.stringify({ t: 'cmd', cmd: 'airorder', fromIdx: 143, cityIdx: 0, x: 0, z: 0 })); sentAir = true; console.log('→ cmd airorder bomb city0');
}, 2500);
setTimeout(() => { console.log('\nотправлено: move=' + sentMove + ' air=' + sentAir); ws.close(); process.exit(0); }, 6000);
console.log('unit-control guest running...');
