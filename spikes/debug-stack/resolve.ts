import path from 'node:path';
import { SourceMapConsumer } from 'source-map-js';

export type Frame = { name: string | null; url: string; line: number; column: number };
export type Location = { file: string; line: number; column: number };

const spikesRoot = path.resolve(import.meta.dirname, '..');

// Line 0 is "Error: react-stack-top-frame", line 1 is the element factory, line 2 is the JSX call site.
export function callSite(stack: string): Frame | null {
  const match = stack.split('\n')[2]?.match(/^\s*at (?:(.+?) \()?(.+):(\d+):(\d+)\)?$/);
  if (!match) return null;
  return { name: match[1] ?? null, url: match[2], line: Number(match[3]), column: Number(match[4]) };
}

function relativeTo(fixtureRoot: string, file: string) {
  const root = path.resolve(spikesRoot, fixtureRoot) + '/';
  return file.startsWith(root) ? file.slice(root.length) : file.replace(/^\//, '');
}

export async function resolveFrame(frame: Frame, fixtureRoot: string): Promise<Location | null> {
  const code = await (await fetch(frame.url)).text();
  const mapUrl = [...code.matchAll(/\/\/# sourceMappingURL=(\S+)/g)].at(-1)?.[1];
  if (!mapUrl) return null;
  const map = mapUrl.startsWith('data:')
    ? JSON.parse(Buffer.from(mapUrl.slice(mapUrl.indexOf(',') + 1), 'base64').toString())
    : await (await fetch(new URL(mapUrl, frame.url))).json();
  const position = new SourceMapConsumer(map).originalPositionFor({ line: frame.line, column: frame.column - 1 });
  if (!position.source) return null;
  const source = new URL(position.source, frame.url);
  const file = source.protocol === 'file:' ? decodeURIComponent(source.pathname) : source.pathname;
  return { file: relativeTo(fixtureRoot, file), line: position.line, column: position.column + 1 };
}

export function fromSource(source: { fileName: string; lineNumber: number; columnNumber: number }, fixtureRoot: string): Location {
  return { file: relativeTo(fixtureRoot, source.fileName), line: source.lineNumber, column: source.columnNumber };
}
