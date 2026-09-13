# Browser QA scripts

Synthetic-microphone end-to-end checks for Phrase Mode (puppeteer-core +
system Chrome). They stub `getUserMedia` with a tunable oscillator feeding a
`MediaStreamDestination`, so note detection is exercised through the real
detection pipeline — not only through virtual taps.

Run:

```sh
npm i --no-save puppeteer-core   # does not modify package.json
npm run build
npx vite preview --port 4199 &    # serve dist
node scripts/phrase_e2e.cjs       # matcher basics (first-note match)
node scripts/phrase_e2e2.cjs      # repeated notes, release re-attack,
                                  # timeout re-arm, tempo count-in/misses
```

In-app debug state is available with `localStorage.phraseDebug = '1'`
(`window.__phraseDebug()` returns phase, cursor, statuses, summary, pool,
frame count, mic-gate state). Only ever a QA aid, not part of the UI.
