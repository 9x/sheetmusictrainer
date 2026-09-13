/* eslint-disable */
/* Synthetic-mic end-to-end test for Phrase Mode (puppeteer-core + system Chrome).
 * Feeds a sustained oscillator into a fake getUserMedia stream, then verifies
 * the phrase trainer advances when the current note matches. */
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
        // Stub the microphone with an oscillator we can retune.
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 440;
        const gain = ctx.createGain();
        gain.gain.value = 0.5;
        const dest = ctx.createMediaStreamDestination();
        osc.connect(gain).connect(dest);
        osc.start();
        window.__setOscFreq = (hz) => { osc.frequency.value = hz; };
        navigator.mediaDevices.getUserMedia = async () => dest.stream;
    });

    await page.goto(URL, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 800));

    // 1. Turn the mic on (click the mic button) and verify detection works at all.
    await page.click('button[aria-label="Start Listening"]');
    await new Promise(r => setTimeout(r, 1500));
    const readout = await page.$eval('.pitch-readout', el => el.textContent).catch(() => null);
    console.log('STEP1 single-note readout (440Hz):', JSON.stringify(readout));

    // 2. Switch to Phrases mode.
    const buttons = await page.$$('.game-mode-toggle .toggle-option');
    await buttons[2].click();
    await new Promise(r => setTimeout(r, 1200));

    let dbg = await page.evaluate(() => window.__phraseDebug ? window.__phraseDebug() : null);
    console.log('STEP2 phrase debug:', JSON.stringify(dbg && { frames: dbg.frames, scoreOk: dbg.scoreOk, phase: dbg.phase, firstNote: dbg.firstNote, material: dbg.material }));

    // 3. Retune the oscillator to the FIRST note of the phrase and press Start.
    if (dbg && dbg.firstNote !== null) {
        const hz = midiToFreq(dbg.firstNote);
        await page.evaluate((f) => window.__setOscFreq(f), hz);
        console.log('oscillator set to', hz, 'Hz (midi', dbg.firstNote, ')');
    }
    // Start button (first button in the transport row)
    const startBtn = await page.evaluateHandle(() => {
        const row = document.querySelector('.phrase-transport');
        return row ? row.querySelector('button') : null;
    });
    await (startBtn.asElement ? startBtn.asElement() : startBtn).click();
    await new Promise(r => setTimeout(r, 1500));

    dbg = await page.evaluate(() => window.__phraseDebug());
    console.log('STEP3 after Start:', JSON.stringify({ phase: dbg.phase, currentIdx: dbg.currentIdx, frames: dbg.frames, gate: dbg.micGate, blanked: dbg.micBlanked }));

    // 4. Wait for the first note to match (hold 50ms on sustained oscillator).
    let matched = false;
    for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 250));
        dbg = await page.evaluate(() => window.__phraseDebug());
        if (dbg.currentIdx >= 1 || (dbg.statuses && dbg.statuses[0] === 'matched')) { matched = true; break; }
    }
    console.log('STEP4 first note matched:', matched, JSON.stringify({ phase: dbg.phase, currentIdx: dbg.currentIdx, statuses: dbg.statuses, summary: dbg.summary }));

    // 5. Move the oscillator to the SECOND note and check further progress.
    if (matched) {
        // find second note pitch via debug statuses? read from events through a hack: statuses only.
        // Instead: keep oscillator, and just report the state after another few seconds.
        await new Promise(r => setTimeout(r, 2500));
        dbg = await page.evaluate(() => window.__phraseDebug());
        console.log('STEP5 after 2.5s more:', JSON.stringify({ phase: dbg.phase, currentIdx: dbg.currentIdx, summary: dbg.summary }));
    }

    console.log('CONSOLE ERRORS:', errors.length ? errors.slice(0, 6) : 'none');
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
