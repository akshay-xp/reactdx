import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RDT_ID = 'fmkadmapgofadopljbjfkapdkoienihi';
export const rdtDir = path.resolve(import.meta.dirname, 'rdt');

export async function ensureRdt() {
  if (existsSync(path.join(rdtDir, 'manifest.json'))) return;
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=156.0&acceptformat=crx2,crx3&x=id%3D${RDT_ID}%26uc`;
  const crx = Buffer.from(await (await fetch(url)).arrayBuffer());
  mkdirSync(rdtDir, { recursive: true });
  const crxPath = path.join(rdtDir, 'rdt.crx');
  writeFileSync(crxPath, crx);
  try {
    execFileSync('unzip', ['-q', '-o', crxPath, '-d', rdtDir], { stdio: 'ignore' });
  } catch (error: any) {
    // unzip exits 1 on the CRX header bytes it skips; the archive is still extracted.
    if (error.status !== 1) throw error;
  }
}
