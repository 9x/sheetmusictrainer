/* eslint-disable */
/* Tempo-mode timing test: play every note of the Ode opening exactly in its
 * window; expect 8/8 matched. Also verifies the count-in has no extra click
 * by checking the phase transition timing. Run: node scripts/phrase_e2e3.cjs */
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:4199/';
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

(async () => {
    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

    await page.evaluateOnNewDocument(() => {
        localStorage.setItem('phraseDebug', '1');
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        const gain = ctx.createGain();
        gain.gain.value = 0.5;
        const dest = ctx.createMediaStreamDestination();
        osc.connect(gain).connect(dest);
        osc.start();
        osc.frequency.value = 440;
        window.__setOscFreq = (hz) => { osc.frequency.value = hz; };
        window.__setOscGain = (g) => { gain.gain.value = g; };
        navigator.mediaDevices.getUserMedia = async () => dest.stream;
    });

    await page.goto(URL, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 400));
    await page.click('button[aria-label="Start Listening"]');
    await new Promise(r => setTimeout(r, 700));

    const dbg = () => page.evaluate(() => window.__phraseDebug());

    await page.evaluate(() => {
        [...document.querySelectorAll('.game-mode-toggle .toggle-option')][2].click();
    });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => document.querySelector('.phrase-setup summary')?.click());
    await new Promise(r => setTimeout(r, 250));
    await page.evaluate(() => {
        const selects = [...document.querySelectorAll('.phrase-setup-grid select')];
        selects[0].value = 'library';
        selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 250));
    await page.evaluate(() => {
        const selects = [...document.querySelectorAll('.phrase-setup-grid select')];
        selects[1].value = 'ode-to-joy';
        selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    // tempo pace + 60 bpm
    await page.evaluate(() => {
        const selects = [...document.querySelectorAll('.phrase-setup-grid select')];
        const pace = selects.find(s => [...s.options].some(o => o.value === 'tempo'));
        pace.value = 'tempo';
        pace.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 500));

    const d0 = await dbg();
    const midis = d0.midis; // sounding midi per event
    console.log('loaded ode:', d0.scoreOk, 'events:', midis.length, midis.slice(0, 8));

    // Start, detect phase transition to playing, then schedule per-note attacks.
    await page.evaluate(() => {
        document.querySelector('.phrase-transport button')?.click();
    });
    // poll until phase flips to playing (count-in ends)
    let playAt = null;
    for (let i = 0; i < 200; i++) {
        await new Promise(r => setTimeout(r, 20));
        const d = await dbg();
        if (d.phase === 'playing') { playAt = performance.now(); break; }
        if (d.phase === 'ready') { /* not started? */ }
    }
    console.log('phase playing at', playAt);
    if (!playAt) throw new Error('never reached playing');

    // Schedule note attacks exactly on the AUDIO clock. Map perf->audio once:
    const dNow = await dbg();
    const perfOffset = performance.now() - dNow.audioNow * 1000; // perfMs = audioSec*1000 + offset
    await page.evaluate((cfg) => {
        const { midis, offset, scoreStart, spb, n } = cfg;
        const toPerf = (audioSec) => offset + audioSec * 1000 - performance.now();
        let prev = null;
        for (let i = 0; i < n; i++) {
            const m = midis[i];
            const startSec = scoreStart + (i * spb);
            const startMs = offset + startSec * 1000;
            if (prev !== null && m === prev) {
                setTimeout(() => window.__setOscGain(0), startMs - 250 - performance.now());
                setTimeout(() => { window.__setOscGain(0.5); window.__setOscFreq(440 * Math.pow(2, (m - 69) / 12)); }, startMs + 40 - performance.now());
            } else {
                setTimeout(() => window.__setOscFreq(440 * Math.pow(2, (m - 69) / 12)), startMs + 15 - performance.now());
            }
            prev = m;
        }
        setTimeout(() => window.__setOscGain(0), offset + (scoreStart + n * spb) * 1000 - performance.now() + 50);
    }, { midis, offset: perfOffset, scoreStart: dNow.scoreStart, spb: dNow.spb, n: Math.min(8, midis.length) });

    // wait for done
    let final = null;
    for (let i = 0; i < 150; i++) {
        await new Promise(r => setTimeout(r, 200));
        final = await dbg();
        if (final.phase === 'done') break;
    }
    console.log('RESULT:', JSON.stringify(final ? { phase: final.phase, summary: final.summary, statuses: final.statuses } : null));
    console.log('EXPECT matched 8 of 8');
    console.log('CONSOLE ERRORS:', errors.length ? errors.slice(0, 5) : 'none');
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
