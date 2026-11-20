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
  if (window.__xtTheme2 || window.top !== window) return; window.__xtTheme2 = 1;
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
    if (!document.getElementById('xt-dark-fixes')) {
      const s = document.createElement('style'); s.id = 'xt-dark-fixes'; s.textContent = ${JSON.stringify(FIXES_CSS)};
      document.head.appendChild(s);
    }
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

  const attached = new Set();
  const attach = t => {
    attached.add(t.id);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.addScriptToEvaluateOnNewDocument', params: { source: inject } }));
      ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: inject } }));
    };
    ws.onclose = ws.onerror = () => attached.delete(t.id);
  };

  let seen = false, fails = 0;
  while (true) {
    try {
      for (const t of await list()) if (t.type === 'page' && t.url.startsWith('atomm://') && !attached.has(t.id)) attach(t);
      seen = true; fails = 0;
    } catch {
      if (++fails > (seen ? 5 : 120)) process.exit(0); // программа закрыта
    }
    await new Promise(r => setTimeout(r, 500));
  }
}
