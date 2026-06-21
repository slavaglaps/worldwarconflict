// Unit tests for the PartyKit multiplayer room server (party/index.js).
// Run with: npm run test:unit   (node --test, zero extra deps)
//
// Covers the security-critical, pure-logic core: input validation, role/edit
// gating, the lobby/host state machine, and rate limiting. These run in plain
// Node (no browser/THREE), which is exactly why the server is the right first
// unit-test target.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import TinyWorldParty, {
  cleanText, cleanNumber, cleanVec3, cleanPresence, cleanCell, cleanCellSet,
  cleanRole, cleanIsland, clampFloors, inIsland, takeToken, safeJson,
  RATE_LIMITS, MAX_CELL_COORD,
} from '../party/index.js';

// ---- mock PartyKit room + connections ----------------------------------
function makeRoom() {
  const conns = new Map();
  return {
    id: 'room-test',
    conns,
    getConnection: (id) => conns.get(id) || null,
    // The server narrows to broadcastToAdmitted (per-connection send); room
    // broadcast is unused, but stub it so nothing throws if that changes.
    broadcast: () => {},
    addConn(id) {
      const c = {
        id,
        received: [],
        closed: false,
        send(raw) { c.received.push(JSON.parse(raw)); },
        close() { c.closed = true; },
      };
      conns.set(id, c);
      return c;
    },
  };
}

function setup() {
  const room = makeRoom();
  const party = new TinyWorldParty(room);
  const connect = (id) => { const c = room.addConn(id); party.onConnect(c); return c; };
  // onMessage(rawString, sender); sender only needs .id.
  const send = (sender, obj) => party.onMessage(JSON.stringify(obj), sender);
  return { room, party, connect, send };
}
const last = (conn) => conn.received[conn.received.length - 1];
const typesTo = (conn) => conn.received.map((m) => m.type);

// ====================== pure validators =================================

test('cleanCellSet rounds coords and rejects out-of-range', () => {
  const ok = cleanCellSet({ x: 3.6, z: -2.4, cell: { terrain: 'grass' } });
  assert.equal(ok.x, 4);
  assert.equal(ok.z, -2);
  assert.equal(cleanCellSet({ x: MAX_CELL_COORD + 1, z: 0, cell: { terrain: 'grass' } }), null);
  assert.equal(cleanCellSet({ x: 0, z: 9999999, cell: { terrain: 'grass' } }), null);
  // NaN coords coerce to 0 (cleanNumber fallback) — a harmless in-bounds cell, not a reject.
  assert.equal(cleanCellSet({ x: NaN, z: 0, cell: { terrain: 'grass' } }).x, 0);
  assert.equal(cleanCellSet(null), null);
  assert.equal(cleanCellSet({ x: 0, z: 0 }), null, 'missing cell rejected');
});

test('cleanCell allowlists fields and drops attacker keys', () => {
  const c = cleanCell({ terrain: 'grass', kind: 'tree', userEdited: true, __proto__: { polluted: 1 }, evil: 'x' });
  assert.equal(c.terrain, 'grass');
  assert.equal(c.kind, 'tree');
  assert.equal('userEdited' in c, false, 'userEdited stripped');
  assert.equal('evil' in c, false, 'unknown field stripped');
  assert.equal('polluted' in c, false);
});

test('cleanCell normalizes terrain/kind enums and clamps floors', () => {
  assert.equal(cleanCell({ terrain: 'bogus' }).terrain, 'grass');
  assert.equal(cleanCell({ terrain: 'lava' }).terrain, 'lava');
  assert.equal(cleanCell({ kind: 'not-a-kind' }).kind, null);
  assert.equal(cleanCell({ kind: 'house' }).kind, 'house');
  assert.equal(cleanCell({ floors: 1e7 }).floors, 8, 'floors clamped to MAX_FLOORS');
  assert.equal(cleanCell({ terrainFloors: 999 }).terrainFloors, 8);
  assert.equal(cleanCell({ floors: 0 }).floors, 1, 'floors floored to 1');
  assert.deepEqual(cleanCell({ terrain: 'grass' }).extras, [], 'extras defaults to []');
});

test('clampFloors bounds to 1..8', () => {
  assert.equal(clampFloors(0), 1);
  assert.equal(clampFloors(-5), 1);
  assert.equal(clampFloors(3), 3);
  assert.equal(clampFloors(8), 8);
  assert.equal(clampFloors(100), 8);
  assert.equal(clampFloors('not a number'), 1);
});

test('cleanRole only allows assignable roles, never host', () => {
  assert.equal(cleanRole('viewer'), 'viewer');
  assert.equal(cleanRole('editor'), 'editor');
  assert.equal(cleanRole('player'), 'player');
  assert.equal(cleanRole('host'), 'viewer', 'a client cannot mint host via role');
  assert.equal(cleanRole('garbage'), 'viewer');
  assert.equal(cleanRole(undefined), 'viewer');
});

