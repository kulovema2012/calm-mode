// Installs or removes Calm Mode's cache meter in your Claude Code status line.
//
//   node install.mjs install     wrap your current status line and add "⚡ cache 87%" at its right end
//   node install.mjs uninstall   put your previous status line back
//   node install.mjs status      say whether it is installed
//
// The wrapper is copied to ~/.claude/hooks/calm-cache-statusline.mjs (outside the plugin, so plugin updates never
// break your status line), your previous status-line command is saved beside it in calm-cache-statusline.json,
// and settings.json is backed up to settings.json.calm-backup before every change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE, 'settings.json');
const HOOKS = path.join(CLAUDE, 'hooks');
const SCRIPT = path.join(HOOKS, 'calm-cache-statusline.mjs');
const SIDECAR = path.join(HOOKS, 'calm-cache-statusline.json');
const COMMAND = `node "${SCRIPT.split(path.sep).join('/')}"`;

function readSettings() {
  if (!fs.existsSync(SETTINGS)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
}

function writeSettings(settings) {
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.calm-backup`);
  fs.writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
}

const isInstalled = settings => settings.statusLine?.command === COMMAND;

/**
 * Status-line wrappers nest (one wrapper's saved command is the next wrapper), each saving the command it wraps in
 * a sidecar ~/.claude/hooks/<name>.json as { "command": ... }. When another wrapper sits outside this one, removing
 * this one means handing that wrapper the command this one was wrapping, or the chain breaks. Returns whether a
 * sidecar pointed at this wrapper.
 */
function repairChain(previous) {
  let repaired = false;
  for (const name of fs.existsSync(HOOKS) ? fs.readdirSync(HOOKS) : []) {
    const file = path.join(HOOKS, name);
    if (!name.endsWith('.json') || file === SIDECAR) continue;
    try {
      const sidecar = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof sidecar?.command === 'string' && sidecar.command.includes('calm-cache-statusline.mjs')) {
        fs.writeFileSync(file, `${JSON.stringify({ ...sidecar, command: previous }, null, 2)}\n`);
        repaired = true;
      }
    } catch {
      // not a wrapper sidecar
    }
  }
  return repaired;
}

const action = process.argv[2] ?? 'status';
const settings = readSettings();

if (action === 'install') {
  fs.mkdirSync(HOOKS, { recursive: true });
  fs.copyFileSync(path.join(HERE, 'cache-statusline.mjs'), SCRIPT);
  if (isInstalled(settings)) {
    console.log('The cache meter is already in your status line (wrapper updated).');
  } else {
    const previous = settings.statusLine?.type === 'command' ? settings.statusLine.command ?? '' : '';
    fs.writeFileSync(SIDECAR, `${JSON.stringify({ command: previous }, null, 2)}\n`);
    writeSettings({ ...settings, statusLine: { ...(settings.statusLine ?? {}), type: 'command', command: COMMAND } });
    console.log('Added the cache meter to the right end of your status line.');
  }
} else if (action === 'uninstall') {
  let previous = '';
  try {
    previous = JSON.parse(fs.readFileSync(SIDECAR, 'utf8'))?.command ?? '';
  } catch {
    // no saved command: the cache meter was the whole status line
  }
  if (isInstalled(settings)) {
    const next = { ...settings };
    if (previous) {
      next.statusLine = { ...settings.statusLine, command: previous };
    } else {
      delete next.statusLine;
    }
    writeSettings(next);
    console.log('Removed the cache meter; your previous status line is back.');
  } else if (repairChain(previous)) {
    console.log('Removed the cache meter from the middle of your status-line chain.');
  } else {
    console.log('The cache meter is not in your status line.');
  }
} else {
  console.log(isInstalled(settings) ? 'installed' : 'not installed');
}
