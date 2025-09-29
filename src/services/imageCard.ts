import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import { chromium } from 'playwright';
import path from 'path';
import { promises as fs } from 'fs';

// 中文：二创图服务，使用 Playwright 渲染带品牌元素的卡片图片
export class ImageCardService extends Service {
  static serviceType = 'image_card_service';
  capabilityDescription = 'Render shareable image cards for posts using Playwright.';
  private templatePath: string;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.templatePath = process.env.IMAGE_TEMPLATE_HTML || path.resolve(process.cwd(), 'index.html');
  }

  static async start(runtime: IAgentRuntime) {
    const svc = new ImageCardService(runtime);
    return svc;
  }

  // 中文：渲染卡片图片，title/subtitle 为文本变量，bannerPath 可选背景
  async renderCard(vars: { title?: string; subtitle?: string; bannerPath?: string }): Promise<string | null> {
    try {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
        const html = await fs.readFile(this.templatePath, 'utf-8');
        const injected = html.replace('</body>', `
<div id="card" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0b0f1a;color:#fff;font-family:system-ui">
  <div style="width:1100px;height:600px;border-radius:20px;background:rgba(255,255,255,0.04);display:flex;overflow:hidden">
    <div style="flex:1;padding:40px;display:flex;flex-direction:column;gap:20px">
      <div style="font-size:42px;font-weight:800">${(vars.title || 'CommiEcho').slice(0,120)}</div>
      <div style="font-size:22px;opacity:0.9">${(vars.subtitle || '链上梗图时间 🐟').slice(0,160)}</div>
      <div style="margin-top:auto;font-size:18px;opacity:0.7">非投资建议 DYOR · #CommiFam</div>
    </div>
    <div style="width:420px;background:#111;background-image:url('${vars.bannerPath || ''}');background-size:cover;background-position:center"></div>
  </div>
</div>
</body>`);
        await page.setContent(injected, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(300);
        const outDir = path.resolve(process.cwd(), 'data', 'axiom-video');
        await fs.mkdir(outDir, { recursive: true });
        const file = path.join(outDir, `${Date.now().toString(36)}.png`);
        await page.screenshot({ path: file, fullPage: true });
        return file;
      } finally {
        await browser.close();
      }
    } catch (e) {
      logger.error({ e }, 'renderCard failed');
      return null;
    }
  }
}
