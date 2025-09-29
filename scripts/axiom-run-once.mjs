#!/usr/bin/env node
import 'dotenv/config';
import { chromium } from 'playwright';
import { crawlAxiomTrending } from '../dist/src/services/axiomCrawler.js';

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    await crawlAxiomTrending(browser);
    console.log(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e) }));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
