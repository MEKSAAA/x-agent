import { promises as fs } from 'fs';
import path from 'path';

const dataDir = path.resolve(process.cwd(), 'data');
const linksFile = path.join(dataDir, 'seen-links.json');

async function ensureDataDir() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (_) {}
}

export async function loadSeenLinks(): Promise<Set<string>> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(linksFile, 'utf-8');
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch (_) {
    return new Set();
  }
}

export async function saveSeenLinks(seen: Set<string>): Promise<void> {
  await ensureDataDir();
  const arr = Array.from(seen);
  await fs.writeFile(linksFile, JSON.stringify(arr, null, 2), 'utf-8');
}


