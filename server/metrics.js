// ────────────────────────────────────────────────────────────────────────────
// Наблюдаемость без зависимостей. Собирает счётчики/гейджи/перф тика/кольцо ошибок
// в памяти процесса; отдаётся через /metrics (JSON или Prometheus-текст) и пишет
// строку [health] в логи раз в минуту (видно в Colyseus Cloud logs). Для запуска
// коммерции этого достаточно, чтобы не быть слепым: живы ли комнаты, сколько
// игроков, не растёт ли время тика, что и когда падало.
// ────────────────────────────────────────────────────────────────────────────
const START = Date.now();

const m = {
  roomsCreated: 0, roomsDisposed: 0,
  joins: 0, leaves: 0,
  commands: 0, denials: 0,
  errors: 0,
  rooms: 0, clients: 0,            // активные (через дельты create/dispose, join/leave)
  tickCount: 0, tickSumMs: 0, tickMaxMs: 0,   // перф тика — ОКОННЫЙ (сбрасывается в heartbeat)
  tickCountTotal: 0,               // суммарно с запуска
};
const recentErrors = [];           // последние ошибки: {t, where, msg}
const ERR_KEEP = 50;
let hb = null;

const roomCreated  = () => { m.roomsCreated++; m.rooms++; };
const roomDisposed = () => { m.roomsDisposed++; if (m.rooms > 0) m.rooms--; };
const join  = () => { m.joins++; m.clients++; };
const leave = () => { m.leaves++; if (m.clients > 0) m.clients--; };
const command = (denied) => { m.commands++; if (denied) m.denials++; };
const tick = (ms) => { m.tickCount++; m.tickCountTotal++; m.tickSumMs += ms; if (ms > m.tickMaxMs) m.tickMaxMs = ms; };
function error(where, err) {
  m.errors++;
  const msg = (err && err.stack) ? String(err.stack).split('\n').slice(0, 3).join(' | ') : String((err && err.message) || err);
  recentErrors.push({ t: Date.now(), where: String(where), msg: msg.slice(0, 400) });
  if (recentErrors.length > ERR_KEEP) recentErrors.shift();
}

function snapshot() {
  const tickAvg = m.tickCount ? m.tickSumMs / m.tickCount : 0;
  return {
    uptime_s: Math.round((Date.now() - START) / 1000),
    rooms: m.rooms, clients: m.clients,
    rooms_created: m.roomsCreated, rooms_disposed: m.roomsDisposed,
    joins: m.joins, leaves: m.leaves,
    commands: m.commands, denials: m.denials, errors: m.errors,
    tick_avg_ms: +tickAvg.toFixed(3), tick_max_ms: +m.tickMaxMs.toFixed(3), tick_count: m.tickCountTotal,
    rss_mb: +(process.memoryUsage().rss / 1048576).toFixed(1),
    recent_errors: recentErrors.slice(-10),
  };
}

function prometheus() {
  const s = snapshot();
  const out = [];
  const g = (name, help, val) => out.push(`# HELP wwc_${name} ${help}`, `# TYPE wwc_${name} gauge`, `wwc_${name} ${val}`);
  g('uptime_seconds', 'Process uptime', s.uptime_s);
  g('rooms_active', 'Active game rooms', s.rooms);
  g('clients_active', 'Connected clients', s.clients);
  g('rooms_created_total', 'Rooms created since boot', s.rooms_created);
  g('joins_total', 'Client joins since boot', s.joins);
  g('commands_total', 'Commands processed', s.commands);
  g('denials_total', 'Commands denied (anti-cheat/rate)', s.denials);
  g('errors_total', 'Errors recorded', s.errors);
  g('tick_avg_ms', 'Avg sim tick ms (last window)', s.tick_avg_ms);
  g('tick_max_ms', 'Max sim tick ms (last window)', s.tick_max_ms);
  g('rss_mb', 'Resident memory MB', s.rss_mb);
  return out.join('\n') + '\n';
}

// heartbeat: строка здоровья в логи раз в N сек + сброс оконного перф-тика
function startHeartbeat(intervalMs = 60000) {
  if (hb) return;
  hb = setInterval(() => {
    const s = snapshot();
    console.log(`[health] up=${s.uptime_s}s rooms=${s.rooms} clients=${s.clients} tick.avg=${s.tick_avg_ms}ms tick.max=${s.tick_max_ms}ms cmds=${s.commands} denied=${s.denials} errs=${s.errors} rss=${s.rss_mb}MB`);
    m.tickCount = 0; m.tickSumMs = 0; m.tickMaxMs = 0;   // окно перф-тика
  }, intervalMs);
  if (hb.unref) hb.unref();   // не держать процесс из-за таймера
}
function stopHeartbeat() { if (hb) { clearInterval(hb); hb = null; } }

// глобальный backstop: видеть необработанные ошибки процесса (без падения комнат)
function installProcessHandlers() {
  if (installProcessHandlers._done) return; installProcessHandlers._done = true;
  process.on('unhandledRejection', (e) => { error('unhandledRejection', e); console.error('[unhandledRejection]', (e && e.stack) || e); });
  process.on('uncaughtException',  (e) => { error('uncaughtException', e);  console.error('[uncaughtException]', (e && e.stack) || e); });
}

module.exports = { roomCreated, roomDisposed, join, leave, command, tick, error, snapshot, prometheus, startHeartbeat, stopHeartbeat, installProcessHandlers };
