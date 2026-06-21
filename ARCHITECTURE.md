# Voxel Wars — архитектура проекта

Документ описывает структуру, модель данных, механики и **сетевую архитектуру** игры.
Для краткого «контекста новой сессии» см. [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).

---

## 1. Что это

Браузерная RTS-стратегия: гибрид **Mushroom Wars** (захват городов роями юнитов) и **grand strategy**
(карта Европы, 24 страны-фракции, дипломатия, тех-дерево, флот/авиация). 3D-воксельный стиль.
Поддерживает **мультиплеер** (host-authoritative, до N игроков в комнате).

Похожие игры: Rise of Nations (Roblox), Mushroom Wars 2, Supremacy 1914.

---

## 2. Структура файлов

```
mushroom-wars-clone/
├── ARCHITECTURE.md          ← этот файл
├── PROJECT_CONTEXT.md       ← краткий контекст для новой сессии
├── index.html               2D-предок (грибы) — не трогаем
├── europe.html              2D-предок (карта Европы) — источник координат городов
└── tiny-world-builder/      ← движок (склон https://github.com/jasonkneen/tiny-world-builder)
    ├── game.html            ★ ВСЯ ИГРА (~4500 строк, один инлайн-<script>)
    ├── mp-*.js              старые/отладочные клиентские сетевые тесты
    ├── vendor/three/        Three.js r128 (глобал THREE)
    └── tools/dev-server.js  статический дев-сервер
```

**Вся игра — в `tiny-world-builder/game.html`** (HTML + CSS + один большой `<script>`).
Движок Tiny World Builder используется только как поставщик Three.js r128 (`vendor/three`) и визуального
стиля; собственный 29k-строчный редактор движка (`tiny-world-builder.html`) игрой не используется.

---

## 3. Запуск и тестирование

```bash
cd tiny-world-builder
node tools/dev-server.js 3000     # игра: http://localhost:3000/game.html
cd ../server && npm start         # Colyseus backend
```

- **Одиночная игра:** `http://localhost:3000/game.html`
- **Мультиплеер:** `http://localhost:3000/game.html?mp=ROOM` или лобби `tiny-world-builder/index.html`
- ⚠️ Карта/ландшафт строятся ОДИН РАЗ при загрузке. **R** в игре пересоздаёт только партию
  (города/фракции/дипломатию), не карту — для изменений карты нужен полный Cmd+R.

