import { listCommunities } from './jsonDb.ts';

function withinMs(tsIso: string, windowMs: number): boolean {
  const ts = new Date(tsIso).getTime();
  return Date.now() - ts <= windowMs;
}

export async function canPostMoreToday(): Promise<boolean> {
  const dailyLimit = parseInt(process.env.DAILY_LIMIT || '10', 10);
  const all = await listCommunities();
  const postedToday = all.filter((c) => c.posted_personal_at && withinMs(c.posted_personal_at, 24 * 60 * 60 * 1000)).length;
  return postedToday < dailyLimit;
}

export async function canPostThisHour(): Promise<boolean> {
  const hourlyLimit = parseInt(process.env.HOURLY_LIMIT || '1', 10);
  const all = await listCommunities();
  const postedHour = all.filter((c) => c.posted_personal_at && withinMs(c.posted_personal_at, 60 * 60 * 1000)).length;
  return postedHour < hourlyLimit;
}


