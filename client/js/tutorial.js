/* ─────────────────────────────────────────────────────────────────────────
   tutorial.js — интерактивный туториал (соло, поверх LOCALSIM).
   Активация: ?tut=1 (форс) · авто при первом запуске (нет localStorage wwc_tut_done) · ?tut=0 выкл.
   Архитектура:
   • шаги — декларативный список: spot (куда светить) + done (когда выполнен) + allow (какие команды пропускать);
   • перехват команд — обёртка MP.cmd (в соло все команды игрока идут через localSimCmd);
   • постройки (ферма/башня/верфь/аэродром) MP.cmd не используют → детект по window.MAP_BUILDINGS;
   • тик — собственный requestAnimationFrame (loop.js не трогаем);
   • сетап/событие «Бельгия берёт Париж»/хендофф — прямые мутации LOCALSIM (соло, анти-чита нет).
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  const qs = new URLSearchParams(location.search);
  const isMP = qs.get('mp') || qs.get('room') || qs.has('cs') || qs.get('rid');
  let seen = false; try { seen = !!localStorage.getItem('wwc_tut_done'); } catch (e) {}
  const WANT = qs.get('tut') === '1' || (!isMP && qs.get('tut') !== '0' && !seen);
  window.TUT = { active: false, fullVision: false };
  if (!WANT || isMP) return;                       // MP/выкл → модуль пассивен

  /* ── константы сценария ── */
  const CITY_PARIS = 6, CITY_LYON = 8, CITY_TURIN = 28;
  const PREGRANT_TECH = ['p1', 'p3', 'k1', 'k2', 'k4', 'i3', 'i6'];   // пререквизиты Верфи(i1)/Аэродрома(i8) — игроку остаётся 1 клик
  const WAR_WAIT = 15;                             // сек мобилизации в туториале (вместо WAR_PREP=60 — учим механике, не скуке)
  let IT = -1, BE = -1;                            // fid Италии/Бельгии (после buildFactions)

  /* ── локализация (модульная: без правки словарей i18n) ── */
  const RU = {
    skip: 'Пропустить обучение', step: 'Шаг', nudge: '⚠ Следуй подсказке туториала',
    go: '⚔ В бой!', grant: '💰 Казна пополнена',
    s1t: 'Разведка карты', s1: 'Подвигай камеру — зажми край карты мышью или используй WASD/стрелки.',
    s2t: 'Приближение', s2: 'Покрути колесо мыши — приблизь камеру к своим городам.',
    s3t: 'Твоя столица', s3: 'Кликни по Парижу. Сверху — твои ресурсы: 💰 золото, 👥 манпауэр, 🏛 политические очки.',
    s4t: 'Армия', s4: 'Открой вкладку «⚔ Army» в панели города.',
    s5t: 'Найм войск', s5: 'Найми пехоту — нажми кнопку найма. Войска производятся городом и пополняют гарнизон.',
    s6t: 'Строительство', s6: 'Открой меню строительства (кнопка 🏠 справа или клавиша B).',
    s7t: 'Ферма', s7: 'Выбери 🌾 Ферму и поставь её на подсвеченный хекс рядом с городом. Ферма приносит золото и не требует технологий.',
    s8t: 'Технологии', s8: 'Открой дерево технологий (кнопка 📖 справа или клавиша T).',
    s9t: 'Атака I', s9: 'Изучи ⚔ «Атаку I» — корневой узел военной ветки. Без него дальнейшие узлы закрыты.',
    s10t: 'Разблок башни', s10: 'Теперь изучи 🗼 «Башню» — эта технология разблокирует новое здание.',
    s11t: 'Построй башню', s11: 'Открой меню строительства и поставь 🛡 Башню возле города. Она стала доступна только после исследования!',
    s12t: 'Герои', s12: 'Нажми «+» на панели героев (слева внизу).',
    s13t: 'Маршал Шторм', s13: 'Призови ✈ Маршала Шторма — мастера авиации. Его удар с воздуха проламывает оборону городов.',
    s14t: 'Дипломатия', s14: 'Открой панель дипломатии (кнопка 🤝 справа или клавиша P).',
    s15t: 'Объявление войны', s15: 'Объяви войну Италии — нажми «Война» напротив неё. Это стоит 🏛 политических очков.',
    s16t: 'Мобилизация', s16: 'Армия мобилизуется — атаковать сразу нельзя. Осталось: {s} сек.',
    s17t: 'Вся армия', s17: 'Передвинь ползунок «Send» на 100% — в атаку пойдёт весь гарнизон, а не половина.',
    s18t: 'Наступление', s18: 'Кликни по своему Лиону, затем по итальянскому Турину — армия выйдет на осаду.',
    s19t: 'Удар с воздуха', s19: 'Активируй 💥 «Ковровую бомбардировку» Шторма — она выбьет 40 защитников Турина.',
    s20t: 'Осада', s20: 'Армия штурмует Турин. Дождись захвата города.',
    s21t: 'Оккупация', s21: 'Кликни по захваченному Турину. Город оккупирован: найм, прокачка и стройка ЗАБЛОКИРОВАНЫ, пока не закрепишь его миром.',
    s22t: 'К переговорам', s22: 'Снова открой панель дипломатии.',
    s23t: 'Мир', s23: 'Нажми «Мир» напротив Италии — откроются условия договора.',
    s24t: 'Забрать землю', s24: 'Включи условие 🌍 «Аннексировать захваченные земли» — Турин останется тебе.',
    s25t: 'Договор', s25: 'Предложи мир. Италия примет — война окончена, Турин твой навсегда.',
    s26t: 'Твоя провинция', s26: 'Турин присоединён! Теперь в нём снова можно строить, нанимать и прокачивать.',
    s27t: 'Морская держава', s27: 'Изучи ⚓ «Верфь» в дереве технологий — она открывает постройку верфи.',
    s28t: 'Верфь', s28: 'Открой меню строительства и поставь ⚓ Верфь на берегу рядом со своим прибрежным городом.',
    s29t: 'Корабль', s29: 'Кликни город с верфью, открой «⚔ Army» и купи корабль.',
    s30t: 'Авиация', s30: 'Изучи ✈ «Аэродром» в дереве технологий.',
    s31t: 'Аэродром', s31: 'Поставь ✈ Аэродром рядом с любым своим городом.',
    s32t: 'Дирижабль', s32: 'Кликни город с аэродромом, открой «⚔ Army» и построй дирижабль.',
    s33t: '⚠ ПАРИЖ ПАЛ!', s33: 'Бельгия вероломно захватила твою столицу! Собери силы и освободи Париж!',
    s34t: 'Общий сбор', s34: 'Выдели НЕСКОЛЬКО своих городов: обведи их рамкой мыши или Shift+кликом.',
    s35t: 'Освобождение', s35: 'Перетащи с выделенного города на Париж — армии из всех выбранных городов пойдут на штурм!',
    s36t: 'Обучение завершено', s36: 'Париж освобождён! Соседи приходят в движение — теперь это настоящая война. Веди Францию к господству!',
  };
  const EN = {
    skip: 'Skip tutorial', step: 'Step', nudge: '⚠ Follow the tutorial hint',
    go: '⚔ To battle!', grant: '💰 Treasury replenished',
    s1t: 'Scout the map', s1: 'Move the camera — drag the map edge or use WASD/arrows.',
    s2t: 'Zoom', s2: 'Use the mouse wheel — zoom in on your cities.',
    s3t: 'Your capital', s3: 'Click Paris. On top — your resources: 💰 gold, 👥 manpower, 🏛 politics points.',
    s4t: 'Army', s4: 'Open the “⚔ Army” tab in the city panel.',
    s5t: 'Recruiting', s5: 'Hire infantry — press the recruit button. Troops are produced by the city and join its garrison.',
    s6t: 'Construction', s6: 'Open the construction menu (🏠 button on the right, or B).',
    s7t: 'Farm', s7: 'Pick the 🌾 Farm and place it on a highlighted hex near your city. Farms yield gold and need no research.',
    s8t: 'Research', s8: 'Open the tech tree (📖 button on the right, or T).',
    s9t: 'Attack I', s9: 'Research ⚔ “Attack I” — the war branch root. Later nodes are locked without it.',
    s10t: 'Tower unlock', s10: 'Now research 🗼 “Tower” — this tech unlocks a new building.',
    s11t: 'Build the tower', s11: 'Open the construction menu and place a 🛡 Tower near your city. It only became available after research!',
    s12t: 'Heroes', s12: 'Press “+” on the hero bar (bottom left).',
    s13t: 'Marshal Storm', s13: 'Summon ✈ Marshal Storm — the air-power master. His strike smashes city defenses.',
    s14t: 'Diplomacy', s14: 'Open the diplomacy panel (🤝 button on the right, or P).',
    s15t: 'Declare war', s15: 'Declare war on Italy — press “War” next to it. It costs 🏛 politics points.',
    s16t: 'Mobilization', s16: 'The army is mobilizing — you cannot attack yet. Remaining: {s} s.',
    s17t: 'Full force', s17: 'Set the “Send” slider to 100% — the whole garrison will attack, not half.',
    s18t: 'Offensive', s18: 'Click your Lyon, then Italian Turin — the army will march to siege.',
    s19t: 'Air strike', s19: 'Activate Storm’s 💥 “Carpet Bombing” — it wipes out 40 of Turin’s defenders.',
    s20t: 'Siege', s20: 'Your army is storming Turin. Wait for the capture.',
    s21t: 'Occupation', s21: 'Click captured Turin. It is occupied: recruiting, upgrades and construction are LOCKED until you secure it with a peace treaty.',
    s22t: 'To the table', s22: 'Open the diplomacy panel again.',
    s23t: 'Peace', s23: 'Press “Peace” next to Italy — treaty terms will open.',
    s24t: 'Annex the land', s24: 'Enable 🌍 “Annex captured lands” — Turin will stay yours.',
    s25t: 'The treaty', s25: 'Propose peace. Italy accepts — the war is over, Turin is yours forever.',
    s26t: 'Your province', s26: 'Turin annexed! You can build, recruit and upgrade there again.',
    s27t: 'Naval power', s27: 'Research ⚓ “Shipyard” in the tech tree — it unlocks shipyard construction.',
    s28t: 'Shipyard', s28: 'Open the construction menu and place a ⚓ Shipyard on the coast near your coastal city.',
    s29t: 'Ship', s29: 'Click the shipyard city, open “⚔ Army” and buy a ship.',
    s30t: 'Aviation', s30: 'Research ✈ “Airfield” in the tech tree.',
    s31t: 'Airfield', s31: 'Place an ✈ Airfield near any of your cities.',
    s32t: 'Airship', s32: 'Click the airfield city, open “⚔ Army” and build an airship.',
    s33t: '⚠ PARIS HAS FALLEN!', s33: 'Belgium has treacherously seized your capital! Rally your forces and liberate Paris!',
    s34t: 'Rally', s34: 'Select SEVERAL of your cities: drag a box around them or Shift+click.',
    s35t: 'Liberation', s35: 'Drag from a selected city onto Paris — armies from ALL selected cities will storm it!',
    s36t: 'Tutorial complete', s36: 'Paris is free! Your neighbours are stirring — this is real war now. Lead France to dominance!',
  };
  const L = () => ((typeof LANG !== 'undefined' && LANG === 'ru') ? RU : EN);

  /* ── доступ к игровым глобалям (все модули в одной области видимости) ── */
  const sim = () => (typeof LOCALSIM !== 'undefined' ? LOCALSIM : null);
  const cliCity = (idx) => { try { return cities.find(c => c && c.idx === idx) || null; } catch (e) { return null; } };
  const simCity = (idx) => { const s = sim(); return s ? (s.cities.find(c => c.idx === idx) || null) : null; };
  const say = (m) => { try { toast(m); } catch (e) {} };

  /* ── оверлей: 4 щита (затемнение+блок кликов) + кольцо + коуч-карточка ── */
  const Z = 99990;
  let shields = [], ring = null, coach = null, coachTitle = null, coachText = null, coachMeta = null, coachBtn = null, styleEl = null;
  function buildUI() {
    styleEl = document.createElement('style');
    styleEl.textContent = `
      .tutShield{position:fixed;background:rgba(4,10,18,.55);z-index:${Z};pointer-events:auto}
      .tutShield.soft{background:transparent;pointer-events:none}
      .tutRing{position:fixed;z-index:${Z + 1};pointer-events:none;border:3px solid #ffd23f;border-radius:14px;
        box-shadow:0 0 0 4px rgba(255,210,63,.25),0 0 26px rgba(255,210,63,.55);animation:tutPulse 1.4s ease-in-out infinite}
      @keyframes tutPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.045);opacity:.75}}
      .tutCoach{position:fixed;left:50%;transform:translateX(-50%);top:78px;z-index:${Z + 2};max-width:480px;min-width:320px;
        background:rgba(8,16,26,.94);border:1px solid rgba(255,210,63,.4);border-radius:14px;padding:14px 18px 12px;
        color:#e8f0fa;font-family:inherit;box-shadow:0 10px 34px rgba(0,0,0,.55)}
      .tutCoach.bottom{top:auto;bottom:96px}
      .tutCoach.danger{border-color:rgba(255,90,70,.65);box-shadow:0 0 34px rgba(255,60,40,.35)}
      .tutCoach .tt{font-size:16px;font-weight:900;color:#ffd23f;margin-bottom:5px}
      .tutCoach.danger .tt{color:#ff7a6a}
      .tutCoach .tx{font-size:13.5px;line-height:1.45;color:#cfe0f0}
      .tutCoach .meta{display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:10px}
      .tutCoach .stepn{font-size:11px;color:#8fa4bd;font-weight:700}
      .tutCoach .tskip{background:none;border:1px solid rgba(140,165,195,.35);color:#9db4cc;border-radius:8px;
        padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer}
      .tutCoach .tskip:hover{color:#e8f0fa;border-color:#e8f0fa}
      .tutCoach .tgo{display:none;margin-top:10px;width:100%;background:linear-gradient(180deg,#ffd23f,#d8a41f);
        border:none;border-radius:10px;padding:10px;font-size:15px;font-weight:900;color:#3a2c05;cursor:pointer}
      .tutCoach .tgo:hover{filter:brightness(1.08)}`;
    document.head.appendChild(styleEl);
    for (let i = 0; i < 4; i++) { const d = document.createElement('div'); d.className = 'tutShield'; d.style.display = 'none'; document.body.appendChild(d); shields.push(d); }
    ring = document.createElement('div'); ring.className = 'tutRing'; ring.style.display = 'none'; document.body.appendChild(ring);
    coach = document.createElement('div'); coach.className = 'tutCoach'; coach.style.display = 'none';
    coach.innerHTML = `<div class="tt"></div><div class="tx"></div><button class="tgo"></button>
      <div class="meta"><span class="stepn"></span><button class="tskip"></button></div>`;
    document.body.appendChild(coach);
    coachTitle = coach.querySelector('.tt'); coachText = coach.querySelector('.tx');
    coachMeta = coach.querySelector('.stepn'); coachBtn = coach.querySelector('.tgo');
    coach.querySelector('.tskip').onclick = () => endTutorial(true);
  }
  function hideSpot() { for (const d of shields) d.style.display = 'none'; ring.style.display = 'none'; }
  // r = {x,y,w,h} в px; hard=true → щиты ловят клики вне дырки
  function showSpot(r, hard) {
    const W = innerWidth, H = innerHeight, pad = 6;
    const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad),
      w = Math.min(W - x, r.w + pad * 2), h = Math.min(H - y, r.h + pad * 2);
    const rects = [
      { l: 0, t: 0, w: W, h: y },                       // верх
      { l: 0, t: y + h, w: W, h: H - y - h },           // низ
      { l: 0, t: y, w: x, h },                          // лево
      { l: x + w, t: y, w: W - x - w, h },              // право
    ];
    shields.forEach((d, i) => { const q = rects[i];
      d.className = 'tutShield' + (hard ? '' : ' soft'); d.style.display = 'block';
      d.style.left = q.l + 'px'; d.style.top = q.t + 'px'; d.style.width = Math.max(0, q.w) + 'px'; d.style.height = Math.max(0, q.h) + 'px'; });
    ring.style.display = 'block';
    ring.style.left = x + 'px'; ring.style.top = y + 'px'; ring.style.width = w + 'px'; ring.style.height = h + 'px';
  }
  function elRect(el) { if (!el) return null; const r = el.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  // город → экранный прямоугольник (проекция как у city-labels), с клампом к краям экрана
  function cityRect(idx) {
    const c = cliCity(idx); if (!c || typeof camera === 'undefined') return null;
    try {
      const v = new T3.Vector3(c.gx, (c.baseY || 0) + (c.topY || 0.5) * (typeof CITY_SCALE !== 'undefined' ? CITY_SCALE : 1) + 0.4, c.gz).project(camera);
      let sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      const R = 58;
      sx = Math.max(R + 8, Math.min(innerWidth - R - 8, sx));
      sy = Math.max(R + 60, Math.min(innerHeight - R - 8, sy));
      return { x: sx - R, y: sy - R, w: R * 2, h: R * 2 };
    } catch (e) { return null; }
  }

  /* ── сим-хелперы сетапа ── */
  function grant(g, mp) {
    const s = sim(); if (!s) return;
    if (g) s.gold[PLAYER] = (s.gold[PLAYER] || 0) + g;
    if (mp) s.manpower[PLAYER] = Math.min(typeof s.manpowerCap === 'function' ? s.manpowerCap(PLAYER) : 1e9, (s.manpower[PLAYER] || 0) + mp);
    try { syncLocalEcon(s); } catch (e) {}
    if (g) say(L().grant + ` +${g}💰`);
  }
  // выдать техи и клиенту, и симу (паттерн unlockAllTechCheat)
  function grantTech(ids) {
    const s = sim();
    for (const id of ids) techDone[PLAYER].add(id);
    recomputeTech(PLAYER);
    if (s && s.techDone && s.techCache) {
      for (const id of ids) s.techDone[PLAYER].add(id);
      s.techCache[PLAYER] = { add: Object.assign({}, techCache[PLAYER].add), flags: new Set(techCache[PLAYER].flags), slots: techCache[PLAYER].slots };
    }
  }
  // полный обзор: подменяем vision-маску на «всё видно» (проектор соло и fog.js зовут её каждый кадр)
  function patchVision() {
    const V = window.__WWCSim && window.__WWCSim.vision; if (!V || V.__tutPatched) return;
    V.__tutPatched = true; const orig = V.visionMask.bind(V);
    let ones = null;
    V.visionMask = (s, p) => {
      if (window.TUT.fullVision) { const G = s.K.GRID; if (!ones || ones.length !== G * G) { ones = new Uint8Array(G * G); ones.fill(1); } return ones; }
      return orig(s, p);
    };
  }

  /* ── перехват команд: on-rails ── */
  let origCmd = null, lastCmd = null;
  function wrapCmd() {
    if (origCmd) return;
    origCmd = MP.cmd;
    MP.cmd = (o) => {
      const st = STEPS[idx];
      if (window.TUT.active && st && !(st.allow && st.allow(o))) { say(L().nudge); return; }
      origCmd(o);
      lastCmd = o;
      // исследования туториала не должны тянуться 22-80с: доводим прогресс почти до конца
      if (o.cmd === 'research') { const s = sim(); const n = (typeof NODE !== 'undefined') && NODE[o.node];
        if (s && n && s.techRes && s.techRes[PLAYER]) { const r = s.techRes[PLAYER].find(x => x.id === o.node); if (r) r.t = Math.max(r.t, n.t - 1.2); } }
    };
  }
  function unwrapCmd() { if (origCmd) { MP.cmd = origCmd; origCmd = null; } }

  /* ── шаги ── */
  let idx = 0, stepState = {};
  const bCount = (role) => { try { return (window.MAP_BUILDINGS || []).filter(b => b && b.item && b.item.role === role && b.owner === PLAYER).length; } catch (e) { return 0; } };
  const techWin = () => { const w = document.getElementById('techWin'); return w && getComputedStyle(w).display !== 'none'; };
  const polWin = () => { const w = document.getElementById('polWin'); return w && getComputedStyle(w).display !== 'none'; };
  const buildWin = () => { const w = document.getElementById('buildPanel'); return w && w.style.display !== 'none'; };
  const heroWinOpen = () => { const w = document.getElementById('heroWin'); return w && w.style.display === 'flex'; };
  const nodeEl = (id) => document.querySelector(`#techGrid [data-id="${id}"]`);
  const tileEl = (key) => document.querySelector(`#buildPanel button[data-key="${key}"]`);
  const polBtn = (fid, cls) => { try { const row = polRows[fid]; return row ? row.querySelector('.ab.' + cls) : null; } catch (e) { return null; } };
  const stormAbilityEl = () => { try { const hs = heroSlots[PLAYER] || []; const h = hs.find(x => x.id === 'storm'); return h && h._abEls ? h._abEls[0] : null; } catch (e) { return null; } };
  const stormSummonBtn = () => {
    try { const i = HEROES.findIndex(d => d.id === 'storm'); if (i < 0) return null;
      const rows = document.querySelectorAll('#heroList .hpick'); return rows[i] ? rows[i].querySelector('.summon') : null; } catch (e) { return null; }
  };
  const yardCityIdx = (air) => { const s = sim(); if (!s) return -1; const c = s.cities.find(x => x.owner === PLAYER && (air ? (x.hasAirport || x.isAirport) : (x.hasShipyard || x.isShipyard))); return c ? c.idx : -1; };
  // закрыть меню строительства (если открыто) — при переоткрытии оно обновит tech-локи плиток
  const closeBuild = () => { try { if (buildWin()) document.getElementById('sbBuild').click(); } catch (e) {} };
  // спот «панель города X» → если панель не на нём, светим сам город, иначе — элемент внутри панели
  const panelSpot = (cidx, innerEl) => {
    try { if (typeof panelCity !== 'undefined' && panelCity && panelCity.idx === cidx) { const r = elRect(innerEl && innerEl()); if (r) return r; } } catch (e) {}
    return cityRect(cidx);
  };

  const STEPS = [
    /* ── Часть 1: основы ── */
    { t: 's1t', x: 's1', lock: 'none',   // камера орбитальная: пан двигает target (см. input.js/applyCam)
      onEnter() { try { stepState.tx = target.x; stepState.tz = target.z; } catch (e) {} },
      done() { try { return (Math.abs(target.x - stepState.tx) + Math.abs(target.z - stepState.tz)) > 3; } catch (e) { return false; } } },
    { t: 's2t', x: 's2', lock: 'none',   // зум = orbit.r (колесо)
      onEnter() { try { stepState.r = orbit.r; } catch (e) {} },
      done() { try { return Math.abs(orbit.r - stepState.r) > 3; } catch (e) { return false; } } },
    { t: 's3t', x: 's3', lock: 'soft', spot: () => cityRect(CITY_PARIS),
      done() { return typeof panelCity !== 'undefined' && panelCity && panelCity.idx === CITY_PARIS; } },

    /* ── Часть 2: армия и экономика ── */
    { t: 's4t', x: 's4', lock: 'soft',
      onEnter() { grant(100, 0); },
      spot: () => panelSpot(CITY_PARIS, () => document.getElementById('tabArmy')),
      done() { return typeof panelTab !== 'undefined' && panelTab === 'army' && panelCity && panelCity.owner === PLAYER; } },
    { t: 's5t', x: 's5', lock: 'soft',
      spot: () => panelSpot(CITY_PARIS, () => { try { return buyRows['inf_5']; } catch (e) { return null; } }),
      allow: (o) => o.cmd === 'buy',
      done() { return lastCmd && lastCmd.cmd === 'buy'; } },
    { t: 's6t', x: 's6', lock: 'hard', spot: () => elRect(document.getElementById('sbBuild')),
      done() { return buildWin(); } },
    { t: 's7t', x: 's7', lock: 'soft',
      onEnter() { stepState.farms = bCount('farm'); },
      spot: () => { const el = tileEl('windmill'); return (buildWin() && el && !el.classList.contains('sel')) ? elRect(el) : null; },
      done() { return bCount('farm') > stepState.farms; } },

    /* ── Часть 3: технология → здание ── */
    { t: 's8t', x: 's8', lock: 'hard',
      onEnter() { grant(300, 0); try { if (typeof BUILDMENU !== 'undefined') {} } catch (e) {} },
      spot: () => elRect(document.getElementById('sbTech')),
      done() { return techWin(); } },
    { t: 's9t', x: 's9', lock: 'hard',
      spot: () => techWin() ? elRect(nodeEl('m1')) : elRect(document.getElementById('sbTech')),
      allow: (o) => o.cmd === 'research' && o.node === 'm1',
      done() { return techHas(PLAYER, 'm1'); } },
    { t: 's10t', x: 's10', lock: 'hard',
      spot: () => techWin() ? elRect(nodeEl('m2')) : elRect(document.getElementById('sbTech')),
      allow: (o) => o.cmd === 'research' && o.node === 'm2',
      done() { return techHas(PLAYER, 'm2'); } },
    { t: 's11t', x: 's11', lock: 'soft',
      onEnter() { stepState.towers = bCount('tower'); closeBuild(); try { if (techWin()) document.getElementById('techClose').click(); } catch (e) {} },
      spot: () => { if (!buildWin()) return elRect(document.getElementById('sbBuild')); const el = tileEl('tower_A'); return (el && !el.classList.contains('sel')) ? elRect(el) : null; },
      done() { return bCount('tower') > stepState.towers; } },

    /* ── Часть 4: герой ── */
    { t: 's12t', x: 's12', lock: 'hard',
      onEnter() { grant(0, 60); try { if (buildWin()) document.getElementById('sbBuild').click(); } catch (e) {} },
      spot: () => elRect(document.querySelector('#heroBar .av.add')),
      done() { return heroWinOpen(); } },
    { t: 's13t', x: 's13', lock: 'hard',
      spot: () => heroWinOpen() ? elRect(stormSummonBtn()) : elRect(document.querySelector('#heroBar .av.add')),
      allow: (o) => o.cmd === 'summon' && o.id === 'storm',
      done() { try { return (heroSlots[PLAYER] || []).some(h => h.id === 'storm'); } catch (e) { return false; } },
      onDone() { try { closeHeroPick(); } catch (e) {} } },

    /* ── Часть 5: дипломатия — война→оккупация→мир→аннексия ── */
    { t: 's14t', x: 's14', lock: 'hard', spot: () => elRect(document.getElementById('sbPol')),
      done() { return polWin(); } },
    { t: 's15t', x: 's15', lock: 'hard',
      spot: () => polWin() ? elRect(polBtn(IT, 'war')) : elRect(document.getElementById('sbPol')),
      allow: (o) => o.cmd === 'war' && o.tg === IT,
      done() { return atWar(PLAYER, IT); },
      onDone() { // укорачиваем мобилизацию: учим механике ожидания, не скуке
        const s = sim(); if (s) { const k = s.relKey(PLAYER, IT); if (s.warSince[k] != null) s.warSince[k] = s.time - Math.max(0, s.warPrep - WAR_WAIT); }
        try { if (polWin()) document.getElementById('polClose').click(); } catch (e) {} } },
    { t: 's16t', x: 's16', lock: 'none',
      text() { return L().s16.replace('{s}', Math.ceil(warCountdown(PLAYER, IT))); },
      done() { return atWar(PLAYER, IT) && warCountdown(PLAYER, IT) <= 0; } },
    { t: 's17t', x: 's17', lock: 'soft', spot: () => elRect(document.getElementById('pct')),
      done() { try { return +document.getElementById('pct').value >= 100; } catch (e) { return false; } } },
    { t: 's18t', x: 's18', lock: 'soft',
      spot: () => { try { if (typeof dragFrom !== 'undefined' && dragFrom && dragFrom.idx === CITY_LYON) return cityRect(CITY_TURIN); } catch (e) {}
        try { if (playerSel().some(c => c.idx === CITY_LYON)) return cityRect(CITY_TURIN); } catch (e) {}
        return cityRect(CITY_LYON); },
      allow: (o) => o.cmd === 'army' && o.a === CITY_LYON && o.b === CITY_TURIN,
      done() { return lastCmd && lastCmd.cmd === 'army' && lastCmd.b === CITY_TURIN; } },
    { t: 's19t', x: 's19', lock: 'hard',
      onEnter() { const s = sim(); if (s) s.airOrder[PLAYER] = { kind: 'bomb', cityIdx: CITY_TURIN }; }, // авиаудар ляжет точно по Турину
      spot: () => elRect(stormAbilityEl()),
      allow: (o) => o.cmd === 'hero',
      done() { return lastCmd && lastCmd.cmd === 'hero'; },
      onDone() { const s = sim(); if (s) s.airOrder[PLAYER] = null; } },
    { t: 's20t', x: 's20', lock: 'none', spot: () => cityRect(CITY_TURIN),
      done() { const c = cliCity(CITY_TURIN); return c && c.owner === PLAYER; } },
    { t: 's21t', x: 's21', lock: 'soft', spot: () => cityRect(CITY_TURIN),
      onEnter() { try { clearSel(); } catch (e) {} try { if (typeof panelCity !== 'undefined') panelCity = null; } catch (e) {} },
      done() { return typeof panelCity !== 'undefined' && panelCity && panelCity.idx === CITY_TURIN; } },
    { t: 's22t', x: 's22', lock: 'hard', spot: () => elRect(document.getElementById('sbPol')),
      done() { return polWin(); } },
    { t: 's23t', x: 's23', lock: 'hard',
      spot: () => polWin() ? elRect(polBtn(IT, 'peace')) : elRect(document.getElementById('sbPol')),
      done() { const w = document.getElementById('peaceWin'); return w && w.style.display === 'flex'; } },
    { t: 's24t', x: 's24', lock: 'hard', spot: () => elRect(document.getElementById('ptLandBtn')),
      done() { return typeof peaceLand !== 'undefined' && peaceLand === true; } },
    { t: 's25t', x: 's25', lock: 'hard', spot: () => elRect(document.getElementById('peacePropose')),
      allow: (o) => o.cmd === 'peace' && o.tg === IT && !!o.land,
      done() { const c = cliCity(CITY_TURIN); return !atWar(PLAYER, IT) && c && c.owner === PLAYER && !c.occ; } },
    { t: 's26t', x: 's26', lock: 'none', spot: () => cityRect(CITY_TURIN),
      onEnter() { stepState.at = performance.now(); try { const w = document.getElementById('peaceResult'); if (w) w.style.display = 'none'; } catch (e) {} },
      done() { return performance.now() - stepState.at > 4500; } },

    /* ── Часть 6: флот ── */
    { t: 's27t', x: 's27', lock: 'hard',
      onEnter() { grant(350, 0); },
      spot: () => techWin() ? elRect(nodeEl('i1')) : elRect(document.getElementById('sbTech')),
      allow: (o) => o.cmd === 'research' && o.node === 'i1',
      done() { return techHas(PLAYER, 'i1'); } },
    { t: 's28t', x: 's28', lock: 'soft',
      onEnter() { closeBuild(); try { if (techWin()) document.getElementById('techClose').click(); } catch (e) {} },
      spot: () => { if (!buildWin()) return elRect(document.getElementById('sbBuild')); const el = tileEl('shipyard'); return (el && !el.classList.contains('sel')) ? elRect(el) : null; },
      done() { return yardCityIdx(false) >= 0; } },
    { t: 's29t', x: 's29', lock: 'soft',
      spot: () => { const ci = yardCityIdx(false); if (ci < 0) return null;
        return panelSpot(ci, () => { try { return (typeof panelTab !== 'undefined' && panelTab !== 'army') ? document.getElementById('tabArmy') : (shipBuildRow && shipBuildRow.querySelector('.unitBuy')); } catch (e) { return null; } }); },
      allow: (o) => o.cmd === 'bship',
      done() { return lastCmd && lastCmd.cmd === 'bship'; } },

    /* ── Часть 7: авиация ── */
    { t: 's30t', x: 's30', lock: 'hard',
      onEnter() { grant(600, 40); },
      spot: () => techWin() ? elRect(nodeEl('i8')) : elRect(document.getElementById('sbTech')),
      allow: (o) => o.cmd === 'research' && o.node === 'i8',
      done() { return techHas(PLAYER, 'i8'); } },
    { t: 's31t', x: 's31', lock: 'soft',
      onEnter() { closeBuild(); try { if (techWin()) document.getElementById('techClose').click(); } catch (e) {} },
      spot: () => { if (!buildWin()) return elRect(document.getElementById('sbBuild')); const el = tileEl('airport'); return (el && !el.classList.contains('sel')) ? elRect(el) : null; },
      done() { return yardCityIdx(true) >= 0; } },
    { t: 's32t', x: 's32', lock: 'soft',
      spot: () => { const ci = yardCityIdx(true); if (ci < 0) return null;
        return panelSpot(ci, () => { try { return (typeof panelTab !== 'undefined' && panelTab !== 'army') ? document.getElementById('tabArmy') : (planeBuildRow && planeBuildRow.querySelector('.unitBuy')); } catch (e) { return null; } }); },
      allow: (o) => o.cmd === 'bplane',
      done() { return lastCmd && lastCmd.cmd === 'bplane'; } },

    /* ── Часть 8: кризис — освобождение Парижа ── */
    { t: 's33t', x: 's33', lock: 'none', danger: true, spot: () => cityRect(CITY_PARIS),
      onEnter() {
        stepState.at = performance.now();
        const s = sim(); if (!s) return;
        try { if (buildWin()) document.getElementById('sbBuild').click(); } catch (e) {}
        s.setWar(BE, PLAYER);
        s.warSince[s.relKey(BE, PLAYER)] = s.time - s.warPrep - 1;   // война сразу «мобилизована» — контратака доступна
        const p = s.cities.find(c => c.idx === CITY_PARIS);
        if (p) { p.owner = BE; p.occ = true; p.occFrom = PLAYER; p.units = 6; p.batches = []; p.siege = null; p.completedProduction = []; }
      },
      done() { return performance.now() - stepState.at > 5000; } },
    { t: 's34t', x: 's34', lock: 'none',
      done() { try { return playerSel().length >= 2; } catch (e) { return false; } } },
    { t: 's35t', x: 's35', lock: 'soft', spot: () => cityRect(CITY_PARIS),
      allow: (o) => o.cmd === 'army' && o.b === CITY_PARIS,
      done() { const c = cliCity(CITY_PARIS); return c && c.owner === PLAYER; } },

    /* ── Часть 9: хендофф ── */
    { t: 's36t', x: 's36', lock: 'none', final: true, done() { return false; } },
  ];

  /* ── драйвер ── */
  function enterStep(i) {
    idx = i; stepState = {}; lastCmd = null;
    const st = STEPS[idx]; if (!st) return;
    if (st.onEnter) { try { st.onEnter(); } catch (e) { console.warn('[tut] onEnter', e); } }
    coach.classList.toggle('danger', !!st.danger);
    coachBtn.style.display = st.final ? 'block' : 'none';
    if (st.final) { coachBtn.textContent = L().go; coachBtn.onclick = () => endTutorial(false); }
  }
  function render() {
    const st = STEPS[idx]; if (!st) return;
    coach.style.display = 'block';
    coachTitle.textContent = L()[st.t];
    coachText.textContent = st.text ? st.text() : L()[st.x];
    coachMeta.textContent = `${L().step} ${idx + 1}/${STEPS.length}`;
    coach.querySelector('.tskip').textContent = L().skip;
    const r = st.spot ? st.spot() : null;
    if (r) { showSpot(r, st.lock === 'hard'); coach.classList.toggle('bottom', r.y < innerHeight * 0.45); }
    else { hideSpot(); coach.classList.remove('bottom'); }
  }
  function tick() {
    if (!window.TUT.active) return;
    _ticks++;
    const st = STEPS[idx];
    if (!st) return;
    try {
      let ok = false; try { ok = st.done(); } catch (e) {}
      if (ok) {
        if (st.onDone) { try { st.onDone(); } catch (e) {} }
        if (idx + 1 < STEPS.length) enterStep(idx + 1);
        else { endTutorial(false); return; }
      }
      render();
    } catch (e) { console.warn('[tut] tick', e); }
  }
  function rafLoop() { if (!window.TUT.active) return; tick(); requestAnimationFrame(rafLoop); }

  /* ── сетап партии ── */
  function tutorialSetup(s) {
    s.aiEnabled = false;                                   // мир заморожен: никто не объявляет войн и не атакует
    try { IT = FACT_BY_COUNTRY['Италия']; BE = FACT_BY_COUNTRY['Бельгия']; } catch (e) {}   // FACT_BY_COUNTRY: имя → fid (число)
    if (IT == null || BE == null) console.warn('[tut] нет фракций Италия/Бельгия');
    const lyon = s.cities.find(c => c.idx === CITY_LYON), turin = s.cities.find(c => c.idx === CITY_TURIN);
    if (lyon) lyon.units = 35;                             // ударный стек: гарантия захвата (35 > 1.54×12 по Ланчестеру)
    if (turin) turin.units = 12;
    grantTech(PREGRANT_TECH);                              // пререквизиты верфи/аэродрома — игроку остаётся финальный клик
    patchVision(); window.TUT.fullVision = true;           // туман снят на время обучения
    try { syncLocalEcon(s); } catch (e) {}
  }

  /* ── финал: хендофф в живую игру ── */
  function endTutorial(skipped) {
    window.TUT.active = false; window.TUT.fullVision = false;
    unwrapCmd(); hideSpot();
    coach.style.display = 'none';
    const s = sim();
    if (s) {
      // мир с Бельгией (если кризис уже случился) + чистый старт
      if (BE >= 0 && s.relation(PLAYER, BE) === 'war') { s.resolveOccupation(PLAYER, BE, 'white'); s.setRelation(PLAYER, BE, 'neutral'); s.setTruce(PLAYER, BE); }
      s.aiEnabled = true;                                  // ИИ включается — игра оживает
    }
    try { localStorage.setItem('wwc_tut_done', '1'); } catch (e) {}
    say(skipped ? '⚔' : '⚔ ' + L().s36t);
  }

  /* ── запуск: ждём готовности локального сима, авто-выбор Франции ── */
  function begin() {
    buildUI();
    wrapCmd();
    window.TUT.active = true;
    window.TUT._dbg = () => ({ idx, step: STEPS[idx] && STEPS[idx].t, ticks: _ticks,
      done: (() => { try { return STEPS[idx].done(); } catch (e) { return 'ERR:' + e.message; } })() });   // отладка
    window.TUT._tick = tick;                     // ручной прогон (тесты/отладка в скрытой вкладке)
    enterStep(0);
    requestAnimationFrame(rafLoop);
    setInterval(tick, 250);                      // страховка: rAF заморожен в скрытой вкладке
    console.log('[tut] туториал запущен');
  }
  let _ticks = 0;
  // скрыть окно выбора страны до автостарта (иначе мигнёт)
  const preHide = document.createElement('style'); preHide.textContent = '#countryWin{display:none!important}';
  document.head.appendChild(preHide);
  const boot = setInterval(() => {
    // ждём: загрузился серверный сим + собраны фракции
    if (typeof _lsReady === 'undefined' || !_lsReady || typeof selectCountry !== 'function' || typeof FACT_BY_COUNTRY === 'undefined') return;
    clearInterval(boot);
    selectCountry('Франция');                              // wrap из initLocalSim создаст LOCALSIM
    const wait = setInterval(() => {
      const s = sim(); if (!s) return;
      clearInterval(wait);
      preHide.remove();
      tutorialSetup(s);
      begin();
    }, 60);
  }, 120);
})();
