import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const load = async (url: URL) =>
  url.protocol === 'file:' ? readFile(fileURLToPath(url), 'utf8') : (await fetch(url)).text();

// Server Component call sites point at the server chunk on disk: about://React/Server/file:///…/chunk.js?<n>
const chunkUrl = (url: string) => new URL(url.replace(/^about:\/\/React\/Server\/(file:\/\/[^?]+)(\?.*)?$/, '$1'));

export async function resolveFrame(frame: Frame, fixtureRoot: string): Promise<Location | null> {
  const url = chunkUrl(frame.url);
  const code = await load(url);
  const mapUrl = [...code.matchAll(/\/\/# sourceMappingURL=(\S+)/g)].at(-1)?.[1];
  if (!mapUrl) return null;
  const map = mapUrl.startsWith('data:')
    ? JSON.parse(Buffer.from(mapUrl.slice(mapUrl.indexOf(',') + 1), 'base64').toString())
    : JSON.parse(await load(new URL(mapUrl, url)));
  const position = new SourceMapConsumer(map).originalPositionFor({ line: frame.line, column: frame.column - 1 });
  if (!position.source) return null;
  const source = new URL(position.source, url);
  const file = source.protocol === 'file:' ? decodeURIComponent(source.pathname) : source.pathname;
  return { file: relativeTo(fixtureRoot, file), line: position.line, column: position.column + 1 };
}

export function fromSource(source: { fileName: string; lineNumber: number; columnNumber: number }, fixtureRoot: string): Location {
  return { file: relativeTo(fixtureRoot, source.fileName), line: source.lineNumber, column: source.columnNumber };
}

// React 19 stacks need source maps; React 18's _debugSource is already a location.
export async function locate(component: { stack: string | null; source: any }, fixtureRoot: string): Promise<Location | null> {
  const frame = component.stack && callSite(component.stack);
  if (frame) return resolveFrame(frame, fixtureRoot);
  return component.source && fromSource(component.source, fixtureRoot);
}

// A component's own file is where the elements it renders were created.
export async function definedIn(name: string, components: any[], fixtureRoot: string): Promise<Location | null> {
  for (const owned of components.filter((component) => component.ownerName === name)) {
    const location = await locate(owned, fixtureRoot);
    if (location) return location;
  }
  return null;
}
