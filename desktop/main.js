'use strict';

// CupNet mini — Electron desktop shell.
//
// The shell owns the window and the app icon; it does NOT reimplement any proxy
// logic. It spawns the unchanged mini backend (mini/cupnet-mini.js) as a child
// process running on Electron's own Node (ELECTRON_RUN_AS_NODE=1), waits for the
// control UI to come up, and loads it in a BrowserWindow. The MITM proxy and the
// AzureTLS worker run inside that backend exactly as on the CLI and the server.

const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const APP_ROOT = path.join(__dirname, '..'); // repo root (resources/app when packaged)
const ENTRY = path.join(APP_ROOT, 'mini', 'cupnet-mini.js');

const PROXY_PORT = Number(process.env.CUPNET_MINI_PROXY_PORT) || 8877;
const UI_PORT = Number(process.env.CUPNET_MINI_UI_PORT) || 8878;
// Keep data out of the CLI's ~/.cupnet-mini so a desktop run and a CLI run don't
// fight over the same CA / sessions; override with CUPNET_MINI_DIR if you want to share.
const DATA_DIR = process.env.CUPNET_MINI_DIR || path.join(app.getPath('userData'), 'data');

// Resolved at startup. The UI port is internal, so if it is busy we shift to a
// free one; the proxy port is what the user points their browser at, so we never
// move it silently — a busy proxy port is a clear, hard error instead.
let uiPort = UI_PORT;
let uiOrigin = `http://127.0.0.1:${uiPort}`;

app.setName('CupNet mini');

let backend = null;
let win = null;

function iconPath() {
    // macOS takes its icon from the .app bundle; Windows/Linux windows need an explicit one.
    return path.join(APP_ROOT, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

function fail(message) {
    try { dialog.showErrorBox('CupNet mini', message); } catch { /* before ready */ }
    app.isQuitting = true;
    stopBackend();
    app.quit();
}

function startBackend() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Drop any stale token so waitForUi only ever sees this run's token.
    try { fs.unlinkSync(path.join(DATA_DIR, 'ui-token')); } catch { /* none */ }
    backend = spawn(process.execPath, [
        ENTRY, 'start',
        '--data', DATA_DIR,
        '--port', String(PROXY_PORT),
        '--ui-port', String(uiPort),
    ], {
        cwd: APP_ROOT,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend.stdout.on('data', (d) => process.stdout.write(`[mini] ${d}`));
    backend.stderr.on('data', (d) => process.stderr.write(`[mini] ${d}`));
    backend.on('exit', (code, signal) => {
        backend = null;
        if (!app.isQuitting) fail(`The CupNet mini backend stopped unexpectedly (code ${code}, signal ${signal}).`);
    });
}

function stopBackend() {
    if (backend && !backend.killed) {
        // mini seals the current session on SIGTERM before exiting.
        try { backend.kill('SIGTERM'); } catch { /* ignore */ }
    }
}

function portOpen(port) {
    return new Promise((resolve) => {
        const sock = net.connect(port, '127.0.0.1');
        sock.once('connect', () => { sock.destroy(); resolve(true); });
        sock.once('error', () => resolve(false));
    });
}

// True if we can bind the port on loopback right now (i.e. it is free).
function portFree(port) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
    });
}

// Ask the OS for a free ephemeral port on loopback.
function pickFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const p = srv.address().port;
            srv.close(() => resolve(p));
        });
    });
}

async function resolvePorts() {
    if (!(await portFree(PROXY_PORT))) {
        throw new Error(
            `the proxy port ${PROXY_PORT} is already in use — another CupNet instance may be running. ` +
            `Quit it, or set CUPNET_MINI_PROXY_PORT to a free port and relaunch.`);
    }
    if (!(await portFree(UI_PORT))) {
        uiPort = await pickFreePort();
        uiOrigin = `http://127.0.0.1:${uiPort}`;
    }
}

async function waitForUi(timeoutMs = 25000) {
    const tokenFile = path.join(DATA_DIR, 'ui-token');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!backend) throw new Error('backend exited before the UI was ready');
        if (fs.existsSync(tokenFile) && (await portOpen(uiPort))) {
            const token = fs.readFileSync(tokenFile, 'utf8').trim();
            if (token) return `${uiOrigin}/#t=${token}`;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('the control UI did not start in time');
}

function createWindow(url) {
    win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 900,
        minHeight: 600,
        icon: iconPath(),
        title: 'CupNet mini',
        backgroundColor: '#111317',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.loadURL(url);
    win.on('closed', () => { win = null; });

    // Same-origin pop-ups (viewer / inspector windows) open as child app windows;
    // anything else is a real external link and goes to the system browser.
    win.webContents.setWindowOpenHandler(({ url: target }) => {
        if (target.startsWith(`${uiOrigin}/`)) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    icon: iconPath(),
                    backgroundColor: '#111317',
                    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
                },
            };
        }
        shell.openExternal(target);
        return { action: 'deny' };
    });
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });

    app.whenReady().then(async () => {
        try {
            await resolvePorts();
        } catch (e) {
            fail(`Could not start CupNet mini: ${e.message}`);
            return;
        }
        startBackend();
        try {
            const url = await waitForUi();
            createWindow(url);
        } catch (e) {
            fail(`Could not start CupNet mini: ${e.message}`);
        }
    });

    app.on('window-all-closed', () => {
        app.isQuitting = true;
        stopBackend();
        app.quit();
    });

    app.on('before-quit', () => {
        app.isQuitting = true;
        stopBackend();
    });
}
