
import React from 'react';
import './TuningMeter.css';

interface TuningMeterProps {
    cents: number; // Deviation in cents from nearest note (-50 to +50 usually)
    noteName: string; // The detected note name (e.g. "A4")
}

export const TuningMeter: React.FC<TuningMeterProps> = ({ cents, noteName }) => {
    // Clamp cents for display (-50 to 50)
    const clampedCents = Math.max(-50, Math.min(50, cents));

    // Map -50..50 to 0..100% for position
    // -50 cents -> 0%
    // 0 cents -> 50%
    // 50 cents -> 100%
    const positionPercent = ((clampedCents + 50) / 100) * 100;

    // Color determination
    let statusClass = 'neutral';
    if (Math.abs(cents) < 5) {
        statusClass = 'perfect'; // Green
    } else if (Math.abs(cents) < 15) {
        statusClass = 'good'; // Green-ish
    } else if (Math.abs(cents) < 30) {
        statusClass = 'okay'; // Yellow
    } else {
        statusClass = 'poor'; // Red
    }

    return (
        <div className="tuning-meter-container">
            <div className="meter-scale">
                <div className="tick tick-left">-50</div>
                <div className="tick tick-center">0</div>
                <div className="tick tick-right">+50</div>

                {/* Center Marker Line */}
                <div className="center-line"></div>

                {/* The Needle/Indicator */}
                <div
                    className={`meter-needle ${statusClass}`}
                    style={{ left: `${positionPercent}%` }}
                >
                    <div className="needle-head"></div>
                </div>
            </div>
            <div className="tuning-readout">
                <span className="note-name">{noteName}</span>
                <span className={`cents-value ${statusClass}`}>
                    {cents > 0 ? '+' : ''}{Math.round(cents)} ct
                </span>
            </div>
        </div>
    );
};