**Проверка синтаксиса (обязательно после правок):**
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('game.html','utf8');
const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');
fs.writeFileSync('/tmp/g.js',m);" && node --check /tmp/g.js && echo OK
```

**E2E-тесты сети:** `cd server && npm test`.

---

## 4. Слой движка (Three.js)

- `THREE` грузится глобально из `vendor/three/three.r128.min.js`; в коде `const T3 = THREE`.
- Камера — орбитальная (`orbit={r,theta,phi}`, `applyCam()`), ПКМ-панорама, колесо — зум.
- Рендер: вода = 1 плоскость с шейдером волн; суша = `InstancedMesh` по высоте (Perlin + горы);
  леса/скалы/облака — тоже `InstancedMesh`. Подписи городов — DOM-элементы, спроецированные на экран.

---

## 5. Модель данных

### Карта (география)
- `GRID=256, TILE=1` — мир 256×256 тайлов. Проекция lon/lat → тайлы.
- **24 фракции** = страны. `FACTIONS[fid] = {id,country,color,...}`, `FACT_BY_COUNTRY[country]=fid`.
  **ID фракции детерминирован** (порядок уникальных стран в `CITY_LIST`) → одинаков у всех клиентов.
- **130+ городов** из `CITY_LIST` (реальные координаты), `CITY_DATA` → объекты `City`.
- Контуры стран — полигоны (point-in-polygon → суша). Дороги — граф `EDGES/ADJ`, путь — Дейкстра (`MinHeap`).

### Глобальное состояние (массивы по fid)
```
let cities, squads, ships, planes, missiles, fx   // игровые объекты
let gold[], politPts[], manpower[]                 // ресурсы по фракциям
let relations{}, warSince{}, truceUntil{}          // дипломатия: ключ "a_b" (a<b)
let PLAYER, OWNER.PLAYER                            // фракция локального игрока
let gameTime, gameSpeed, gameOver
```

### Классы (строки в game.html)
| Класс | Назначение |
|---|---|
| `City` (1673) | город: owner, units, size, tier, spec, occ, siege, batches (очередь найма), isShipyard/isAirport |
| `Squad` (2082) | армия-рой по дорогам (`fcount`, `path`, `pos`) |
| `Ship` (2266) | корабль: hp, target, foe, обстрел берега ракетами |
| `Plane` (2559) | самолёт: hp, полёт по `airOrder[fid]`, бомбёжка |
| `Missile`/`TowerShot`/`Bomb` (2390/2441/2511) | снаряды (баллистика, выстрелы башен, авиабомбы) |
| `MinHeap` (2180) | для Дейкстры (поиск пути) |

### Ключевые константы
```
MAX_TIER=3, SOLDIER_PRICE=4, SQUAD_SPEED=4, WAR_PREP=60 (мобилизация, сек)
Манпауэр: MP_BASE=20, MP_PER_SIZE/TIER=12, MP_CAPITAL=1.6
Политочки: POLIT_WAR=50, POLIT_ALLY=10, POLIT_PEACE=20, POLIT_BREAK=20, POLIT_MAX=120
Башни (atk-город): TOWER_RANGE_BASE=8 +4/тир, TOWER_FIRE_CD=1.1
Флот: SHIP_COST=40, SHIP_HP=30, SHIP_ATTACK_RANGE=16, SHIPYARD_BUILD_COST=120
Авиация: PLANE_COST=55, PLANE_HP=22, PLANE_ALT=4.5, AIRPORT_BUILD_COST=150
```

---

## 6. Игровые механики

- **Экономика:** города дают голду владельцу. Армия покупается (`SOLDIER_PRICE`), обучается батчами
  (`City.batches` — очередь, приходит пачкой через время).
- **Прокачка города** (`upgradeCity`, тратит гарнизон): 3 ветки `prod/def/atk`, тиры 1-3.
  Меняет силуэт (`buildMeshes`). atk-города стреляют по врагам в радиусе (`cityTowers` → `TowerShot`).
- **Движение армий по дорогам** (`findPath`): road / pass (горы ×0.5) / ferry (вода ×0.7).
  Через нейтралов нет прохода, через союзников — да. Первый враждебный узел на пути = цель боя.
- **Бой:** мгновенный захват (атака > защиты) ИЛИ **осада** (`City.siege`, бой во времени).
  Захват **через осаду** ставит `occ=true` (оккупация, провизорно до мира); мгновенный — аннексирует.
- **Дипломатия:** нейтралитет/война/союз. Атаковать только при войне после мобилизации (`WAR_PREP`).
  Мир (`openPeaceDialog` / `resolveOccupation`) разрешает оккупацию (keep=аннексия / white=возврат).
- **Тех-дерево** (`NODES`, `researchNode`, `advanceResearch`): 5 веток, исследования во времени,
  открывают верфь (`ships`), корабельные ракеты (`shipMissile`), аэродром (`planes`), бомбёжку (`planeBomb`).
- **Флот/авиация:** ЛЮБАЯ фракция строит **Верфь** в прибрежном городе и **Аэропорт** в любом
  (`buildYard` → новый под-город, связанный дорогой). Производство — очередью (`shipQueue`/`planeQueue`).
  Управление: выбор клик/рамкой (`selectedUnits`), движение `setTarget`; авиация — приказ от аэропорта
  (`setAirOrder` → `airOrder[fid]`). Бои: `navalBattles`, `airBattles`; зенитки городов (`cityAA`).
- **ИИ** (`aiUpdate`→`aiActFaction`): дипломатия, тех, найм, прокачка, атака. Пропускает фракции людей в MP.
- **Win/lose:** остаться единственной живой фракцией / потерять все города.

---

## 7. Сетевая архитектура (мультиплеер) ★

**Модель: server-authoritative на Colyseus.** Сервер крутит чистую симуляцию `server/sim/Sim.js`,
клиенты НЕ симулируют — зеркалят schema-state Colyseus, а свои действия шлют командами в `GameRoom`.

### Транспорт
- `server/index.js` + `server/GameRoom.js` — актуальный Colyseus backend.
- `tiny-world-builder/game.html` подключается как богатый клиент: bridge переводит Colyseus schema-state
  в локальные `snap/ent` события для существующего рендера.

### Роли (глобал `MP`)
```
MP = { on, host, guest, id, hostId, sock, humans:Set, assign:{clientId→fid}, ghosts:Map, ... }
```
- В online-режиме `MP.guest=true`: браузер не является хостом.
- Фракцию назначает сервер через `assigned`; если выбранная страна занята, клиент переключается на
  фактически выданную сервером фракцию.

### Протокол сообщений
```
Colyseus schema: GameState { cities, squads, ships, planes, gold, manpower, politPts, relations }
client→server: buy/upg/send/war/ally/break/sup/peace/research/bship/bplane/shipmove/airorder/aa/yard
server→client message: assigned{faction,you}, denied{cmd}
```

### Синхронизация
Colyseus сам шлёт бинарные дельты schema-state. В `game.html` bridge собирает из schema локальные
`snap`/`ent` события, чтобы переиспользовать существующие `applySnap()`/`reconcile()` и богатый Three.js рендер.

### Команды клиента
`army, buy, upg` (город) · `war, ally, peace, break, sup` (дипломатия) ·
`yard, bship, bplane` (постройка верфи/аэропорта/флота/авиации) · `shipmove, airorder` (управление юнитами).
Все команды валидируются на сервере через `Sim.cmd*`: владение, диапазоны id, ресурсы, состояние войны,
проценты отправки армии и условия мира.

### Зеркала сущностей (ghosts)
Гость держит `MP.ghosts:Map(id→ghost)`; `reconcile()` создаёт/двигает/удаляет лёгкие меши по `ent`.
Ghost несёт `_mpid/owner/pos/isAir/mat` — этого хватает, чтобы гость **выбирал свои корабли** (рейкаст
по ghosts) и слал `shipmove`/`airorder` (см. `pickUnit` гостевую ветку).

### Защита от ложного финала
Гость показывает «Победа/Поражение» только если: получил **полный keyframe** (`MP._synced`) И
**видел партию идущей** (`MP._sawRunning` — синхрон + `over:0` + есть свои города). Это исключает
ложное поражение на переходе вход→синхрон и при входе в уже завершённую чужую партию.

### Инварианты MP (важно)
- Браузер-хоста больше нет; выход одного игрока не останавливает комнату.
- `R` в online-клиенте не должен считаться авторитетным рестартом комнаты.
- Одиночная игра идентична без online-параметров.

---

## 8. Горячие пути и оптимизация
- Главный цикл `loop()`: симуляция (гейт `!gameOver && gdt>0 && !MP.guest`) → апдейт мешей/подписей → рендер.
- `assignRegions()` (покраска тайлов по владельцу) троттлится через `regionsDirty`/`markRegions()`.
- Поиск города по idx — O(1) (`byIdx`) в сетевом пути; в остальном местами ещё `cities.find` (кандидаты на оптимизацию).
- Подписи прячутся во время поворота камеры (иначе дрожат).

## 9. Известные упрощения / TODO
- ИИ пока не строит флот/авиацию (только люди); ИИ-фракции воюют армиями.
- Нет миграции хоста; тех-дерево/герои гостя визуально не синхронятся (эффекты идут через стейт).
- `game.html` — монолит; разбиение на модули — кандидат на будущий рефактор (отдельными безопасными шагами).
