// Запуск xTool Studio с её ВСТРОЕННОЙ тёмной темой (xcs-dark) и переключателем Ctrl+Alt+D.
//
// Тема — штатная настройка программы (SYSTEM_SETTINGS.theme), в интерфейсе её просто не вывели.
// Скрипт делает только две вещи:
//  1) чинит баг программы: тёмные цвета модулей (Wujie micro-apps) объявлены через :host.dark,
//     но программа не ставит атрибуты темы на контейнер <wujie-app> — копируем их с <html>;
//  2) Ctrl+Alt+D — переключает тему через штатный канал настроек (сохраняется между запусками).
//
// Запуск: двойной клик по start.vbs (без окна консоли) или: node xtool.mjs
import { spawn, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FIXES_CSS = readFileSync(new URL('./dark-fixes.css', import.meta.url), 'utf8');
const EXE = process.env.XTOOL_EXE || `${process.env.LOCALAPPDATA}\\Programs\\xTool Studio\\xTool Studio.exe`;
const PORT = 9333;

const inject = `(() => {
  if (window.top !== window) return;
  window.__xtFixesCss = ${JSON.stringify(FIXES_CSS)}; // обновляется при каждом внедрении — правки dark-fixes.css подхватываются без перезапуска программы
  if (window.__xtTheme2) return; window.__xtTheme2 = 1;
  const ATTRS = ['data-theme', 'data-studio-theme'], CLASSES = ['dark', 'theme-xcs', 'theme-xcs-dark'];
  const sync = () => {
    const root = document.documentElement; if (!root || !document.head) return;
    for (const host of document.querySelectorAll('wujie-app')) {
      for (const a of ATTRS) { const v = root.getAttribute(a); if (v !== host.getAttribute(a)) v == null ? host.removeAttribute(a) : host.setAttribute(a, v); }
      for (const c of CLASSES) host.classList.toggle(c, root.classList.contains(c));
    }
    // Обёртки компонентов (theme-xcs / theme-xcs-dark) в редакторе не обновляются при смене темы — приводим к теме <html>.
    const dark = root.classList.contains('theme-xcs-dark');
    for (const el of document.querySelectorAll('body .theme-xcs, body .theme-xcs-dark')) {
      el.classList.toggle('theme-xcs-dark', dark); el.classList.toggle('theme-xcs', !dark);
    }
    // Доделки тёмной темы из dark-fixes.css (программа иногда пересобирает <head>, поэтому проверяем каждый раз).
    let s = document.getElementById('xt-dark-fixes');
    if (!s) { s = document.createElement('style'); s.id = 'xt-dark-fixes'; document.head.appendChild(s); }
    if (s.textContent !== window.__xtFixesCss) s.textContent = window.__xtFixesCss;
  };
  setInterval(sync, 300); // ponytail: опрос дешевле, чем следить за атрибутами и появлением модулей

  const apply = theme => dispatchEvent(new CustomEvent('atomm-theme-change', { detail: theme }));
  const ch = new BroadcastChannel('update-system-settings-channel');
  ch.onmessage = e => { const t = e.data?.data?.theme; if (e.data?.eventName === 'update-system-settings' && t) apply(t); };
  addEventListener('keydown', e => {
    if (!(e.ctrlKey && e.altKey && e.code === 'KeyD')) return;
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    ch.postMessage({ eventName: 'update-system-settings', data: { theme } }); // штатно: сохранит настройку и разошлёт другим окнам
    apply(theme);
  }, true);
})();`;

const msg = text => spawn('powershell', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${text}', 'xTool Studio')`], { stdio: 'ignore' });

const list = () => fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const viaPort = await list().then(() => true, () => false);
const running = execSync('tasklist /FI "IMAGENAME eq xTool Studio.exe" /NH').toString().includes('xTool Studio.exe');
if (running && !viaPort) {
  msg('xTool Studio уже открыта обычным способом. Закройте её и запустите этот ярлык ещё раз.');
  setTimeout(() => process.exit(1), 3000);
} else {
  if (!running) spawn(EXE, [`--remote-debugging-port=${PORT}`], { detached: true, stdio: 'ignore' }).unref();

  const attached = new Map(); // target id -> WebSocket
  const send = (ws, method, params = {}) => ws.readyState === 1 && ws.send(JSON.stringify({ id: Date.now() % 1e9, method, params }));
  const attach = t => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    attached.set(t.id, ws);
    ws.onopen = () => {
      send(ws, 'Page.enable');
      send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: inject });
      send(ws, 'Runtime.evaluate', { expression: inject });
    };
    ws.onclose = ws.onerror = () => attached.delete(t.id);
  };

  let seen = false, fails = 0, tick = 0;
  while (true) {
    try {
      for (const t of await list()) if (t.type === 'page' && t.url.startsWith('atomm://') && !attached.has(t.id)) attach(t);
      // Окно могло перезагрузиться, пока мы подключались, — повторяем внедрение (внутри стоит защита от повторов).
      if (++tick % 4 === 0) for (const ws of attached.values()) send(ws, 'Runtime.evaluate', { expression: inject });
      seen = true; fails = 0;
    } catch {
      if (++fails > (seen ? 5 : 120)) process.exit(0); // программа закрыта
    }
    await new Promise(r => setTimeout(r, 500));
  }
}
