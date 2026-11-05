'use strict';

// electron-builder afterPack hook: keep only the AzureTLS worker binary that
// matches the packaged platform/arch, so each build ships one worker (~12 MB)
// instead of all five (~60 MB). Runs for every target, local and CI.

const fs = require('fs');
const path = require('path');

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function wantedWorkers(platform, arch) {
    if (platform === 'darwin') {
        if (arch === 'universal') return ['azuretls-worker-darwin-amd64', 'azuretls-worker-darwin-arm64'];
        return [arch === 'arm64' ? 'azuretls-worker-darwin-arm64' : 'azuretls-worker-darwin-amd64'];
    }
    if (platform === 'linux') return [arch === 'arm64' ? 'azuretls-worker-linux-arm64' : 'azuretls-worker-linux-amd64'];
    if (platform === 'win32') return ['azuretls-worker-win32-amd64.exe'];
    return [];
}

function findWorkerDirs(root) {
    const out = [];
    const walk = (dir) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === 'bin' && path.basename(path.dirname(p)) === 'azuretls-go') out.push(p);
                else walk(p);
            }
        }
    };
    walk(root);
    return out;
}

exports.default = async function afterPack(context) {
    const platform = context.electronPlatformName; // darwin | linux | win32
    const arch = ARCH[context.arch] || 'x64';
    const keep = new Set(wantedWorkers(platform, arch));
    if (!keep.size) return;

    for (const binDir of findWorkerDirs(context.appOutDir)) {
        for (const name of fs.readdirSync(binDir)) {
            if (!name.startsWith('azuretls-worker-')) continue;
            if (!keep.has(name)) fs.rmSync(path.join(binDir, name), { force: true });
        }
    }
};
