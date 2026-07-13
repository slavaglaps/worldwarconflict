# World War Conflict — десктоп (Electron)

Окно Chromium, **принудительно посаженное на дискретную GPU** (флаги `force-high-performance-gpu` /
`ignore-gpu-blocklist` / `gpu-preference`, недоступные веб-странице). Грузит живой прод
`worldwarconflict.pages.dev` — онлайн и соло работают как на сайте, версия всегда актуальная.

## Собрать `.exe`
`.exe` собирается **только под Windows** (с мака нельзя). Два пути:

### Вариант А — GitHub Actions (рекомендуется)
Пуш в `desktop/**` уже запускает workflow **Build Desktop (Windows .exe)**. Готовый бинарь:
Actions → последний запуск → артефакт **WorldWarConflict-windows** (внутри `*-portable-*.exe` и `*-setup-*.exe`).
Можно запустить и вручную: вкладка Actions → этот workflow → *Run workflow*.

### Вариант Б — локально на Windows-машине
```bash
cd desktop
npm install
npm run dist
# → desktop/dist/WorldWarConflict-portable-1.0.0.exe (без установки, один файл)
#   desktop/dist/WorldWarConflict-setup-1.0.0.exe    (инсталлятор)
```

## Проверить, что игра ушла на дискретную GPU
В окне игры: `Ctrl+Shift+I` → консоль:
```js
const gl=document.querySelector('canvas').getContext('webgl2');
gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
```
Должна быть **дискретная** карта (NVIDIA/RTX/AMD), а не Intel/встройка.

## Запустить в dev (на любой ОС, для проверки логики)
```bash
cd desktop && npm install && npm start
```

## Параметры
- `WWC_URL` — переопределить URL (напр. `WWC_URL=http://localhost:3000/ npm start`).
- `F11` — полный экран, `Ctrl+R` — перезагрузка.
