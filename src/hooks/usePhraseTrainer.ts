/**
 * Phrase-mode trainer: the state machine from the implementation contract
 * (sections D/E). Pure logic lives in PhraseMatcher / PhraseTransport; this
 * hook wires them to the audio clock, the raw frame bus, and React state.
 *
 * Phases: ready → countIn (tempo only) → playing → done, with paused/preview
 * reachable from playing. Structural changes (score/selection/pace/bpm/…)
 * cancel the run and return to ready — never retime a half-played note.
 *
 * The hook receives the FULL score plus a bar selection; it slices internally
 * so a tempo resume can restart the current bar (ties entering the slice
 * become fresh attacks — sliceScore does exactly that).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scoreEvents, sliceScore, type Score } from '../score/model';
import { PhraseMatcher, type NoteStatus } from '../game/PhraseMatcher';
import { buildSchedule, sanitizeBpm, type ScheduleEntry } from '../game/PhraseTransport';
import { PPQ } from '../score/model';
import { audioEngine } from '../audio/AudioEngine';
import { subscribeRawFrames } from './rawFrameBus';
import { phraseRunBus } from './phraseRunBus';
import { phraseBeatBus } from './phraseBeatBus';

export type PhrasePhase = 'ready' | 'countIn' | 'playing' | 'paused' | 'preview' | 'done';

export interface PhraseSelection {
    readonly startBar: number;
    readonly barCount: number;
}

export interface PhraseTrainerConfig {
    readonly pace: 'step' | 'tempo';
    readonly bpm: number;
    readonly clickSound: boolean;
    readonly inputMode: 'mic' | 'virtual';
    readonly previewVolume?: number;
    /** Auto-start: begin without count-in as soon as the mic detects the
     *  first note (step pace only — tempo needs the scheduled clock). */
    readonly autoStartOnNote?: boolean;
}

export interface PhraseSummary {
    readonly total: number;
    readonly matched: number;
    readonly missed: number;
    readonly skipped: number;
}

const TICK_MS = 25;
const LOOKAHEAD_S = 0.1;
const CLICK_VOLUME = 0.4;
const PREVIEW_GROUP = 'phrase-preview';
const CLICK_GROUP = 'phrase-clicks';
/** Longest a sustained episode may block a repeated note in at-your-pace mode. */
const REARM_AFTER_SUSTAINED_MS = 2500;

export interface PhraseTrainerApi {
    readonly phase: PhrasePhase;
    /** Active slice the user is currently working through (may be a resume tail). */
    readonly activeScore: Score;
    readonly statuses: NoteStatus[];
    /** Event index currently up (cursor for renderer/hints). */
    readonly currentIdx: number;
    readonly countInLeft: number;
    /** Audio-clock start of the current run's score (diagnostics/QA). */
    readonly scoreStart: number;
    /** Seconds per quarter beat (diagnostics/QA). */
    readonly spb: number;
    readonly error: string | null;
    readonly summary: PhraseSummary;
    /** True when the current note is a repeated pitch still blocked by the
     *  user's sustained episode (status-line hint: release and strike again). */
    readonly repeatedNoteBlocked: boolean;
    start: () => void;
    pauseToggle: () => void;
    retry: () => void;
    skip: () => void;
    previewToggle: () => void;
    virtualTap: (midi: number) => void;
    /** External pause (settings dialog, visibility change handled internally). */
    pause: () => void;
    stop: () => void;
}

