/* ── 🎚 DEBUG: скорость анимации посадки/высадки на корабль ──────────────────
   Два лог-ползунка ×0.1…×10 (10× медленнее … 10× быстрее относительно базовой):
   window.SEA_BOARD_K (посадка) и window.SEA_UNBOARD_K (высадка) — читаются
   в placeGhostStream каждый кадр. Значения переживают перезагрузку (localStorage).
   Отключить в проде: убрать модуль из MODS. */
(function () {
  const LS_KEY = 'dbgSea';
  const state = { board: 1, unboard: 1 };
  try { Object.assign(state, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (e) {}
  const clamp = (v) => Math.max(0.1, Math.min(10, +v || 1));
  state.board = clamp(state.board); state.unboard = clamp(state.unboard);
  const apply = () => { window.SEA_BOARD_K = state.board; window.SEA_UNBOARD_K = state.unboard; };
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} };
  apply();

  // ползунок в лог-шкале: позиция -1..1 → множитель 10^p (0.1..10)
  const toPos = (m) => Math.log10(m);
  const toMul = (p) => Math.pow(10, +p);
  const fmt = (m) => (m >= 1 ? '×' + m.toFixed(m < 3 ? 2 : 1) : '×' + m.toFixed(2));

  function row(id, label, key) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0 3px;">' +
        '<span style="opacity:.85">' + label + '</span>' +
        '<b id="' + id + 'Val" style="color:#57c7ff;font-variant-numeric:tabular-nums">' + fmt(state[key]) + '</b>' +
      '</div>' +
      '<input id="' + id + '" type="range" min="-1" max="1" step="0.01" value="' + toPos(state[key]) + '" style="width:100%;accent-color:#57c7ff;cursor:pointer;">';
  }

  function build() {
    if (!document.body || document.getElementById('dbgSea')) return;
    const el = document.createElement('div');
    el.id = 'dbgSea';
    el.style.cssText = 'position:fixed;left:12px;bottom:96px;z-index:60;background:rgba(12,20,30,.88);border:1px solid #2b3d4f;border-radius:10px;padding:8px 12px 9px;font:12px system-ui,sans-serif;color:#cfe6f5;width:196px;box-shadow:0 6px 20px rgba(0,0,0,.45);user-select:none;';
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span style="opacity:.85">🚢 Sea fade</span>' +
        '<button id="dbgSeaReset" style="font:10px system-ui;background:#22374a;color:#cfe6f5;border:1px solid #35506a;border-radius:5px;padding:1px 7px;cursor:pointer;">reset</button>' +
      '</div>' +
      row('dbgSeaBoard', '⬆ Boarding', 'board') +
      row('dbgSeaUnboard', '⬇ Landing', 'unboard') +
      '<div style="display:flex;justify-content:space-between;font-size:10px;color:#7d94a6;margin-top:3px;"><span>×0.1</span><span>×1</span><span>×10</span></div>';
    document.body.appendChild(el);
    const wire = (id, key) => {
      const sl = el.querySelector('#' + id), lab = el.querySelector('#' + id + 'Val');
      sl.addEventListener('input', () => { state[key] = clamp(toMul(sl.value)); lab.textContent = fmt(state[key]); apply(); save(); });
      return { sl, lab };
    };
    const b = wire('dbgSeaBoard', 'board'), u = wire('dbgSeaUnboard', 'unboard');
    el.querySelector('#dbgSeaReset').addEventListener('click', () => {
      state.board = 1; state.unboard = 1; apply(); save();
      b.sl.value = 0; b.lab.textContent = fmt(1);
      u.sl.value = 0; u.lab.textContent = fmt(1);
    });
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', build); else build();
})();
