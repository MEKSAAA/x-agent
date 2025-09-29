import { logger } from '@elizaos/core';
import type { Browser, Page } from 'playwright';
import { upsertCommunity, appendRun } from './jsonDb.ts';
import path from 'path';
import { promises as fs } from 'fs';

export interface AxiomItem {
  x_community_url: string;
  token_full_name: string;
  ticker: string;
  axiom_row_url: string;
  avatar_url?: string;
}

async function closeSignUpIfPresent(page: Page) {
  try {
    const modal = page.getByText(/sign up/i);
    if (await modal.count()) {
      const closeIcon = page.locator('button:has(i.ri-close-line), button[aria-label="Close"], button[aria-label="close"]');
      if (await closeIcon.count()) {
        await closeIcon.first().click({ timeout: 2000 }).catch(() => {});
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }
  } catch {}
}

async function debugDump(page: Page, tag: string) {
  if ((process.env.AXIOM_DEBUG || '0') !== '1') return;
  const dir = path.resolve(process.cwd(), 'data', 'axiom-debug');
  await fs.mkdir(dir, { recursive: true });
  const ts = Date.now();
  const shot = path.join(dir, `${tag}-${ts}.png`);
  const html = path.join(dir, `${tag}-${ts}.html`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  const content = await page.content().catch(() => '');
  await fs.writeFile(html, content || '', 'utf-8').catch(() => {});
}

async function writeScrollLog(entry: Record<string, any>) {
  if ((process.env.AXIOM_DEBUG || '0') !== '1') return;
  const dir = path.resolve(process.cwd(), 'data', 'axiom-debug');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'scroll-log.ndjson');
  await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf-8').catch(() => {});
}

async function debugAfterScroll(page: Page, attempt: number, step: number) {
  if ((process.env.AXIOM_DEBUG || '0') !== '1') return;
  if ((process.env.AXIOM_DEBUG_SCROLL || '0') !== '1') return;
  const everyRaw = process.env.AXIOM_DEBUG_SCROLL_EVERY || '8';
  const every = Number(everyRaw);
  if (Number.isFinite(every) && every > 1 && step % every !== 0 && step !== 0) return;
  await debugDump(page, `after-scroll-a${attempt}-s${step}`);
}

async function getMaxDataIndex(page: Page): Promise<number> {
  try {
    return await page.evaluate(() => {
      const sec = document.querySelector('section[aria-label="Table content"]');
      const nodes = sec ? sec.querySelectorAll('div[data-index]') : document.querySelectorAll('div[data-index]');
      let max = -1;
      nodes.forEach((n) => {
        const v = Number((n as HTMLElement).getAttribute('data-index') || '-1');
        if (!Number.isNaN(v)) max = Math.max(max, v);
      });
      return max;
    });
  } catch {
    return -1;
  }
}

async function scrollSmart(page: Page, stepFactor = 0.8) {
  await page.evaluate((factor) => {
    const known = Array.from(document.querySelectorAll(
      'section[aria-label="Table content"], [role="table"], [data-radix-scroll-area-viewport], [data-viewport]'
    )) as HTMLElement[];
    const dynamic = Array.from(document.querySelectorAll('*')).filter((el) => {
      try {
        const st = getComputedStyle(el as Element);
        const oy = st.overflowY;
        const h = (el as HTMLElement).clientHeight;
        const sh = (el as HTMLElement).scrollHeight;
        return (oy === 'auto' || oy === 'scroll') && sh > h + 10 && h > 100;
      } catch {
        return false;
      }
    }) as HTMLElement[];
    const candidates = Array.from(new Set([...known, ...dynamic])).slice(0, 10);
    const stepWindow = Math.floor((window.innerHeight || 1200) * factor);

    let didAny = false;
    for (const el of candidates) {
      const step = Math.floor(((el.clientHeight || 0) || (window.innerHeight || 1200)) * factor);
      const before = el.scrollTop;
      try { (el as any).style.scrollBehavior = 'auto'; } catch {}
      el.scrollTop = before + (step || stepWindow);
      if (el.scrollTop !== before) didAny = true;
    }

    if (!didAny) {
      window.scrollBy(0, stepWindow);
    }
  }, stepFactor).catch(() => {});

  try {
    const viewportH = await page.evaluate(() => window.innerHeight).catch(() => 1200);
    const delta = Math.max(600, (typeof viewportH === 'number' ? viewportH : 1200) * stepFactor);
    await page.mouse.wheel(0, delta).catch(() => {});
    await page.keyboard.press('PageDown').catch(() => {});
  } catch {}
}

async function navigateTrending30m(page: Page) {
  const baseDiscover = process.env.AXIOM_URL?.trim() || 'https://axiom.trade/discover';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(baseDiscover, { waitUntil: 'domcontentloaded' });
    } catch {}
    await page.waitForLoadState('networkidle').catch(() => {});
    await debugDump(page, `after-navigate`);

    await closeSignUpIfPresent(page);

    const pathname: string = await page.evaluate(() => location.pathname).catch(() => '/');
    if (!/\/discover/i.test(pathname)) {
      const discoverLink = page.locator('a[href="/discover"]');
      if (await discoverLink.count()) {
        await discoverLink.first().click({ timeout: 5000, force: true }).catch(() => {});
        await page.waitForURL(/\/discover/i, { timeout: 10000 }).catch(() => {});
      }
    }

    const trendingBtn = page.getByRole('button', { name: /trending/i }).or(page.getByText(/\bTrending\b/i));
    if (await trendingBtn.count()) {
      await trendingBtn.first().click({ timeout: 5000 }).catch(() => {});
    }

    const filter30m = page.getByRole('button', { name: /30m/i }).or(page.getByText(/\b30m\b/i));
    if (await filter30m.count()) {
      await filter30m.first().click({ timeout: 5000 }).catch(() => {});
    }

    const firstRow = page.locator('section[aria-label="Table content"] div[data-index="0"]');
    const hadFirstRow = await firstRow.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    const anyXLink = page.locator('section[aria-label="Table content"] a[href*="x.com/"]');
    await anyXLink.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});

    await debugDump(page, `after-wait-discover`);

    if (hadFirstRow) {
      return;
    }

    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
}