export function usePhraseTrainer(
    fullScore: Score,
    selection: PhraseSelection,
    config: PhraseTrainerConfig,
    micActive: boolean,
    micError: string | null,
): PhraseTrainerApi {
    const [phase, setPhase] = useState<PhrasePhase>('ready');
    const [statuses, setStatuses] = useState<NoteStatus[]>([]);
    const [currentIdx, setCurrentIdx] = useState(-1);
    const [countInLeft, setCountInLeft] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [repeatedNoteBlocked, setRepeatedNoteBlocked] = useState(false);
    const [accumulated, setAccumulated] = useState<PhraseSummary>({ total: 0, matched: 0, missed: 0, skipped: 0 });

    // ---- Active slice (resume tails replace it) ---------------------------
    const [activeScore, setActiveScore] = useState<Score>(() => sliceScore(fullScore, selection.startBar, selection.barCount));

    const matcherRef = useRef<PhraseMatcher | null>(null);
    const repeatBlockedRef = useRef(false);
    const phaseRef = useRef<PhrasePhase>('ready');
    const paceRef = useRef(config.pace);
    const configRef = useRef(config);
    const micActiveRef = useRef(micActive);

    const scheduleRef = useRef<ScheduleEntry[]>([]);
    const boundaryIdxRef = useRef(0);
    const clickIdxRef = useRef(0);
    const windowIdxRef = useRef(0);
    const scoreStartRef = useRef(0);
    const spbRef = useRef(1);
    const countInBeatsRef = useRef(0);
    const runTokenRef = useRef(0);
    const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const events = useMemo(() => scoreEvents(activeScore), [activeScore]);

    const setPhaseBoth = useCallback((p: PhrasePhase) => {
        phaseRef.current = p;
        setPhase(p);
        // Gate the shared metronome only in 'sync to metronome' (tempo) pace:
        // there the run owns the clock (clicks during count-in/playing only).
        // In 'at your pace' (step) the metronome ticks continuously when the
        // user has it switched on — like the single-note modes.
        const ownsClock = paceRef.current === 'tempo';
        phraseRunBus.set(ownsClock && (p === 'countIn' || p === 'playing' || p === 'preview'));
    }, []);

    useEffect(() => { paceRef.current = config.pace; }, [config.pace]);
    useEffect(() => { configRef.current = config; }, [config]);
    useEffect(() => { micActiveRef.current = micActive; }, [micActive]);

    // ---- Matcher lifecycle ------------------------------------------------
    const resetMatcher = useCallback((score: Score) => {
        matcherRef.current = new PhraseMatcher(
            scoreEvents(score).map(e => (e.pitch ? e.pitch.midi : null)),
            // At-your-pace: assume a re-attack after a long sustained episode
            // so repeated notes can never deadlock the run (tempo stays strict).
            { unblockAfterMs: paceRef.current === 'step' ? REARM_AFTER_SUSTAINED_MS : null },
        );
        setStatuses(matcherRef.current.allStatuses());
    }, []);

    const makeSlice = useCallback(() =>
        sliceScore(fullScore, selection.startBar, selection.barCount), [fullScore, selection.startBar, selection.barCount]);

    // Structural change: new score or selection → full reset to ready.
    useEffect(() => {
        const slice = makeSlice();
        setActiveScore(slice);
        resetMatcher(slice);
        setAccumulated({ total: 0, matched: 0, missed: 0, skipped: 0 });
        audioEngine.cancelGroup(PREVIEW_GROUP);
        audioEngine.cancelGroup(CLICK_GROUP);
        setPhaseBoth('ready');
        setCurrentIdx(-1);
        setCountInLeft(0);
        setError(null);
        runTokenRef.current++;
    }, [makeSlice, resetMatcher, setPhaseBoth]);

    // Config change while running → pause (never retime mid-note).
    const prevConfigRef = useRef(config);
    useEffect(() => {
        const prev = prevConfigRef.current;
        prevConfigRef.current = config;
        if (
            (prev.pace !== config.pace || prev.bpm !== config.bpm ||
                prev.clickSound !== config.clickSound || prev.inputMode !== config.inputMode) &&
            (phaseRef.current === 'playing' || phaseRef.current === 'countIn')
        ) {
            pauseInternalRef.current?.();
        }
    }, [config]);

    // ---- Transport tick ----------------------------------------------------
    const tickRef = useRef<() => void>(() => { });

    const finishRun = useCallback(() => {
        audioEngine.cancelGroup(CLICK_GROUP);
        const m = matcherRef.current;
        if (m) setStatuses(m.allStatuses());
        setCurrentIdx(-1);
        setPhaseBoth('done');

    }, [setPhaseBoth]);

    const processBoundaries = useCallback((now: number) => {
        const schedule = scheduleRef.current;
        const token = runTokenRef.current;
        if (!schedule) return;
        // Schedule click audio ahead of time (no state change yet).
        while (
            clickIdxRef.current < schedule.length &&
            schedule[clickIdxRef.current].at < now + LOOKAHEAD_S
        ) {
            const e = schedule[clickIdxRef.current];
            // With a count-in, the downbeat of bar 1 is already the LAST
            // count-in click — an extra click at scoreStart would make the
            // player count "1 2 3 4 | 1" and start one beat early.
            const isRedundantDownbeat =
                e.kind === 'beat' &&
                countInBeatsRef.current > 0 &&
                e.at <= scoreStartRef.current + 0.02;
            if ((e.kind === 'count-in-beat' || e.kind === 'beat') && !isRedundantDownbeat && configRef.current.clickSound) {
                audioEngine.playClickAt(e.at, CLICK_VOLUME, e.kind === 'count-in-beat' ? e.beat === 0 : e.accent === true);
            }
            // Publish every beat to the shared bus so the metronome widget's
            // pendulum stays in sync with the run (click or no click).
            if (e.kind === 'count-in-beat' || e.kind === 'beat') {
                phraseBeatBus.emit(e.beat ?? 0, e.at);
            }
            clickIdxRef.current++;
        }
        // Fire state boundaries only when the clock reaches them.
        while (boundaryIdxRef.current < schedule.length && schedule[boundaryIdxRef.current].at <= now) {
            if (runTokenRef.current !== token) return;
            const e = schedule[boundaryIdxRef.current];
            if (e.kind === 'count-in-beat') {
                if (phaseRef.current === 'countIn') {
                    const left = Math.max(0, Math.ceil((scoreStartRef.current - now) / spbRef.current));
                    setCountInLeft(left);
                }
            } else if (e.kind === 'note-end' && e.index !== undefined) {
                matcherRef.current?.expireWindow(e.index);
                windowIdxRef.current = e.index + 1;
                const n = events.length;
                const nextIdx = Math.min(windowIdxRef.current, Math.max(0, n - 1));
                matcherRef.current?.setCurrent(nextIdx);
                if (n > 0) setCurrentIdx(nextIdx);
                const m = matcherRef.current;
                if (m) setStatuses(m.allStatuses());
            } else if (e.kind === 'done') {
                finishRun();
                return;
            }
            boundaryIdxRef.current++;
        }
        if (phaseRef.current === 'countIn' && now >= scoreStartRef.current) {
            setPhaseBoth('playing');
            setCountInLeft(0);
        }
    }, [events.length, finishRun, setPhaseBoth]);

    useEffect(() => {
        tickRef.current = () => {
            const now = audioEngine.now();
            processBoundaries(now);
        };
    }, [processBoundaries]);

    // Interval only while time is flowing.
    useEffect(() => {
        if (phase !== 'countIn' && phase !== 'playing') return;
        const id = setInterval(() => tickRef.current(), TICK_MS);
        return () => clearInterval(id);
    }, [phase]);

    const advanceStep = useCallback((m: PhraseMatcher) => {
        const next = m.firstPending;
        if (next === -1) {
            finishRun();
        } else {
            setCurrentIdx(next);
        }
        const blockedNow = m.isBlocked();
        if (blockedNow !== repeatBlockedRef.current) {
            repeatBlockedRef.current = blockedNow;
            setRepeatedNoteBlocked(blockedNow);
        }
    }, [finishRun]);

    // ---- Frame handling ----------------------------------------------------
    useEffect(() => {
        const unsubscribe = subscribeRawFrames(frame => {
            if (configRef.current.inputMode !== 'mic') return;
            const p = phaseRef.current;
            // Auto-start: first detected note begins the run immediately
            // (no count-in) — only in step pace, only from 'ready', mic only.
            if (
                p === 'ready' &&
                configRef.current.autoStartOnNote &&
                paceRef.current === 'step'
            ) {
                startRef.current?.();
                // Fall through: this frame feeds the fresh run below.
            }
            const p2 = phaseRef.current;
            if (p2 !== 'countIn' && p2 !== 'playing') return;
            // Pitched speaker output (preview, virtual instruments) must not
            // be scored; while audible the matcher sees no frames at all.
            if (audioEngine.isAudible()) return;
            if (paceRef.current === 'tempo') {
                // Finish expired windows before applying the frame.
                processBoundaries(audioEngine.now());
                if (phaseRef.current !== 'countIn' && phaseRef.current !== 'playing') return;
            }
            // Click blanking: skip the frame entirely (no episode update).
            if (audioEngine.isMicBlanked()) return;

            const m = matcherRef.current;
            if (!m) return;
            let idx: number;
            if (paceRef.current === 'step') {
                idx = m.firstPending;
                if (idx === -1) return;
            } else if (phaseRef.current === 'countIn') {
                // Count-in: episode tracking only, NO scoring (contract D.9).
                idx = -1;
            } else {
                idx = Math.min(windowIdxRef.current, Math.max(0, events.length - 1));
            }
            const out = m.feed(frame.midi, frame.at, idx);
            const blockedNow = m.isBlocked();
            if (blockedNow !== repeatBlockedRef.current) {
                repeatBlockedRef.current = blockedNow;
                setRepeatedNoteBlocked(blockedNow);
            }
            if (out) {
                setStatuses(m.allStatuses());
                if (paceRef.current === 'step') advanceStep(m);
            }
        });
        return unsubscribe;
    }, [events.length, processBoundaries, advanceStep]);

    // ---- Actions -----------------------------------------------------------
    const startRef = useRef<(() => void) | null>(null);

    const start = useCallback(() => {
        if (repeatTimerRef.current) { clearTimeout(repeatTimerRef.current); repeatTimerRef.current = null; }
        audioEngine.cancelGroup(PREVIEW_GROUP);
        audioEngine.cancelGroup(CLICK_GROUP);
        if (previewTimerRef.current) { clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
        runTokenRef.current++;
        const token = runTokenRef.current;
        setError(null);

        const score = activeScore;
        const m = matcherRef.current;
        if (!m) return;
        m.reset();
        setStatuses(m.allStatuses());
        setAccumulated(prev => (prev.total === 0 ? prev : prev)); // keep; retry resets separately

        const bpm = sanitizeBpm(configRef.current.bpm);
        spbRef.current = 60 / bpm;

        if (paceRef.current === 'tempo') {
            void audioEngine.ensureRunning().then(() => {
                if (runTokenRef.current !== token) return;
                if (!audioEngine.isRunning()) {
                    setError('Audio could not start — try again.');
                    setPhaseBoth('ready');
                    return;
                }
                const now = audioEngine.now();
                const countIn = score.meter.numerator;
                countInBeatsRef.current = countIn;
                scoreStartRef.current = now + 0.15 + countIn * spbRef.current;
                scheduleRef.current = buildSchedule(score, bpm, now + 0.15, countIn);
                boundaryIdxRef.current = 0;
                clickIdxRef.current = 0;
                windowIdxRef.current = 0;
                m.setCurrent(scoreEvents(score).length > 0 ? 0 : -1);
                setCurrentIdx(0);
                setCountInLeft(countIn);
                setPhaseBoth('countIn');
                tickRef.current();
            });
        } else {
            // At-your-pace needs no audio context at all.
            scheduleRef.current = [];
            const first = m.firstPending;
            if (first === -1) { finishRun(); return; }
            m.setCurrent(first);
            setCurrentIdx(first);
            setPhaseBoth('playing');
        }
    }, [activeScore, finishRun, setPhaseBoth]);
    startRef.current = start;

    const pauseInternalRef = useRef<(() => void) | null>(null);

    const pause = useCallback(() => {
        if (phaseRef.current !== 'playing' && phaseRef.current !== 'countIn') return;
        if (repeatTimerRef.current) { clearTimeout(repeatTimerRef.current); repeatTimerRef.current = null; }
        audioEngine.cancelGroup(CLICK_GROUP);
        setPhaseBoth('paused');
    }, [setPhaseBoth]);
    pauseInternalRef.current = pause;

    const resumeTempo = useCallback(() => {
        const m = matcherRef.current;
        if (!m) return;
        const evts = events;
        if (evts.length === 0) { start(); return; }
        // Current bar = bar of the window we were in (or the last note's bar).
        const idx = Math.min(windowIdxRef.current, evts.length - 1);
        const ev = evts[Math.max(0, idx)];
        const bar = activeScore.measures.find(
            m2 => ev.startTick >= m2.startTick && ev.startTick < m2.startTick + m2.durationTicks
        ) ?? activeScore.measures[activeScore.measures.length - 1];
        // Accumulate resolved results of the DROPPED part (events fully
        // before the bar we restart from).
        const barStart = bar.startTick;
        let droppedTotal = 0, droppedMatched = 0, droppedMissed = 0, droppedSkipped = 0;
        evts.forEach((e, i) => {
            if (e.startTick + e.durationTicks <= barStart) {
                const st = m.status(i);
                if (!e.pitch) return;
                droppedTotal++;
                if (st === 'matched') droppedMatched++;
                else if (st === 'missed') droppedMissed++;
                else if (st === 'skipped') droppedSkipped++;
            }
        });
        const dropped: PhraseSummary = { total: droppedTotal, matched: droppedMatched, missed: droppedMissed, skipped: droppedSkipped };
        setAccumulated(prev => ({
            total: prev.total + dropped.total,
            matched: prev.matched + dropped.matched,
            missed: prev.missed + dropped.missed,
            skipped: prev.skipped + dropped.skipped,
        }));

        // Re-slice from that bar: ties entering the slice become fresh attacks.
        const remainingBarCount = selection.startBar + selection.barCount - bar.number;
        const tail = sliceScore(fullScore, bar.number, Math.max(1, remainingBarCount));
        setActiveScore(tail);
        resetMatcher(tail);
        runTokenRef.current++;
        const token = runTokenRef.current;
        const bpm = sanitizeBpm(configRef.current.bpm);
        spbRef.current = 60 / bpm;
        void audioEngine.ensureRunning().then(() => {
            if (runTokenRef.current !== token) return;
            const now = audioEngine.now();
            const countIn = tail.meter.numerator;
            countInBeatsRef.current = countIn;
            scoreStartRef.current = now + 0.15 + countIn * spbRef.current;
            scheduleRef.current = buildSchedule(tail, bpm, now + 0.15, countIn);
            boundaryIdxRef.current = 0;
            clickIdxRef.current = 0;
            windowIdxRef.current = 0;
            matcherRef.current?.setCurrent(scoreEvents(tail).length > 0 ? 0 : -1);
            setCurrentIdx(0);
            setCountInLeft(countIn);
            setPhaseBoth('countIn');
            tickRef.current();
        });
    }, [activeScore, events, fullScore, resetMatcher, selection.barCount, selection.startBar, setPhaseBoth, start]);

    const pauseToggle = useCallback(() => {
        const p = phaseRef.current;
        if (p === 'playing' || p === 'countIn') pause();
        else if (p === 'paused') {
            if (paceRef.current === 'tempo') resumeTempo();
            else setPhaseBoth('playing');
        } else if (p === 'ready' || p === 'done') start();
        // preview: handled by previewToggle
    }, [pause, resumeTempo, setPhaseBoth, start]);

    const retry = useCallback(() => {
        const score = makeSlice();
        setActiveScore(score);
        resetMatcher(score);
        setAccumulated({ total: 0, matched: 0, missed: 0, skipped: 0 });
        start();
    }, [makeSlice, resetMatcher, start]);

    const skip = useCallback(() => {
        if (phaseRef.current !== 'playing') return;
        if (paceRef.current !== 'step') return; // skip is at-your-pace only
        const m = matcherRef.current;
        if (!m) return;
        const idx = m.firstPending;
        if (idx === -1) return;
        m.setStatus(idx, 'skipped');
        setStatuses(m.allStatuses());
        advanceStep(m);
    }, [advanceStep]);

    const previewToggle = useCallback(() => {
        if (phaseRef.current === 'preview') {
            audioEngine.cancelGroup(PREVIEW_GROUP);
            if (previewTimerRef.current) { clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
            setPhaseBoth('ready');
            return;
        }
        pause();
        runTokenRef.current++;
        const token = runTokenRef.current;
        void audioEngine.ensureRunning().then(() => {
            if (runTokenRef.current !== token) return;
            const bpm = sanitizeBpm(configRef.current.bpm);
            const spb = 60 / bpm;
            const t0 = audioEngine.now() + 0.15;
            const vol = configRef.current.previewVolume ?? 0.4;
            for (const e of events) {
                if (!e.pitch) continue;
                audioEngine.scheduleNote(e.pitch.midi, t0 + (e.startTick / PPQ) * spb, (e.durationTicks / PPQ) * spb, vol, PREVIEW_GROUP);
            }
            // Tempo pace: click along with the preview so the rhythm is
            // audible while listening (quarter beats over the full span).
            // Registered in PREVIEW_GROUP so stopping the preview also stops
            // its clicks (no ghost metronomes after an aborted preview).
            if (paceRef.current === 'tempo' && configRef.current.clickSound) {
                const totalTicks = events.reduce((a, e) => Math.max(a, e.startTick + e.durationTicks), 0);
                const beats = Math.floor(totalTicks / PPQ);
                for (let i = 0; i < beats; i++) {
                    audioEngine.playClickAt(t0 + i * spb, CLICK_VOLUME, i % 4 === 0, PREVIEW_GROUP);
                }
            }
            setPhaseBoth('preview');
            const totalSec = (events.reduce((a, e) => Math.max(a, e.startTick + e.durationTicks), 0) / PPQ) * spb;
            previewTimerRef.current = setTimeout(() => {
                if (runTokenRef.current === token) {
                    setPhaseBoth('ready');
                }
            }, 150 + totalSec * 1000 + 200);
        });
    }, [events, pause, setPhaseBoth]);

    const virtualTap = useCallback((midi: number) => {
        const p = phaseRef.current;
        if (p !== 'playing') return; // no scoring during count-in/preview/done
        const m = matcherRef.current;
        if (!m) return;
        let idx: number;
        if (paceRef.current === 'step') {
            idx = m.firstPending;
            if (idx === -1) return;
        } else {
            idx = Math.min(windowIdxRef.current, Math.max(0, events.length - 1));
        }
        const out = m.tap(midi, idx);
        if (out) {
            setStatuses(m.allStatuses());
            if (paceRef.current === 'step') advanceStep(m);
        }
    }, [advanceStep, events.length]);

    const stop = useCallback(() => {
        if (repeatTimerRef.current) { clearTimeout(repeatTimerRef.current); repeatTimerRef.current = null; }
        if (previewTimerRef.current) { clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
        audioEngine.cancelGroup(PREVIEW_GROUP);
        audioEngine.cancelGroup(CLICK_GROUP);
        runTokenRef.current++;
        setPhaseBoth('ready');
    }, [setPhaseBoth]);

    // ---- Lifecycle guards ---------------------------------------------------
    // Pause when the tab hides or the microphone fails mid-run.
    useEffect(() => {
        const onVisibility = () => {
            if (document.hidden) pause();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [pause]);

    useEffect(() => {
        if (micError && (phaseRef.current === 'playing' || phaseRef.current === 'countIn')) pause();
    }, [micError, pause]);

    useEffect(() => {
        if (phaseRef.current !== 'ready' && !micActive && configRef.current.inputMode === 'mic') pause();
    }, [micActive, pause]);

    useEffect(() => () => {
        // Unmount: cancel all scheduled audio and timers.
        if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
        if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
        audioEngine.cancelGroup(PREVIEW_GROUP);
        audioEngine.cancelGroup(CLICK_GROUP);
    }, []);

    const summary = useMemo<PhraseSummary>(() => {
        let total = accumulated.total;
        let matched = accumulated.matched;
        let missed = accumulated.missed;
        let skipped = accumulated.skipped;
        for (let i = 0; i < statuses.length; i++) {
            if (events[i]?.pitch === null || events[i]?.pitch === undefined) continue;
            if (statuses[i] === 'pending' || statuses[i] === 'rest') continue;
            total++;
            if (statuses[i] === 'matched') matched++;
            else if (statuses[i] === 'missed') missed++;
            else if (statuses[i] === 'skipped') skipped++;
        }
        return { total, matched, missed, skipped };
    }, [accumulated, statuses, events]);

    return {
        phase,
        activeScore,
        statuses,
        currentIdx,
        countInLeft,
        scoreStart: scoreStartRef.current,
        spb: spbRef.current,
        error,
        summary,
        start,
        pauseToggle,
        retry,
        skip,
        previewToggle,
        virtualTap,
        pause,
        stop,
        repeatedNoteBlocked,
    };
}
