import 'dotenv/config';
import { chromium } from 'playwright';
import { runAxiomOnce } from '../src/services/axiomPipeline.ts';

async function main() {
  try {
    await runAxiomOnce();
    console.log(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e) }));
    process.exitCode = 1;
  }
}

main();
