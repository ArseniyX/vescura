import { EnvEntry, ParseResult, ParseWarning } from '../types';

// Matches: KEY=value, KEY="value", KEY='value', export KEY=value
const LINE_RE = /^(?:export\s+)?([\w.]+)\s*=\s*(.*)/;

export function parse(content: string): ParseResult {
  const entries: EnvEntry[] = [];
  const warnings: ParseWarning[] = [];
  const seen = new Map<string, number>();
  let i = 0;
  const lines = content.split('\n');

  while (i < lines.length) {
    const lineNum = i + 1;
    let raw = lines[i];

    if (raw.trim() === '' || raw.trimStart().startsWith('#')) {
      i++;
      continue;
    }

    // handle line continuation (trailing backslash)
    while (raw.endsWith('\\') && i + 1 < lines.length) {
      raw = raw.slice(0, -1) + '\n' + lines[++i];
    }

    const match = LINE_RE.exec(raw);
    if (!match) {
      warnings.push({ line: lineNum, message: `Could not parse line: ${raw.trimEnd()}` });
      i++;
      continue;
    }

    const key = match[1];
    const rawValue = match[2].trim();
    const value = unquote(rawValue);

    if (seen.has(key)) {
      warnings.push({ line: lineNum, message: `Duplicate key "${key}" (first seen on line ${seen.get(key)})` });
    } else {
      seen.set(key, lineNum);
    }

    entries.push({ key, value });
    i++;
  }

  return { entries, warnings };
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    return value.startsWith('"')
      ? inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')
      : inner;
  }
  const commentIdx = value.indexOf(' #');
  return commentIdx >= 0 ? value.slice(0, commentIdx).trim() : value;
}
