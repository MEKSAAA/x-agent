import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import { promises as fs } from 'fs';

function getEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env: ${name}`);
  return v;
}

function screenshotPath(prefix) {
  const dir = path.resolve(process.cwd(), 'data', 'screenshots');
  const ts = Date.now();
  return { dir, file: path.join(dir, `${prefix}-${ts}.png`) };
}

const text = process.argv.slice(2).join(' ') || 'Onchain Koi 浏览器自动化发帖 🐟（非投资建议）';
const storageState = getEnv('PLAYWRIGHT_STORAGE_STATE');

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  // 打开主页以确保登录态生效
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // 使用键盘快捷键打开发帖框（更稳定）
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(500);

  // 定位发帖文本框（优先 data-testid），回退到通用 contenteditable
  const textArea = page.locator('[data-testid="tweetTextarea_0"] div[contenteditable="true"], [data-testid="tweetTextarea_0"], div[contenteditable="true"][role="textbox"]');
  await textArea.first().click({ trial: true }).catch(() => {});
  await textArea.first().click({ force: true });
  await textArea.first().fill('');
  await textArea.first().type(text, { delay: 10 });

  // 定位“发布/推文”按钮（优先 data-testid）
  const postBtn = page.locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
  await postBtn.first().waitFor({ state: 'visible', timeout: 15000 });
  // 若有遮挡（如“新帖子可用”提示），使用 force 点击
  await postBtn.first().click({ force: true });

  // 等待片刻并截图
  const { dir, file } = screenshotPath('personal-post');
  await fs.mkdir(dir, { recursive: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: file, fullPage: true });

  console.log(JSON.stringify({ ok: true, screenshot: file }));
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: e?.message || String(e) }));
  process.exit(1);
} finally {
  await browser.close();
}


