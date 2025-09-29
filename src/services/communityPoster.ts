import { chromium, type Page } from 'playwright';
import path from 'path';
import { promises as fs } from 'fs';
import { appendRun, markCommunity } from './jsonDb.ts';
import { CommunityRecord } from '../types/ops.ts';
import https from 'node:https';
import { extname } from 'node:path';

function screenshotPath(prefix: string) {
  const dir = path.resolve(process.cwd(), 'data', 'screenshots');
  const ts = Date.now();
  return { dir, file: path.join(dir, `${prefix}-${ts}.png`) };
}

async function downloadFile(url: string, file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const fetchOnce = (u: string) => new Promise<{ buffer?: Buffer; redirect?: string }>((resolve, reject) => {
    https.get(u, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve({ redirect: res.headers.location });
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        return;
      }
      const chunks: Uint8Array[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject);
  });
  let current = url;
  for (let i = 0; i < 5; i += 1) {
    const out = await fetchOnce(current);
    if (out.buffer) {
      await fs.writeFile(file, out.buffer);
      return;
    }
    if (out.redirect) {
      current = out.redirect.startsWith('//') ? `https:${out.redirect}` : out.redirect;
      continue;
    }
    break;
  }
  throw new Error(`Failed to download ${url}`);
}

async function elementExists(page: Page, locator: ReturnType<Page['locator']>): Promise<boolean> {
  try {
    return (await locator.count()) > 0;
  } catch {
    return false;
  }
}

async function isJoined(page: Page): Promise<boolean> {
  const joinBtn = page.getByRole('button', { name: /join|agree and join|加入|加入社区|同意并加入/i }).or(
    page.locator('button:has-text("Join")')
  );
  const hasJoin = await elementExists(page, joinBtn);
  const composer = page.locator('[data-testid="tweetTextarea_0"] div[contenteditable="true"], [contenteditable="true"][role="textbox"], textarea');
  const hasComposer = await elementExists(page, composer);
  return !hasJoin && hasComposer;
}

async function ensureJoined(page: Page, rec: CommunityRecord): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await isJoined(page)) return true;
    const joinSelectors = [
      page.getByRole('button', { name: /agree and join/i }),
      page.getByRole('button', { name: /join community/i }),
      page.getByRole('button', { name: /join/i }),
      page.getByRole('button', { name: /加入|加入社区|同意并加入/i }),
      page.locator('button:has-text("Agree and Join")'),
      page.locator('button:has-text("Join")'),
    ];
    for (const sel of joinSelectors) {
      if (await sel.count()) {
        await sel.first().click({ force: true }).catch(() => {});
        await page.waitForTimeout(800);
        break;
      }
    }
    const agreeAll = page.getByRole('button', { name: /agree|同意/i });
    if (await agreeAll.count()) {
      await agreeAll.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
    }
    for (let t = 0; t < 5; t += 1) {
      if (await isJoined(page)) {
        const { dir, file } = screenshotPath('community-join');
        await fs.mkdir(dir, { recursive: true });
        await page.screenshot({ path: file, fullPage: true }).catch(() => {});
        await appendRun({ ts: new Date().toISOString(), action: 'join_community', target_url: rec.x_community_url, status: 'success', screenshot_path: file });
        await markCommunity(rec.id, { joined_at: new Date().toISOString() });
        return true;
      }
      await page.waitForTimeout(600);
    }
    await page.mouse.wheel(0, 800).catch(() => {});
    await page.waitForTimeout(400);
  }
  return await isJoined(page);
}

async function findComposer(page: Page) {
  const candidates = [
    '[data-testid="tweetTextarea_0"] div[contenteditable="true"]',
    '[data-testid="tweetTextarea_0"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel);
    if (await loc.count()) return loc.first();
  }
  return page.locator('div[contenteditable="true"][role="textbox"]');
}