async function collectVisibleCommunities(page: Page, items: AxiomItem[], seen: Set<string>, TARGET_ITEMS: number, MAX_ITEMS: number) {
  const rowContainers = await page.locator('section[aria-label="Table content"] div[data-index]').all();
  for (const row of rowContainers) {
    try {
      const hasGroupIcon = await row.locator('[class*="ri-group-3-line"], i.ri-group-3-line').count();
      if (!hasGroupIcon) continue;
      const communityEls = await row.locator('a[href*="x.com/i/communities"], a[href*="twitter.com/i/communities"]').all();
      if (!communityEls.length) continue;
      const href = (await communityEls[0].getAttribute('href')) || '';
      if (!href || seen.has(href)) continue;
      const x_community_url = href;

      let token_full_name = 'Unknown';
      const imgAlt = row.locator('img[alt]');
      if (await imgAlt.count()) {
        const alt = (await imgAlt.first().getAttribute('alt')) || '';
        if (alt.trim()) token_full_name = alt.trim();
      }
      if (token_full_name === 'Unknown') {
        const txt = ((await row.innerText()) || '').trim();
        token_full_name = txt.split('\n').map((s) => s.trim()).find((s) => s && s.length <= 40) || 'Unknown';
      }

      const avatarEl = row.locator('img');
      const avatar_url_remote = (await avatarEl.count()) ? (await avatarEl.first().getAttribute('src')) || undefined : undefined;

      const axiomAnchor = row.locator('a[href^="https://axiom.trade"]').first();
      let axiom_row_url = 'https://axiom.trade/discover';
      if (await axiomAnchor.count()) {
        axiom_row_url = (await axiomAnchor.getAttribute('href')) || axiom_row_url;
      }

      const ticker = '';

      items.push({ x_community_url, token_full_name, ticker, axiom_row_url, avatar_url: avatar_url_remote });
      seen.add(x_community_url);

      if (items.length >= TARGET_ITEMS || items.length >= MAX_ITEMS) return;
    } catch (e) {
      logger.warn({ e: String(e) }, 'collectVisibleCommunities parse error');
    }
  }
}

