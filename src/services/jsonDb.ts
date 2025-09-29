import { promises as fs } from 'fs';
import path from 'path';
import { CommunityRecord, RunRecord } from '../types/ops.ts';

const baseDir = process.env.DATA_DIR?.trim() || process.cwd();
const dataDir = path.resolve(baseDir, 'data');
const communitiesFile = path.join(dataDir, 'communities.json');
const runsFile = path.join(dataDir, 'runs.json');

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function readJsonArray<T>(file: string): Promise<T[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const arr = JSON.parse(raw) as T[];
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(file: string, arr: T[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(file, JSON.stringify(arr, null, 2), 'utf-8');
}

export async function listCommunities(): Promise<CommunityRecord[]> {
  return readJsonArray<CommunityRecord>(communitiesFile);
}

export async function upsertCommunity(rec: Omit<CommunityRecord, 'id'>): Promise<CommunityRecord> {
  const items = await listCommunities();
  let existing = items.find(
    (x) => x.x_community_url === rec.x_community_url || (!!rec.ticker && !!x.ticker && (rec.ticker as string).toLowerCase() === (x.ticker as string).toLowerCase())
  );
  if (existing) {
    const merged: CommunityRecord = { ...existing, ...rec, id: existing.id } as CommunityRecord;
    const idx = items.findIndex((x) => x.id === existing!.id);
    items[idx] = merged;
    await writeJsonArray(communitiesFile, items);
    return merged;
  }
  const nextId = items.length ? Math.max(...items.map((x) => x.id)) + 1 : 1;
  const created: CommunityRecord = { ...rec, id: nextId } as CommunityRecord;
  items.push(created);
  await writeJsonArray(communitiesFile, items);
  return created;
}

export async function markCommunity(recId: number, patch: Partial<CommunityRecord>): Promise<CommunityRecord | null> {
  const items = await listCommunities();
  const idx = items.findIndex((x) => x.id === recId);
  if (idx === -1) return null;
  const updated = { ...items[idx], ...patch } as CommunityRecord;
  items[idx] = updated;
  await writeJsonArray(communitiesFile, items);
  return updated;
}

export async function appendRun(run: RunRecord): Promise<void> {
  const items = await readJsonArray<RunRecord>(runsFile);
  items.push(run);
  await writeJsonArray(runsFile, items);
  // 轻量级落盘确认（便于用户快速察觉写入路径）
  try {
    await fs.utimes(runsFile, new Date(), new Date());
  } catch {}
}

export async function listRuns(limit = 100): Promise<RunRecord[]> {
  const items = await readJsonArray<RunRecord>(runsFile);
  return items.slice(-limit);
}