test('cleanIsland returns a valid rect or null', () => {
  assert.deepEqual(cleanIsland({ minX: 0, maxX: 7, minZ: 0, maxZ: 7 }), { minX: 0, maxX: 7, minZ: 0, maxZ: 7 });
  assert.equal(cleanIsland(null), null);
  assert.equal(cleanIsland({ minX: 5, maxX: 0, minZ: 0, maxZ: 7 }), null, 'maxX<minX rejected');
  assert.equal(cleanIsland({ minX: 0, maxX: 7 }), null, 'missing bounds rejected');
});

test('inIsland enforces bounds; null island denies all', () => {
  const box = { minX: 0, maxX: 7, minZ: 0, maxZ: 7 };
  assert.equal(inIsland(box, 3, 3), true);
  assert.equal(inIsland(box, 0, 0), true);
  assert.equal(inIsland(box, 7, 7), true);
  assert.equal(inIsland(box, 8, 3), false);
  assert.equal(inIsland(box, -1, 3), false);
  assert.equal(inIsland(null, 3, 3), false);
});

test('cleanPresence sanitizes name/color', () => {
  const p = cleanPresence({ name: '  Daisy  ', color: '#ff0000' }, 'fallback');
  assert.equal(p.name, 'Daisy');
  assert.equal(p.color, '#ff0000');
  assert.equal(cleanPresence({}, 'fb').name, 'Builder', 'name defaults');
  assert.equal(cleanPresence({ color: 'red' }, 'fb').color, '#3c82f7', 'invalid color falls back');
  assert.equal(cleanPresence(null, 'fb'), null);
});

test('cleanVec3 coerces to finite numbers', () => {
  assert.deepEqual(cleanVec3({ x: 1, y: 2, z: 3 }), { x: 1, y: 2, z: 3 });
  assert.deepEqual(cleanVec3({ x: 'a', y: Infinity, z: null }), { x: 0, y: 0, z: 0 });
  assert.deepEqual(cleanVec3(null), { x: 0, y: 0, z: 0 });
});

test('safeJson rejects non-strings, oversized, and invalid JSON', () => {
  assert.equal(safeJson('not json{'), null);
  assert.equal(safeJson(42), null);
  assert.deepEqual(safeJson('{"a":1}'), { a: 1 });
  assert.equal(safeJson('"' + 'x'.repeat(48 * 1024) + '"'), null, 'over 48KB rejected');
});

test('takeToken enforces a per-type burst then refills', () => {
  const buckets = new Map();
  const now = 1_000_000;
  const cfg = RATE_LIMITS.presence;
  let passed = 0;
  for (let i = 0; i < cfg.burst + 5; i++) { if (takeToken(buckets, 'presence', now)) passed++; }
  assert.equal(passed, cfg.burst, 'burst capacity enforced within the same instant');
  // Unknown types are unbucketed (host moderation) and always pass.
  assert.equal(takeToken(buckets, 'admit', now), true);
});

// ====================== room state machine + gating =====================

test('first connection becomes host, admitted', () => {
  const { party, connect } = setup();
  const host = connect('h');
  const w = last(host);
  assert.equal(w.type, 'welcome');
  assert.equal(w.role, 'host');
  assert.equal(w.admitted, true);
  assert.equal(party.hostId, 'h');
});

test('second connection lands in the lobby, not admitted', () => {
  const { party, connect } = setup();
  connect('h');
  const guest = connect('g');
  const w = last(guest);
  assert.equal(w.role, 'viewer');
  assert.equal(w.admitted, false);
  assert.equal(party.lobby.has('g'), true);
  assert.equal(party.admitted.has('g'), false);
});

test('only the host can admit; admit assigns the chosen role', () => {
  const { party, connect, send } = setup();
  const host = connect('h');
  const guest = connect('g');
  // A non-host trying to admit is ignored.
  send({ id: 'g' }, { type: 'admit', id: 'g', role: 'editor' });
  assert.equal(party.admitted.has('g'), false, 'non-host admit ignored');
  // Host admits as viewer.
  send(host, { type: 'admit', id: 'g', role: 'viewer' });
  assert.equal(party.admitted.get('g').role, 'viewer');
  assert.equal(party.lobby.has('g'), false);
  assert.ok(typesTo(guest).includes('admitted'));
});

test('cell.set is dropped from viewers and players, allowed from host', () => {
  const { party, connect, send, room } = setup();
  const host = connect('h');
  const viewer = connect('v');
  send(host, { type: 'admit', id: 'v', role: 'viewer' });
  host.received.length = 0;
  // Viewer edit is dropped: host receives no cell.set.
  send({ id: 'v' }, { type: 'cell.set', op: { x: 1, z: 1, cell: { terrain: 'grass' } } });
  assert.equal(host.received.filter((m) => m.type === 'cell.set').length, 0, 'viewer edit dropped');
  // Host edit broadcasts to other admitted (the viewer).
  viewer.received.length = 0;
  send(host, { type: 'cell.set', op: { x: 2, z: 2, cell: { terrain: 'grass' } } });
  assert.ok(viewer.received.some((m) => m.type === 'cell.set' && m.op.x === 2), 'host edit relayed to admitted');
});

