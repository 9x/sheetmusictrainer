import React from 'react';
import './TuningMeter.css';

interface TuningMeterProps {
    /** Deviation in cents from nearest note (-50 to +50 usually), already
     *  smoothed by the detection loop (display-only value). Null = no signal. */
    cents: number | null;
    /** The detected note name (e.g. "A4"). Null = no signal. */
    noteName: string | null;
}

export const TuningMeter: React.FC<TuningMeterProps> = ({ cents, noteName }) => {
    const hasSignal = cents !== null && noteName !== null;

    // Clamp for display (-50 to 50), then map to 0..100%.
    // No CSS transition: cents updates every detection frame (~60 fps) and is
    // EMA-smoothed upstream — see usePitchDetector / AppConfig. When there is
    // no signal the needle parks in the middle and the widget dims.
    const clampedCents = Math.max(-50, Math.min(50, cents ?? 0));
    const positionPercent = ((clampedCents + 50) / 100) * 100;

    // Status color reacts instantly to the raw (unsmoothed) value
    let statusClass = 'neutral';
    if (hasSignal) {
        if (Math.abs(cents!) < 5) {
            statusClass = 'perfect'; // Green
        } else if (Math.abs(cents!) < 15) {
            statusClass = 'good'; // Green-ish
        } else if (Math.abs(cents!) < 30) {
            statusClass = 'okay'; // Yellow
        } else {
            statusClass = 'poor'; // Red
        }
    }

    return (
        <div className={`tuning-meter-container ${hasSignal ? '' : 'inactive'}`}>
            <div className="meter-scale">
                <div className="tick tick-left">-50</div>
                <div className="tick tick-center">0</div>
                <div className="tick tick-right">+50</div>

                {/* Center Marker Line */}
                <div className="center-line"></div>

                {/* The Needle/Indicator — position updated directly per frame */}
                <div
                    className={`meter-needle ${statusClass}`}
                    style={{ left: `${positionPercent}%` }}
                >
                    <div className="needle-head"></div>
                </div>
            </div>
            <div className="tuning-readout">
                <span className="note-name">{hasSignal ? noteName : '—'}</span>
                <span className={`cents-value ${statusClass}`}>
                    {hasSignal ? `${cents! > 0 ? '+' : ''}${Math.round(cents!)} ct` : '—'}
                </span>
            </div>
        </div>
    );
};
