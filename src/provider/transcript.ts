/**
 * Claude Code transcript reader (side-channel enrichment).
 *
 * The hook keeps markers cheap and writes only what it gets on stdin; richer
 * facts — which model is active, the git branch, tokens generated — live in the
 * session's transcript JSONL. The daemon (never the hook) reads it here to fill
 * those in before rendering.
 *
 * Each line is one JSON entry; the fields we care about (verified against a live
 * transcript): top-level `gitBranch`, and on assistant entries `message.model`
 * and `message.usage.output_tokens`.
 *
 * Reads are cached by (mtime, size): a transcript that hasn't changed since the
 * last tick is returned from cache instead of re-parsed, so an idle session
 * costs nothing.
 */
import { readFileSync, statSync } from 'node:fs';

export interface TranscriptMeta {
  model?: string;
  branch?: string;
  tokens?: number; // total output tokens generated this session
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  meta: TranscriptMeta;
}

const cache = new Map<string, CacheEntry>();

/** Turn a raw model id (`claude-opus-4-8`) into a friendly label (`Opus 4.8`). */
function prettyModel(raw: string): string {
  const m = /claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(raw);
  if (!m) return raw;
  const tier = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return `${tier} ${m[2]}.${m[3]}`;
}

interface TranscriptLine {
  gitBranch?: string;
  message?: { model?: string; usage?: { output_tokens?: number } };
}

function parse(path: string): TranscriptMeta {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }

  let model: string | undefined;
  let branch: string | undefined;
  let tokens = 0;
  let sawTokens = false;

  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line) as TranscriptLine;
    } catch {
      continue; // skip a half-written trailing line
    }

    // `HEAD` means detached / no branch — not worth showing.
    if (typeof entry.gitBranch === 'string' && entry.gitBranch && entry.gitBranch !== 'HEAD') {
      branch = entry.gitBranch;
    }

    const msg = entry.message;
    if (msg && typeof msg === 'object') {
      if (typeof msg.model === 'string' && msg.model && msg.model !== '<synthetic>') {
        model = msg.model; // keep the most recent real model
      }
      const out = msg.usage?.output_tokens;
      if (typeof out === 'number') {
        tokens += out;
        sawTokens = true;
      }
    }
  }

  return {
    model: model ? prettyModel(model) : undefined,
    branch,
    tokens: sawTokens ? tokens : undefined,
  };
}

/** Read enrichment facts from a transcript, cached while the file is unchanged. */
export function readTranscriptMeta(transcriptPath?: string): TranscriptMeta {
  if (!transcriptPath) return {};

  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(transcriptPath);
  } catch {
    return {};
  }

  const cached = cache.get(transcriptPath);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.meta;
  }

  const meta = parse(transcriptPath);
  cache.set(transcriptPath, { mtimeMs: st.mtimeMs, size: st.size, meta });
  return meta;
}