test('editor edits only within the granted island', () => {
  const { party, connect, send } = setup();
  const host = connect('h');
  const ed = connect('e');
  send(host, { type: 'admit', id: 'e', role: 'editor', island: { minX: 0, maxX: 7, minZ: 0, maxZ: 7 } });
  host.received.length = 0;
  // Inside the island → relayed to host.
  send({ id: 'e' }, { type: 'cell.set', op: { x: 3, z: 3, cell: { terrain: 'grass' } } });
  assert.ok(host.received.some((m) => m.type === 'cell.set' && m.op.x === 3), 'in-island edit relayed');
  // Outside the island → dropped.
  host.received.length = 0;
  send({ id: 'e' }, { type: 'cell.set', op: { x: 99, z: 99, cell: { terrain: 'grass' } } });
  assert.equal(host.received.filter((m) => m.type === 'cell.set').length, 0, 'out-of-island edit dropped');
});

test('snapshot/env/moorings are honored only from the host', () => {
  const { party, connect, send } = setup();
  const host = connect('h');
  const ed = connect('e');
  send(host, { type: 'admit', id: 'e', role: 'editor', island: { minX: 0, maxX: 7, minZ: 0, maxZ: 7 } });
  host.received.length = 0;
  // Non-host env/moorings injection is ignored (host receives nothing).
  send({ id: 'e' }, { type: 'env', env: { weather: 'storm' } });
  send({ id: 'e' }, { type: 'moorings', moorings: [{ a: 1 }] });
  assert.equal(host.received.filter((m) => m.type === 'env' || m.type === 'moorings').length, 0, 'non-host shared-state dropped');
  // Host env broadcasts to admitted (the editor).
  send(host, { type: 'env', env: { weather: 'rain' } });
  assert.ok(party.admitted.has('e'));
});

test('kick is host-only, removes the seat, and closes the connection', () => {
  const { party, connect, send, room } = setup();
  const host = connect('h');
  const v = connect('v');
  send(host, { type: 'admit', id: 'v', role: 'viewer' });
  // Non-host kick ignored.
  send({ id: 'v' }, { type: 'kick', id: 'v' });
  assert.equal(party.admitted.has('v'), true, 'non-host kick ignored');
  // Host kick removes admitted + seat and closes the socket.
  send(host, { type: 'kick', id: 'v' });
  assert.equal(party.admitted.has('v'), false);
  assert.equal(party.seats.has('v'), false, 'kicked seat forgotten (cannot auto re-admit)');
  assert.equal(room.getConnection('v').closed, true);
  assert.ok(typesTo(room.getConnection('v')).includes('kicked'));
});

test('host leaving promotes the next admitted member to host', () => {
  const { party, connect, send, room } = setup();
  const host = connect('h');
  const ed = connect('e');
  send(host, { type: 'admit', id: 'e', role: 'editor', island: { minX: 0, maxX: 7, minZ: 0, maxZ: 7 } });
  party.onClose(room.getConnection('h'));
  assert.equal(party.hostId, 'e', 'next admitted promoted to host');
  assert.equal(party.admitted.get('e').role, 'host');
  assert.ok(typesTo(room.getConnection('e')).includes('role'));
});

test('combat.hit routes only to the targeted peer, stamped with shooter id', () => {
  const { connect, send } = setup();
  const host = connect('host');           // first connection becomes host
  // admit two peers as players
  const a = connect('peerA');
  const b = connect('peerB');
  send(host, { type: 'admit', id: 'peerA', role: 'player' });
  send(host, { type: 'admit', id: 'peerB', role: 'player' });
  // peerA shoots peerB
  a.received.length = 0; b.received.length = 0; host.received.length = 0;
  send(a, { type: 'combat.hit', to: 'peerB', damage: 8, source: 'gun' });
  // only B receives it, stamped by = peerA
  const bMsg = b.received.find(m => m.type === 'combat.hit');
  assert.ok(bMsg, 'peerB should receive the hit');
  assert.equal(bMsg.by, 'peerA');
  assert.equal(bMsg.to, 'peerB');
  assert.equal(bMsg.damage, 8);
  assert.equal(a.received.find(m => m.type === 'combat.hit'), undefined, 'shooter should not receive its own hit');
  assert.equal(host.received.find(m => m.type === 'combat.hit'), undefined, 'host should not receive the hit');
});

test('a returning admitted member (same id) is re-admitted, not re-lobbied', () => {
  const { party, connect, send, room } = setup();
  const host = connect('h');
  const v = connect('v');
  send(host, { type: 'admit', id: 'v', role: 'viewer' });
  // v drops...
  party.onClose(room.getConnection('v'));
  assert.equal(party.admitted.has('v'), false);
  assert.equal(party.seats.has('v'), true, 'seat remembered across disconnect');
  // ...and reconnects with the same id (stable _pk).
  const v2 = room.addConn('v');
  party.onConnect(v2);
  assert.equal(last(v2).admitted, true, 're-admitted from seat');
  assert.equal(last(v2).role, 'viewer');
  assert.equal(party.lobby.has('v'), false, 'not sent back to the lobby');
});
