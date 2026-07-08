/* ── DEBUG: ползунок скорости отряда ────────────────────────────
   Живо правит LOCALSIM.K.SQUAD_SPEED (Squad.update читает его каждый тик).
   Пока ползунок не трогали — он ПОКАЗЫВАЕТ текущую скорость (вкл. balance.tune);
   после первого движения — УПРАВЛЯЕТ ей и переприменяется к новому симу (после newGame).
   Отключить в проде: не добавлять модуль в MODS, либо гейтить по ?dbg. */
(function () {
  const DEF = (typeof SQUAD_SPEED !== 'undefined' ? SQUAD_SPEED : 1.333);   // код-дефолт (=1.333)
  let val = DEF, touched = false, sl = null, lab = null;

  const liveSpeed = () => { try { if (typeof LOCALSIM !== 'undefined' && LOCALSIM && LOCALSIM.K && LOCALSIM.K.SQUAD_SPEED != null) return LOCALSIM.K.SQUAD_SPEED; } catch (e) {} return null; };
  const apply = () => { try { if (typeof LOCALSIM !== 'undefined' && LOCALSIM && LOCALSIM.K) LOCALSIM.K.SQUAD_SPEED = val; } catch (e) {} };

  function build() {
    if (!document.body || document.getElementById('dbgSpeed')) return;
    const el = document.createElement('div');
    el.id = 'dbgSpeed';
    el.style.cssText = 'position:fixed;left:12px;bottom:96px;z-index:60;background:rgba(12,20,30,.88);border:1px solid #2b3d4f;border-radius:10px;padding:8px 12px 9px;font:12px system-ui,sans-serif;color:#cfe6f5;width:196px;box-shadow:0 6px 20px rgba(0,0,0,.45);user-select:none;';
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">' +
        '<span style="opacity:.85">🏃 Squad speed</span>' +
        '<b id="dbgSpeedVal" style="color:#57c7ff;font-variant-numeric:tabular-nums">1.33</b>' +
      '</div>' +
      '<input id="dbgSpeedSlider" type="range" min="0.02" max="8" step="0.02" value="' + DEF + '" style="width:100%;accent-color:#57c7ff;cursor:pointer;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#7d94a6;margin-top:3px;">' +
        '<span>0.02</span>' +
        '<button id="dbgSpeedReset" style="font:10px system-ui;background:#22374a;color:#cfe6f5;border:1px solid #35506a;border-radius:5px;padding:1px 7px;cursor:pointer;">reset ' + DEF.toFixed(2) + '</button>' +
        '<span>8</span>' +
      '</div>';
    document.body.appendChild(el);
    sl = el.querySelector('#dbgSpeedSlider');
    lab = el.querySelector('#dbgSpeedVal');
    const set = (v) => { val = v; sl.value = v; lab.textContent = v.toFixed(2); };
    set(liveSpeed() != null ? liveSpeed() : DEF);
    sl.addEventListener('input', () => { touched = true; val = parseFloat(sl.value); lab.textContent = val.toFixed(2); apply(); });
    el.querySelector('#dbgSpeedReset').addEventListener('click', () => { touched = true; set(DEF); apply(); });
  }

  const boot = () => {
    build();
    setInterval(() => {
      if (!sl) { build(); return; }
      if (touched) apply();                                   // управляем: держим значение (в т.ч. после newGame)
      else { const s = liveSpeed(); if (s != null && Math.abs(s - val) > 1e-4) { val = s; sl.value = s; lab.textContent = s.toFixed(2); } }  // показываем реальную скорость
    }, 600);
  };
  if (document.body) boot(); else window.addEventListener('DOMContentLoaded', boot);
})();
