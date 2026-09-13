/* eslint-disable */
/* Synthetic-mic end-to-end tests, part 2: repeated notes, release re-attack,
 * timeout re-arm, tempo mode. Run: node phrase_e2e2.cjs (preview on :4199) */
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
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
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
        window.__setOscFreq = (hz) => { osc.frequency.value = hz; };
        window.__setOscGain = (g) => { gain.gain.value = g; };
        navigator.mediaDevices.getUserMedia = async () => dest.stream;
    });

    await page.goto(URL, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 500));
    await page.click('button[aria-label="Start Listening"]');
    await new Promise(r => setTimeout(r, 800));

    const dbg = () => page.evaluate(() => window.__phraseDebug());

    // Switch to Phrases, then select the Ode exercise via the setup panel.
    const toggles = await page.$$('.game-mode-toggle .toggle-option');
    await toggles[2].click();
    await new Promise(r => setTimeout(r, 600));
    // open setup panel and choose material=library, exercise=ode-to-joy
    await page.evaluate(() => {
        const summary = document.querySelector('.phrase-setup summary');
        if (summary) summary.click();
    });
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => {
        const selects = [...document.querySelectorAll('.phrase-setup-grid select')];
        const material = selects[0];
        material.value = 'library';
        material.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => {
        const selects = [...document.querySelectorAll('.phrase-setup-grid select')];
        const exSel = selects[1]; // Exercise select (material === library)
        exSel.value = 'ode-to-joy';
        exSel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 600));
    let d = await dbg();
    console.log('SETUP ode loaded:', d.scoreOk, 'firstNote(midi):', d.firstNote);

    // Ode starts E E F G: play E4 (64) = 329.63 Hz
    await page.evaluate((f) => window.__setOscFreq(f), midiToFreq(64));
    const startBtn = await page.evaluateHandle(() => document.querySelector('.phrase-transport button'));
    await (startBtn.asElement ? startBtn.asElement() : startBtn).click();
    await new Promise(r => setTimeout(r, 1200));
    d = await dbg();
    console.log('A started:', d.phase, 'idx', d.currentIdx, 'statuses', JSON.stringify(d.statuses?.slice(0, 3)));

    // A1: first E should match quickly
    let ok1 = false;
    for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 200)); d = await dbg(); if (d.currentIdx >= 1) { ok1 = true; break; } }
    console.log('A1 first E matched:', ok1, 'idx', d.currentIdx);

    // A2: second E (same pitch, sustained) must NOT match while blocked (within ~1.5s)
    await new Promise(r => setTimeout(r, 1500));
    d = await dbg();
    const blockedHeld = d.currentIdx === 1 && d.statuses[1] === 'pending';
    console.log('A2 sustained E still blocked after 1.5s:', blockedHeld, 'idx', d.currentIdx);

    // A3: release (mute 300ms), re-attack → should match
    await page.evaluate(() => window.__setOscGain(0));
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => window.__setOscGain(0.5));
    let ok3 = false;
    for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 200)); d = await dbg(); if (d.currentIdx >= 2) { ok3 = true; break; } }
    console.log('A3 release + re-attack matched:', ok3, 'idx', d.currentIdx, JSON.stringify(d.statuses?.slice(0, 4)));

    // A4: timeout re-arm — retry, hold E through the block; after ~2.6s it should unblock.
    await page.evaluate(() => { const r = document.querySelector('.phrase-transport .hint-button'); });
    await page.evaluate(() => {
        const row = document.querySelector('.phrase-transport');
        const buttons = [...row.querySelectorAll('button')];
        const retry = buttons.find(b => b.textContent.includes('Retry'));
        retry && retry.click();
    });
    await new Promise(r => setTimeout(r, 800));
    d = await dbg();
    // After retry the first E matches quickly (idx >= 1). Now hold E forever
    // (never mute): the 2.5s timeout should re-arm and match note 1 (idx 2).
    let ok4 = false;
    for (let i = 0; i < 25; i++) { await new Promise(r => setTimeout(r, 250)); d = await dbg(); if (d.currentIdx >= 2) { ok4 = true; break; } }
    const held = ok4; // matched without any release
    console.log('A4 timeout re-arm matched held E (expect true, ~2.5s):', held, 'idx', d.currentIdx);

    // Turn auto-continue OFF so the tempo run ends (default is ON).
    await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.phrase-setup-grid .phrase-check')];
        const ac = labels.find(l => l.textContent.includes('Auto-continue'));
        const box = ac?.querySelector('input');
        if (box && box.checked) { box.click(); }
    });
    await new Promise(r => setTimeout(r, 300));
    // B: tempo mode — pause first (pace change while running pauses by design).
    await page.evaluate(() => {
        const row = document.querySelector('.phrase-transport');
        [...row.querySelectorAll('button')].find(b => ['Pause', 'Resume', 'Start'].some(t => b.textContent.includes(t)))?.click();
    });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
        const selects = [...document.querySelectorAll('.phrase-setup-grid select')];
        const pace = selects.find(s => [...s.options].some(o => o.value === 'tempo'));
        if (pace) { pace.value = 'tempo'; pace.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => {
        const row = document.querySelector('.phrase-transport');
        row?.querySelector('button')?.click(); // first transport button (Start/Resume)
    });
    await new Promise(r => setTimeout(r, 1000));
    d = await dbg();
    console.log('B1 count-in:', d.phase);
    // Mute the oscillator so nothing matches; count-in 4 beats @60bpm = 4s + run.
    await page.evaluate(() => window.__setOscGain(0));
    await new Promise(r => setTimeout(r, 1300));
    d = await dbg();
    console.log('B2 during/after count-in phase:', d.phase);
    // Let it play through ~15s of phrase
    await new Promise(r => setTimeout(r, 15000));
    d = await dbg();
    console.log('B3 after run:', JSON.stringify({ phase: d.phase, summary: d.summary, statuses: d.statuses?.slice(0, 6) }));
    const allMissed = d.statuses && d.statuses.every(s => s === 'missed' || s === 'rest' || s === 'pending');
    console.log('B4 windows advanced with silence (misses, no deadlock):', allMissed && d.summary.missed > 0);

    console.log('CONSOLE ERRORS:', errors.length ? errors.slice(0, 6) : 'none');
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
