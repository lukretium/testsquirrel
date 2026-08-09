#!/usr/bin/env node
/*
 * Renders build/demo/stage.html frame by frame and encodes videos/testsquirrel-demo.mp4.
 *
 * Frames are stepped through window.seek(t) rather than recorded in real time,
 * so the output is deterministic and never drops frames on a busy machine.
 *
 *   node build/render-demo.js [--fps 25] [--out <dir>] [--scale 1]
 */
const { chromium } = require(process.env.PW_PATH || 'playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : def;
};

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(__dirname, 'demo', 'stage.html');
const FPS = Number(arg('--fps', 30));
const FRAMES = arg('--out', path.join(process.env.TMPDIR || '/tmp', 'testsquirrel-frames'));
const OUT = path.join(ROOT, 'videos', 'testsquirrel-demo.mp4');
const POSTER = path.join(ROOT, 'images', 'demo-poster.jpg');

(async () => {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

  await page.goto('file://' + STAGE);
  await page.waitForFunction(() => window.ready && window.ready(), null, { timeout: 15000 });

  const duration = await page.evaluate(() => window.DURATION);
  const total = Math.round(duration * FPS);
  console.log(`rendering ${total} frames @ ${FPS}fps (${duration}s)`);

  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await page.evaluate(x => window.seek(x), t);
    await page.screenshot({
      path: path.join(FRAMES, `f${String(i).padStart(5, '0')}.png`),
      animations: 'disabled',
    });
    if (i % 100 === 0) process.stdout.write(`  ${i}/${total}\n`);
  }
  await browser.close();

  if (problems.length) {
    console.warn('page reported problems:');
    for (const p of [...new Set(problems)].slice(0, 20)) console.warn('  ' + p);
  }

  console.log('encoding…');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(FPS),
    '-i', path.join(FRAMES, 'f%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    OUT,
  ], { stdio: 'inherit' });

  // poster frame: a moment where the app is doing something recognisable
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', OUT, '-ss', '30', '-frames:v', '1', '-q:v', '3', POSTER,
  ], { stdio: 'inherit' });

  const mb = (fs.statSync(OUT).size / 1e6).toFixed(1);
  console.log(`wrote ${OUT} (${mb} MB) and ${POSTER}`);
})();
