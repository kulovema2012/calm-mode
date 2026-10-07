// Status-line wrapper for Claude Code: adds the prompt cache's hit rate and time left at the right end of your
// status line.
//
// Claude Code hands the status line the newest request's usage (context_window.current_usage) and the cache's
// lifetime (prompt_cache.expires_at). This wrapper shows how much of that request's prompt the cache served and how
// long until the cache goes cold; older builds without those fields fall back to the transcript's last request:
//
//   …your status line… | ⚡ cache 87% · 54m left
//
// The installer (install.mjs) saves whatever status-line command you had into calm-cache-statusline.json beside
// this file; this wrapper runs that command with the same stdin and appends its own segment. Wrapping composes:
// if another tool already wrapped your status line, that wrapper is simply the saved command.
//
// It can never cost you your status line: whatever the saved command printed is always passed through, and any
// failure here leaves that output untouched.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR = path.join(HERE, 'calm-cache-statusline.json');
// Only the end of the transcript is read: enough for the newest request, cheap on long sessions.
const TAIL_BYTES = 512 * 1024;

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = Buffer.concat(chunks).toString('utf8');

let payload = {};
try {
  payload = JSON.parse(input || '{}');
} catch {
  // unreadable input: pass the saved command's output through
}

let saved = '';
try {
  saved = JSON.parse(fs.readFileSync(SIDECAR, 'utf8'))?.command ?? '';
} catch {
  // no saved command: this wrapper is the whole status line
}

let inner = '';
if (saved) {
  const run = spawnSync(saved, { input, shell: true, encoding: 'utf8', timeout: 5000 });
  inner = (run.stdout ?? '').replace(/\s+$/, '');
}

/** The newest main-thread assistant usage in the transcript's tail, or null. */
function lastUsage(transcriptPath) {
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // the first line is cut mid-record
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      let row;
      try {
        row = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (row?.type === 'assistant' && !row.isSidechain && row.message?.usage) return row.message.usage;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const paint = (color, text) => `\x1b[${color}m${text}\x1b[0m`;

/** "87%" of the newest request's prompt read from cache, or "warming up"; undefined with no prompt at all. */
function hitText(usage) {
  const read = usage.cache_read_input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  const total = (usage.input_tokens ?? 0) + read + written;
  if (total <= 0) return undefined;
  if (read === 0 && written > 0) return { text: 'warming up', color: '33' };
  const percent = Math.round((read / total) * 100);
  return { text: `${percent}%`, color: percent >= 70 ? '32' : percent >= 30 ? '33' : '31' };
}

const BAR_CELLS = 10;
const TTL_SECONDS = { '5m': 300, '1h': 3600 };

/**
 * "▰▰▰▰▰▰▰▰▱▱": the share of the cache's lifetime still left, full right after a request and empty when it goes
 * cold. Green over half, yellow over a fifth, red below. Undefined once expired.
 */
export function lifetimeBar(expiresAtSeconds, ttl, nowMs) {
  const left = expiresAtSeconds - nowMs / 1000;
  if (left <= 0) return undefined;
  const lifetime = TTL_SECONDS[ttl] ?? Math.max(left, 300);
  const share = Math.min(1, left / lifetime);
  const filled = Math.max(1, Math.ceil(share * BAR_CELLS));
  const color = share > 0.5 ? '32' : share > 0.2 ? '33' : '31';
  return paint(color, '▰'.repeat(filled)) + paint('90', '▱'.repeat(BAR_CELLS - filled));
}

/**
 * "⚡ cache 87% ▰▰▰▰▰▰▰▰▱▱": the newest request's hit rate, colored green at 70% and up, yellow from 30%, red below,
 * then a bar of the cache's lifetime left. "❄ cache cold" once it has expired.
 */
export function cacheSegment(usage, promptCache, nowMs) {
  if (promptCache && promptCache.caching_observed && promptCache.warm === false) {
    return paint('90', '❄ cache cold');
  }
  const hit = usage ? hitText(usage) : undefined;
  const expiresAt = typeof promptCache?.expires_at === 'number' ? promptCache.expires_at : undefined;
  const bar = expiresAt === undefined ? undefined : lifetimeBar(expiresAt, promptCache?.ttl, nowMs);
  if (expiresAt !== undefined && bar === undefined) return paint('90', '❄ cache cold');
  if (!hit && !bar) return '';
  const label = hit ? paint(hit.color, `⚡ cache ${hit.text}`) : paint('32', '⚡ cache');
  return bar ? `${label} ${bar}` : label;
}

let segment = '';
try {
  // Claude Code hands the newest request's usage and the cache's lifetime to the status line; the transcript is
  // only a fallback for builds that do not.
  let usage = payload?.context_window?.current_usage ?? null;
  const transcript = payload?.transcript_path;
  if (!usage && transcript && fs.existsSync(transcript)) usage = lastUsage(transcript);
  segment = cacheSegment(usage, payload?.prompt_cache ?? null, Date.now());
} catch {
  // the meter must never cost you the status line
}

process.stdout.write([inner, segment].filter(Boolean).join(' | '));
