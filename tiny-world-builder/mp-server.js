// ── Voxel Wars — локальный WebSocket-релей для мультиплеера ──
// Транспорт абстрагирован: клиент шлёт JSON, сервер просто разводит сообщения
// по комнате. Первый вошедший в комнату = хост (авторитетная симуляция у него).
// Запуск:  node mp-server.js [порт]      (по умолчанию 3001)
// Позже под интернет можно заменить на PartyKit/хостинг без правок игры.
const { WebSocketServer } = require('ws');
const PORT = +process.argv[2] || 3001;
const wss = new WebSocketServer({ port: PORT });
const rooms = new Map(); // roomId -> { host: ws|null, clients: Set<ws> }
let nextId = 1;

const roomOf = req => {
  try { return (new URL(req.url, 'http://x').searchParams.get('room') || 'default').slice(0, 40); }
  catch { return 'default'; }
};
const send = (ws, obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };
function broadcast(room, obj, except) {
  const s = JSON.stringify(obj);
  for (const c of room.clients) if (c !== except && c.readyState === 1) { try { c.send(s); } catch {} }
}

wss.on('connection', (ws, req) => {
  const roomId = roomOf(req);
  let room = rooms.get(roomId);
  if (!room) { room = { host: null, clients: new Set() }; rooms.set(roomId, room); }
  ws.id = nextId++; ws.roomId = roomId;
  room.clients.add(ws);
  const isHost = !room.host;
  if (isHost) room.host = ws;

  send(ws, { t: 'hello', id: ws.id, host: isHost, hostId: room.host.id, room: roomId,
             peers: [...room.clients].filter(c => c !== ws).map(c => c.id) });
  broadcast(room, { t: 'join', id: ws.id, hostId: room.host.id }, ws);
  console.log(`[${roomId}] +client ${ws.id}${isHost ? ' (host)' : ''} · всего ${room.clients.size}`);

  ws.on('message', data => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    msg.from = ws.id;
    if (msg.to) { for (const c of room.clients) if (c.id === msg.to) { send(c, msg); break; } }
    else broadcast(room, msg, ws);
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    const wasHost = room.host === ws;
    if (wasHost) room.host = room.clients.values().next().value || null;
    if (room.clients.size === 0) { rooms.delete(roomId); return; }
    broadcast(room, { t: 'leave', id: ws.id, host: wasHost, hostId: room.host ? room.host.id : 0 });
    console.log(`[${roomId}] -client ${ws.id}${wasHost ? ' (был хостом)' : ''} · осталось ${room.clients.size}`);
  });
});
console.log(`Voxel Wars MP-релей: ws://localhost:${PORT}   (комната через ?room=ID)`);