function parseCssUrl(styleVal: string): string | undefined {
  const m = styleVal.match(/url\((['"]?)(.*?)\1\)/i);
  return m ? m[2] : undefined;
}

async function saveCommunityBannerOriginal(page: Page, rec: CommunityRecord) {
  try {
    // 已存在有效路径则跳过
    if (rec.community_banner_path) {
      try {
        const stat = await fs.stat(rec.community_banner_path);
        if (stat && stat.size > 0) return;
      } catch {}
    }

    const dir = path.resolve(process.cwd(), 'data', 'community-banners');
    await fs.mkdir(dir, { recursive: true });

    // 清理该社区旧文件
    try {
      const files = await fs.readdir(dir);
      const mine = files.filter(f => f.startsWith(`banner-${rec.id}-`));
      for (const f of mine) await fs.unlink(path.join(dir, f)).catch(() => {});
    } catch {}

    // 仅使用社区横幅专用选择器
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    const bannerImg = page.locator('img[src*="community_banner_img" i]');
    await bannerImg.first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
    const src = (await bannerImg.first().getAttribute('src')) || '';
    if (!src) return;

    const url = src.startsWith('//') ? `https:${src}` : src;
    const ext = (() => {
      try { const e = extname(new URL(url).pathname); return e || '.jpg'; } catch { return '.jpg'; }
    })();
    const file = path.join(dir, `banner-${rec.id}-${Date.now()}${ext}`);
    await downloadFile(url, file).catch(() => {});
    await markCommunity(rec.id, { community_banner_path: file });
  } catch {}
}

async function saveCommunityName(page: Page, rec: CommunityRecord) {
  try {
    // 中文：多路选择器，优先语义 heading，再到常见 span 样式
    const selectors = [
      '[role="heading"]',
      'h1',
      'header h1',
      'h2',
      'header h2',
      'span.r-qvutc0',
      'span.css-1jxf684',
      '[data-testid="app-bar-title"]',
    ];
    const blacklist = [
      /are you sure you want to leave/i,
      /to view keyboard shortcuts/i,
      /sign in/i,
      /log in/i,
      /agree and join/i,
    ];
    let raw: string | undefined;
    // 优先尝试带有“Community”上下文的容器，减少抓到全局提示
    const scopedContainers = [
      'main',
      'section[aria-label*="Community" i]',
      '[data-testid*="Community" i]',
    ];
    for (const sel of selectors) {
      let loc = page.locator(sel).filter({ hasNot: page.locator('nav, footer, dialog, [role="dialog"]') });
      for (const scope of scopedContainers) {
        const scoped = page.locator(`${scope} ${sel}`).filter({ hasNot: page.locator('nav, footer, dialog, [role="dialog"]') });
        if (await scoped.count()) { loc = scoped; break; }
      }
      if (!(await loc.count())) continue;
      const nodes = await loc.all();
      for (const n of nodes.slice(0, 6)) {
        const txt = (await n.innerText()).trim().replace(/\s+/g, ' ');
        if (!txt) continue;
        if (txt.length > 120 || txt.length < 2) continue;
        if (blacklist.some((re) => re.test(txt))) continue;
        // 避免抓到“Messages”等非社区名词；若包含明显的按钮/提示词则跳过
        if (/messages/i.test(txt)) continue;
        raw = txt;
        break;
      }
      if (raw) break;
    }
    if (!raw) {
      const title = await page.title();
      if (title && !blacklist.some((re) => re.test(title))) raw = title.trim();
    }
    if (raw) {
      let name = raw
        .replace(/\s*(?:[\/·|\-]\s*)?X\s*$/i, '')
        .replace(/\s*(?:[\/·|\-]\s*)?(?:Community|社区)\s*$/i, '')
        .replace(/\s*(?:[\/·|\-]\s*)?X\s*$/i, '')
        .trim()
        .replace(/\s{2,}/g, ' ');
      if (!blacklist.some((re) => re.test(name)) && name && name.length <= 100) {
        await markCommunity(rec.id, { community_name: name });
      }
    }
  } catch {}
}

export async function postToCommunity(rec: CommunityRecord, text: string): Promise<{ url?: string; screenshot?: string }> {
  const storageState = process.env.PLAYWRIGHT_STORAGE_STATE;
  if (!storageState) throw new Error('PLAYWRIGHT_STORAGE_STATE not configured');
  const browser = await chromium.launch({ 
    headless: true, // 保持无头模式用于生产环境
    args: [
      '--no-sandbox', 
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', // 隐藏自动化特征
      '--disable-features=VizDisplayCompositor',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ] 
  });
  
  const proxyConfig = process.env.HTTP_PROXY ? {
    proxy: { 
      server: process.env.HTTP_PROXY,
      bypass: 'localhost,127.0.0.1' // 绕过本地地址
    }
  } : {};
  try {
    const context = await browser.newContext({ 
      storageState, 
      ...proxyConfig,
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    const page = await context.newPage();
    
    // 隐藏自动化特征
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });
    
    // 设置更长的超时时间
    page.setDefaultTimeout(60000);
    
    await page.goto(rec.x_community_url, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    await page.waitForTimeout(800);

    const joined = await ensureJoined(page, rec);
    if (!joined) {
      const { dir, file } = screenshotPath('community-join-failed');
      await fs.mkdir(dir, { recursive: true });
      await page.screenshot({ path: file, fullPage: true }).catch(() => {});
      await appendRun({ ts: new Date().toISOString(), action: 'join_community', target_url: rec.x_community_url, status: 'failed', screenshot_path: file });
      throw new Error('Failed to join community');
    }

    await saveCommunityBannerOriginal(page, rec);
    await saveCommunityName(page, rec);

    const editor = await findComposer(page);
    await editor.click({ delay: 10, force: true }).catch(() => {});
    await editor.fill('');
    await editor.type(text, { delay: 8 });

    const postBtn = page
      .getByRole('button', { name: /post|发帖|发布|推文|Tweet/i })
      .or(page.locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'));
    await postBtn.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await postBtn.first().click({ force: true }).catch(() => {});

    const { dir, file } = screenshotPath('community-post');
    await fs.mkdir(dir, { recursive: true });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    await appendRun({ ts: new Date().toISOString(), action: 'post_community', target_url: rec.x_community_url, status: 'success', screenshot_path: file });
    await markCommunity(rec.id, { posted_community_at: new Date().toISOString() });
    return { screenshot: file };
  } finally {
    await browser.close();
  }
}

export async function fetchCommunityMeta(rec: CommunityRecord): Promise<void> {
  const storageState = process.env.PLAYWRIGHT_STORAGE_STATE;
  if (!storageState) throw new Error('PLAYWRIGHT_STORAGE_STATE not configured');
  const browser = await chromium.launch({ 
    headless: true, 
    args: [
      '--no-sandbox', 
      '--disable-dev-shm-usage',
      '--disable-features=VizDisplayCompositor'
    ] 
  });
  
  const proxyConfig = process.env.HTTP_PROXY ? {
    proxy: { server: process.env.HTTP_PROXY }
  } : {};
  try {
    const context = await browser.newContext({ storageState, ...proxyConfig });
    const page = await context.newPage();
    await page.goto(rec.x_community_url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    await ensureJoined(page, rec).catch(() => {});
    await saveCommunityBannerOriginal(page, rec);
    await saveCommunityName(page, rec);
  } finally {
    await browser.close();
  }
}

export async function postToPersonalViaBrowser(text: string): Promise<{ screenshot?: string }> {
  const storageState = process.env.PLAYWRIGHT_STORAGE_STATE;
  if (!storageState) throw new Error('PLAYWRIGHT_STORAGE_STATE not configured');
  const browser = await chromium.launch({ 
    headless: true, 
    args: [
      '--no-sandbox', 
      '--disable-dev-shm-usage',
      '--disable-features=VizDisplayCompositor'
    ] 
  });
  
  const proxyConfig = process.env.HTTP_PROXY ? {
    proxy: { server: process.env.HTTP_PROXY }
  } : {};
  try {
    const context = await browser.newContext({ storageState, ...proxyConfig });
    const page = await context.newPage();
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyN');
    await page.waitForTimeout(300);
    const textArea = page.locator('[data-testid="tweetTextarea_0"] div[contenteditable="true"], [data-testid="tweetTextarea_0"], div[contenteditable="true"][role="textbox"]');
    await textArea.first().click({ force: true });
    await textArea.first().fill('');
    await textArea.first().type(text, { delay: 10 });
    const postBtn = page.locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
    await postBtn.first().waitFor({ state: 'visible', timeout: 15000 });
    await postBtn.first().click({ force: true });
    const { dir, file } = screenshotPath('personal-post');
    await fs.mkdir(dir, { recursive: true });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: file, fullPage: true });
    return { screenshot: file };
  } finally {
    await browser.close();
  }
}


