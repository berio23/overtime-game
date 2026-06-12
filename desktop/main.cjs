// OVERTIME desktop wrapper (Electron main process).
// Serves the game files over a loopback HTTP server (ES-module imports don't
// work over file://) and opens a chromeless window. F11 toggles fullscreen.
// OT_SMOKE=1 env: load, wait, screenshot to temp, quit — used by the build check.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname; // game files are packaged next to this file
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.mp3': 'audio/mpeg', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png'
};

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/') p = '/index.html';
        const file = path.join(ROOT, p);
        if (!file.startsWith(ROOT)) throw new Error('traversal');
        const data = fs.readFileSync(file);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404); res.end('not found');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv)); // random free port, loopback only
  });
}

app.whenReady().then(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const win = new BrowserWindow({
    width: 1280, height: 720,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'OVERTIME — incident 4471',
    webPreferences: { contextIsolation: true }
  });
  win.removeMenu();
  win.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  win.loadURL(`http://127.0.0.1:${port}/`);

  if (process.env.OT_SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 8000)); // let audio load
      const img = await win.webContents.capturePage();
      const out = path.join(app.getPath('temp'), 'ot-desktop-smoke.png');
      fs.writeFileSync(out, img.toPNG());
      console.log('SMOKE OK →', out);
      app.quit();
    });
  }
});

app.on('window-all-closed', () => app.quit());