async function extractRows(page: Page): Promise<AxiomItem[]> {
  const items: AxiomItem[] = [];
  const seen = new Set<string>();
  const TARGET_ITEMS = Number(process.env.AXIOM_TARGET_ITEMS || '3');
  const SCROLL_STEPS = Number(process.env.AXIOM_SCROLL_STEPS || '3');
  const SCROLL_WAIT_MS = Number(process.env.AXIOM_SCROLL_WAIT_MS || '1000');
  const MAX_ITEMS = Math.max(TARGET_ITEMS, Number(process.env.AXIOM_MAX_ITEMS || '10'));
  const CONTINUE_TRIES = Number(process.env.AXIOM_SCROLL_CONTINUE_TRIES || '12');

  // 预热
  try {
    const sec = page.locator('section[aria-label="Table content"]');
    if (await sec.count()) {
      const box = await sec.first().boundingBox().catch(() => null);
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, Math.max(40, box.height - 100))).catch(() => {});
      }
    }
    await scrollSmart(page, 0.6);
    await page.waitForTimeout(700);
  } catch {}

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await collectVisibleCommunities(page, items, seen, TARGET_ITEMS, MAX_ITEMS);
      if (items.length >= TARGET_ITEMS || items.length >= MAX_ITEMS) return items;

      await debugDump(page, `extract-attempt-${attempt}-count-${items.length}`);

      const steps = Number.isFinite(SCROLL_STEPS) && SCROLL_STEPS > 0 ? SCROLL_STEPS : 3;
      for (let s = 0; s < steps; s += 1) {
        const beforeIdx = await getMaxDataIndex(page);
        const beforeCount = items.length;
        await scrollSmart(page, 0.8);
        await page.waitForTimeout(Number.isFinite(SCROLL_WAIT_MS) && SCROLL_WAIT_MS > 0 ? SCROLL_WAIT_MS : 1000);
        await debugAfterScroll(page, attempt, s);
        const afterIdx = await getMaxDataIndex(page);
        await writeScrollLog({ ts: Date.now(), attempt, step: s, beforeIdx, afterIdx, beforeCount });

        // 先尝试一次提取
        const prev = items.length;
        await collectVisibleCommunities(page, items, seen, TARGET_ITEMS, MAX_ITEMS);
        if (items.length > prev) {
          if (items.length >= TARGET_ITEMS || items.length >= MAX_ITEMS) return items;
          continue; // 本步已经有新增，进入下一步
        }

        // 如果没有新增社区，则继续小步滚动尝试，直到新增或达到上限
        for (let c = 0; c < CONTINUE_TRIES && items.length === prev; c += 1) {
          const b2 = await getMaxDataIndex(page);
          await scrollSmart(page, 0.85);
          await page.waitForTimeout(Math.max(600, (Number.isFinite(SCROLL_WAIT_MS) && SCROLL_WAIT_MS > 0 ? SCROLL_WAIT_MS : 1000) - 200));
          await collectVisibleCommunities(page, items, seen, TARGET_ITEMS, MAX_ITEMS);
          const a2 = await getMaxDataIndex(page);
          await writeScrollLog({ ts: Date.now(), attempt, step: s, try: c, beforeIdx2: b2, afterIdx2: a2, count: items.length });
          if (items.length > prev) break;
        }

        if (items.length >= TARGET_ITEMS || items.length >= MAX_ITEMS) return items;
      }

      if (items.length >= TARGET_ITEMS) break;
    } catch (e) {
      logger.warn({ e: String(e) }, 'extractRows attempt error');
      await debugDump(page, `extract-attempt-${attempt}-error`);
    }
  }

  return items;
}

export async function crawlAxiomTrending(browser: Browser): Promise<void> {
  const runTs = new Date().toISOString();
  const axiomState = process.env.AXIOM_STORAGE_STATE?.trim();
  const proxyConfig = process.env.HTTP_PROXY ? {
    proxy: { server: process.env.HTTP_PROXY }
  } : {};
  
  const context = axiomState
    ? await browser.newContext({ 
        storageState: axiomState, 
        viewport: { width: 1440, height: 900 },
        ...proxyConfig
      })
    : await browser.newContext({ 
        viewport: { width: 1440, height: 900 },
        ...proxyConfig
      });
  const page = await context.newPage();
  try {
    await navigateTrending30m(page);
    await debugDump(page, 'after-navigate');
    const items = await extractRows(page);
    if (!items.length) await debugDump(page, 'no-items');
    for (const it of items) {
      try {
        // 精简：仅保存必需字段
        const rec = await upsertCommunity({
          x_community_url: it.x_community_url,
          token_full_name: '',
          ticker: '',
          axiom_row_url: '',
          avatar_url: undefined,
          first_seen_at: runTs,
        });
        await appendRun({ ts: runTs, action: 'crawl_discover_trending_30m', target_url: it.x_community_url, status: 'success', details: { id: rec.id } });
      } catch (e) {
        await appendRun({ ts: runTs, action: 'crawl_discover_trending_30m', target_url: it.x_community_url, status: 'failed', error: String(e) });
      }
    }
  } finally {
    if (process.env.AXIOM_DEBUG === '1' && (context as any).tracing) {
      const tracePath = path.resolve(process.cwd(), 'data', 'axiom-debug', `axiom-trace-${Date.now()}.zip`);
      await fs.mkdir(path.dirname(tracePath), { recursive: true }).catch(() => {});
      await (context as any).tracing.stop({ path: tracePath }).catch(() => {});
    }
    await page.close();
    await context.close();
  }
}


