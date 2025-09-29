#!/usr/bin/env node
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUTPUT = resolve(__dirname, '../data/axiom-storage-state.json');

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  console.log('打开 Axiom 首页...');
  await page.goto('https://axiom.trade', { waitUntil: 'domcontentloaded' });

  // 点击右上角 Login 或 Start Trading / Launch Axiom 进入登录流程
  const loginBtn = page.getByRole('button', { name: /login/i }).or(page.getByRole('link', { name: /login|start trading|launch axiom/i }));
  if (await loginBtn.count()) {
    await loginBtn.first().click().catch(() => {});
  }

  console.log('请在打开的浏览器内完成登录（支持 Google/Email/Phantom），完成后按回车继续...');
  await waitForEnter();

  // 保存会话
  await context.storageState({ path: OUTPUT });
  console.log(`已保存登录态到: ${OUTPUT}`);

  await browser.close();
}

function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', () => resolve());
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
