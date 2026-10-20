/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS tool script */
// usage: POSTER_RAW_DIR=<dir> PWCORE=<path to playwright-core> node record.cjs <gameId> [recordSeconds] [baseUrl]
// Drives a bot game like the 10-19 poster capture, records the viewport with
// Playwright (needs its ffmpeg build in ms-playwright), and writes
// <dir>/<id>.webm + <id>.json (auto crop box, second offset where play began).
// The host's own seat is handed to the bots via the real takeover broadcast,
// so every seat keeps playing. playwright-core is not a project dependency —
// install it somewhere outside the repo and point PWCORE at it.
// Then: node sheet.cjs <id> to pick a moment, add it to highlights.json,
// node encode.mjs, node check.mjs.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PWCORE || 'playwright-core');
const id = process.argv[2];
const recordSec = +(process.argv[3] || 75);
const base = process.argv[4] || 'https://board-game-tau-navy.vercel.app';
const REALTIME = new Set(['hungry-shark', 'crab-survival', 'worm']);
// 지렁이 has no lobby bots and needs two people: a second (unrecorded) browser
// context joins with ?room=<code> and steers too.
const NEEDS_GUEST = new Set(['worm']);
const root = path.join(__dirname, '..', '..');
const out = process.env.POSTER_RAW_DIR || path.join(require('os').tmpdir(), 'poster-raw');
fs.mkdirSync(out, { recursive: true });
const VW = 960, VH = 1200;

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.LOCALAPPDATA + '/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const t0 = Date.now();
  const log = [];
  let meta = { id, ok: false };
  let ctx, guest = null;
  try {
    ctx = await browser.newContext({
      viewport: { width: VW, height: VH }, deviceScaleFactor: 1, colorScheme: 'dark',
      recordVideo: { dir: out, size: { width: VW, height: VH } },
    });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.goto(base + '/games/' + id, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(3500);
    const clickFirst = async (re) => {
      const btns = page.locator('button:visible, a[role=button]:visible');
      const n = await btns.count();
      for (let i = 0; i < n; i++) {
        const b = btns.nth(i);
        const t = ((await b.textContent().catch(() => '')) || '').trim();
        if (re.test(t) && (await b.isEnabled().catch(() => false))) {
          await b.click({ timeout: 2000 }).catch(() => {});
          log.push(t.slice(0, 30));
          return true;
        }
      }
      return false;
    };
    const fillNick = async () => {
      const inp = page.locator('input[placeholder*="닉네임"]:visible');
      if (await inp.count()) {
        const v = await inp.first().inputValue().catch(() => 'x');
        if (!v) await inp.first().fill('하이라이트');
      }
    };
    let started = false, botClicks = 0;
    for (let step = 0; step < 40 && !started; step++) {
      await fillNick();
      // keep recording rooms out of the public list
      await clickFirst(/^🔒\s*비공개/);
      if (await clickFirst(/^(\S+\s*)?방 만들기|방 만들고|만들기$/)) { await page.waitForTimeout(1500); continue; }
      if (await clickFirst(/봇으로.*채우|일괄 채우기|빈 자리.*봇|빈자리 AI로 채우|모두 봇|봇 채우기/)) { await page.waitForTimeout(1500); continue; }
      if (botClicks < 3 && (await clickFirst(/봇 추가/))) { botClicks++; await page.waitForTimeout(1200); continue; }
      if (NEEDS_GUEST.has(id) && !guest) {
        const code = await page.evaluate((g) => { const k = Object.keys(localStorage).find((k) => new RegExp(`^${g}-seat-\\d{4}$`).test(k)); return k ? k.slice(-4) : null; }, id);
        if (code) {
          guest = await (await browser.newContext({ viewport: { width: VW, height: VH }, colorScheme: 'dark' })).newPage();
          await guest.goto(`${base}/games/${id}?room=${code}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
          await guest.waitForTimeout(3500);
          for (let i = 0; i < 6; i++) {
            const inp = guest.locator('input[placeholder*="닉네임"]:visible');
            if (await inp.count()) { if (!(await inp.first().inputValue().catch(() => 'x'))) await inp.first().fill('손님'); }
            const b = guest.locator('button:visible', { hasText: /참여|참가|입장|들어가기|확인|알겠어요/ }).first();
            if (await b.count()) await b.click({ timeout: 2000 }).catch(() => {});
            await guest.waitForTimeout(1200);
          }
          log.push('guest@' + code);
          await page.waitForTimeout(2000);
          continue;
        }
      }
      if (await clickFirst(/지금 시작|게임 시작|바로 시작|시작하기|^시작$/)) { await page.waitForTimeout(1500); continue; }
      if (await clickFirst(/^확인$|건너뛰기|스킵|닫기|^시작할게요|알겠어요|룰 확인/)) { await page.waitForTimeout(800); continue; }
      const body = (await page.locator('body').innerText().catch(() => '')) || '';
      if (!/봇 추가|대기실|참가자를 기다/.test(body)) started = true;
      else await page.waitForTimeout(1500);
    }
    const startedAt = (Date.now() - t0) / 1000;
    await page.addStyleTag({ content: 'body > header, header.sticky, nextjs-portal { display: none !important; }' });
    await page.waitForTimeout(4000);
    // dismiss first-play tours / coach popups that appear right after start
    for (let i = 0; i < 4; i++) if (!(await clickFirst(/^확인$|건너뛰기|닫기|알겠어요|투어 건너뛰기|다음에|^✕$/))) break;
    // Crop box: biggest board/canvas, 4:5, >=600px wide (same rule as the posters).
    const clip = await page.evaluate(({ VW, VH }) => {
      const main = document.querySelector('main') || document.body;
      let best = null, area = 0;
      main.querySelectorAll('canvas, svg, img, [class*="board"], [class*="Board"], [class*="grid"], [class*="table"]').forEach((el) => {
        const r = el.getBoundingClientRect();
        const a = r.width * Math.min(r.height, 1400);
        if (r.width > 160 && r.height > 120 && a > area) { area = a; best = el; }
      });
      const w = Math.min(VW, Math.max(600, best ? Math.min(best.getBoundingClientRect().width + 32, 820) : 820));
      const h = Math.round(w * 1.25);
      let cx = VW / 2, cyDoc = h / 2;
      if (best) { const r = best.getBoundingClientRect(); cx = r.left + r.width / 2; cyDoc = r.top + scrollY + r.height / 2; }
      window.scrollTo(0, Math.max(0, cyDoc - VH / 2));
      const cy = cyDoc - scrollY;
      const x = Math.round(Math.max(0, Math.min(cx - w / 2, VW - w)));
      const y = Math.round(Math.max(0, Math.min(cy - h / 2, VH - h)));
      return { x, y, w: Math.round(w), h };
    }, { VW, VH });
    // Hand the host's own seat to the bots through the real takeover flow:
    // a side connection on the room channel announces a vote and converts it
    // (no other human exists to vote, so the in-game vote can't pass).
    // Each game stores our seat as localStorage `<game>-seat-<code>` (or -role-).
    const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]).filter(([k]) => /-(seat|role)-?\w*-(\d{4})$/.test(k) || /-(seat|role)-(\d{4})$/.test(k)));
    log.push('ls:' + JSON.stringify(stored).slice(0, 120));
    const hit = stored.find(([k]) => /(\d{4})$/.test(k));
    const code = hit ? hit[0].match(/(\d{4})$/)[1] : null;
    const seatKeys = [...new Set([hit && hit[1] != null ? String(hit[1]).replace(/"/g, '') : null, '0', 'p1'].filter(Boolean))];
    if (code && !REALTIME.has(id)) {
      const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, '')]));
      const { createClient } = require(path.join(root, 'node_modules/@supabase/supabase-js'));
      const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      const ch = sb.channel(`${id}-room-${code}`);
      await new Promise((res) => ch.subscribe((s) => s === 'SUBSCRIBED' && res()));
      for (const seatKey of seatKeys.slice(0, 1)) {
        await ch.send({ type: 'broadcast', event: 'bot-takeover-event', payload: { event: { type: 'vote-start', seatKey, reason: 'idle', startedAt: Date.now(), originalUserId: `${code}:${seatKey}`, originalName: '하이라이트' } } });
        await page.waitForTimeout(400);
        await ch.send({ type: 'broadcast', event: 'bot-takeover-event', payload: { event: { type: 'convert', seatKey, at: Date.now() } } });
      }
      await page.waitForTimeout(600);
      await sb.removeAllChannels();
      log.push('takeover@' + code);
    }
    const recStart = (Date.now() - t0) / 1000;
    const end = Date.now() + recordSec * 1000;
    if (REALTIME.has(process.argv[2])) {
      const START_RT = /잠수$|섬으로 출발/;
      await clickFirst(START_RT);
      await page.waitForTimeout(2500);
      for (let i = 0; i < 4; i++) if (!(await clickFirst(/^확인$|건너뛰기|닫기|알겠어요|시작!?$|^✕$/))) break;
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
      while (Date.now() < end) {
        const k = keys[Math.floor(Math.random() * 4)];
        await page.keyboard.down(k);
        // also steer by mouse for pointer-driven games
        await page.mouse.move(clip.x + Math.random() * clip.w, clip.y + Math.random() * clip.h, { steps: 8 });
        if (guest) await guest.mouse.move(VW * (0.2 + Math.random() * 0.6), VH * (0.2 + Math.random() * 0.6), { steps: 8 }).catch(() => {});
        await page.waitForTimeout(500 + Math.random() * 900);
        await page.keyboard.up(k);
        if (Math.random() < 0.3) await page.keyboard.press('Space');
        if (await clickFirst(/다시 하기|다시하기|한 판 더|재시작|부활/)) await page.waitForTimeout(1500);
        await clickFirst(START_RT);
      }
    } else if (!process.env.MONKEY) {
      // Round-end screens wait for each human's "다음 라운드" — press it for our (bot) seat.
      while (Date.now() < end) {
        await page.waitForTimeout(2000);
        // also role-card acks (마피아·아발론), "ROUND n 시작" (운명전쟁39), album paging (그림 전화기)
        await clickFirst(/^(\S+\s*)?다음 라운드( 시작)?$|^(\S+\s*)?다음 판$|^확인했어요$|^ROUND \d+ 시작$|^다음 장/);
      }
    } else {
      // Monkey for the host's own seat: no self-autoplay exists, so on our
      // turn press a random safe action button or a random board point.
      const UNSAFE = /나가|떠나|설정|채팅|룰북|규칙|메뉴|공유|복사|초대|소리|음악|BGM|테마|2D|3D|화질|신고|로비|홈|기권|항복|포기|무르기|무승부|돌리기|숨기기|전체화면|도움|투표|보내기|버그|리포트|🔊|🔇|⚙|📖/;
      while (Date.now() < end) {
        await page.waitForTimeout(900 + Math.random() * 700);
        const cands = await page.evaluate((src) => {
          const re = new RegExp(src);
          return [...document.querySelectorAll('main button')].map((b, i) => {
            const r = b.getBoundingClientRect();
            const t = (b.textContent || '').trim();
            const ok = !b.disabled && r.width > 8 && r.height > 8 && r.top >= 0 && r.bottom <= innerHeight && !re.test(t + (b.getAttribute('aria-label') || ''));
            return ok ? i : -1;
          }).filter((i) => i >= 0);
        }, UNSAFE.source).catch(() => []);
        if (cands.length && Math.random() < 0.6) {
          const i = cands[Math.floor(Math.random() * cands.length)];
          await page.locator('main button').nth(i).click({ timeout: 800 }).catch(() => {});
        } else {
          // only board points inside <main>, never floating (fixed) widgets like the bug-report button
          const px = clip.x + 20 + Math.random() * (clip.w - 40), py = clip.y + 20 + Math.random() * (clip.h - 40);
          const inBoard = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); if (!el || !el.closest('main')) return false; for (let a = el; a; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return false; return true; }, [px, py]).catch(() => false);
          if (inBoard) await page.mouse.click(px, py).catch(() => {});
        }
      }
    }
    meta = { id, ok: started, startedAt, recStart, clip, log };
    console.log(id, started ? 'started' : 'NOT-STARTED', JSON.stringify(clip), 'rec@' + recStart.toFixed(1), log.join(' > '));
  } catch (e) {
    meta.error = String(e).slice(0, 200);
    console.log(id, 'ERROR', meta.error, log.join(' > '));
  } finally {
    if (ctx) {
      const v = ctx.pages()[0]?.video();
      await ctx.close();
      if (v) {
        const p = await v.path();
        fs.renameSync(p, path.join(out, id + '.webm'));
      }
    }
    fs.writeFileSync(path.join(out, id + '.json'), JSON.stringify(meta, null, 1));
    await browser.close();
  }
})();
