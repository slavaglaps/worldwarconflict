/* ── 📈 perf-chip.js — компактный монитор производительности (прод) ──────────
   Маленький чип под хэдером: FPS + среднее время кадра, цвет по здоровью
   (зелёный ≥50, жёлтый ≥30, красный <30). Обновление 2 раза/с, считается из
   реального игрового цикла (perfChipTick(now) зовётся из loop каждый кадр).
   Клик по чипу — разворачивает подробный F10-оверлей (draw calls, треугольники). */
(function () {
  let el = null, fpsEl = null, msEl = null;
  let frames = 0, accMs = 0, lastNow = 0, lastFlush = 0;

  function ensureDom() {
    if (el) return true;
    if (!document.body) return false;
    el = document.createElement('div');
    el.id = 'perfChip';
    el.title = 'Performance (click — details, F10)';
    el.innerHTML = '<span class="pcDot"></span><b id="pcFps">—</b><span class="pcU">fps</span><i id="pcMs">—</i>';
    document.body.appendChild(el);
    fpsEl = el.querySelector('#pcFps'); msEl = el.querySelector('#pcMs');
    el.addEventListener('click', () => { if (typeof window.__perfOverlay === 'function') { window.__perfShown = !window.__perfShown; window.__perfOverlay(window.__perfShown); } });
    return true;
  }

  function perfChipTick(now) {
    if (!ensureDom()) return;
    if (lastNow) { const d = now - lastNow; if (d > 0 && d < 1000) { frames++; accMs += d; } }
    lastNow = now;
    if (now - lastFlush < 500) return;
    if (frames > 0) {
      const avg = accMs / frames, fps = 1000 / avg;
      fpsEl.textContent = Math.round(fps);
      msEl.textContent = avg.toFixed(1) + 'ms';
      el.classList.toggle('bad', fps < 30);
      el.classList.toggle('warn', fps >= 30 && fps < 50);
    }
    frames = 0; accMs = 0; lastFlush = now;
  }

  window.perfChipTick = perfChipTick;
})();
