// ── World War Conflict — десктоп-обёртка (Electron) ─────────────────────────
// Смысл exe: окно Chromium, ПРИНУДИТЕЛЬНО посаженное на дискретную GPU. Веб-странице
// это недоступно (только powerPreference-намёк), а в своём приложении мы задаём флаги
// движка → на Windows-ноутах с Optimus/Enduro игра идёт на мощной карте, а не на встройке.
//
// Грузим ЖИВОЙ прод (worldwarconflict.pages.dev): онлайн-комнаты + соло работают как на
// сайте, версия всегда актуальная (обновляется деплоем Pages, exe пересобирать не нужно).
'use strict';
const { app, BrowserWindow, shell, Menu } = require('electron');

// URL живого прода. Переопределяется через WWC_URL (напр. для стейджинга/локали).
const GAME_URL = process.env.WWC_URL || 'https://worldwarconflict.pages.dev/';

// ── форс дискретной GPU (обязательно ДО app.whenReady) ──
app.commandLine.appendSwitch('force-high-performance-gpu');   // Chromium: брать дискретную GPU
app.commandLine.appendSwitch('ignore-gpu-blocklist');          // не отключать ускорение на «неблагонадёжных» драйверах
app.commandLine.appendSwitch('gpu-preference', 'high-performance');

// одно окно на инстанс
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 640,
    backgroundColor: '#0b1118',
    autoHideMenuBar: true,
    title: 'World War Conflict',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);            // без стандартного меню
  win.maximize();
  win.loadURL(GAME_URL);

  // внешние ссылки — в системный браузер, не внутри игры
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(GAME_URL)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  // сеть недоступна → понятная заглушка вместо белого экрана
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    if (code === -3) return;                // ERR_ABORTED (навигация) — игнор
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;'
      + 'background:#0b1118;color:#ffd9c9;font:600 16px/1.5 sans-serif;text-align:center">'
      + '<div>Нет соединения с сервером игры.<br><small style="color:#9db4cc">' + desc + '</small>'
      + '<br><br><a style="color:#ffd23f" href="#" onclick="location.reload()">Повторить</a></div></body>'));
  });

  // F11 — полноэкранный режим, Ctrl+R — перезагрузка
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if ((input.control || input.meta) && input.key.toLowerCase() === 'r') { win.reload(); e.preventDefault(); }
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
