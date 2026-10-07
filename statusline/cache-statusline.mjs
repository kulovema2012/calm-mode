// Status-line wrapper for Claude Code: adds the prompt-cache hit rate at the right end of your status line.
//
// Claude Code hands the status line the session's transcript path. This wrapper reads the newest main-thread
// request's usage from the end of that file and shows how much of its prompt the cache served:
//
//   …your status line… | ⚡ cache 87%
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

/** "⚡ cache 87%", colored green at 70% and up, yellow from 30%, red below. */
export function cacheSegment(usage) {
  const read = usage.cache_read_input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  const total = (usage.input_tokens ?? 0) + read + written;
  if (total <= 0) return '';
  if (read === 0 && written > 0) return '\x1b[33m⚡ cache warming up\x1b[0m';
  const percent = Math.round((read / total) * 100);
  const color = percent >= 70 ? '32' : percent >= 30 ? '33' : '31';
  return `\x1b[${color}m⚡ cache ${percent}%\x1b[0m`;
}

let segment = '';
try {
  const transcript = payload?.transcript_path;
  if (transcript && fs.existsSync(transcript)) {
    const usage = lastUsage(transcript);
    if (usage) segment = cacheSegment(usage);
  }
} catch {
  // the meter must never cost you the status line
}

process.stdout.write([inner, segment].filter(Boolean).join(' | '));
