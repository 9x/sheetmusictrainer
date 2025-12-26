import type { Tuning, FretPosition } from '../music/Tunings';

interface FretboardHintProps {
    tuning: Tuning;
    positions: FretPosition[];
    maxFrets?: number; // How many frets to display
}

export function FretboardHint({ tuning, positions, maxFrets = 15 }: FretboardHintProps) {
    // Config
    const numStrings = tuning.strings.length;
    // Visual params
    const stringSpacing = 30; // Vertical space between strings
    const fretWidth = 50;     // Horizontal space for one fret
    const nutWidth = 6;       // Width of the nut
    const paddingX = 20;      // Padding left/right
    const paddingY = 20;      // Padding top/bottom

    const width = paddingX * 2 + nutWidth + (maxFrets * fretWidth);
    const height = paddingY * 2 + ((numStrings - 1) * stringSpacing);

    // Markers (standard guitar dots)
    // 3, 5, 7, 9, 12, 15, 17, 19, 21
    const markers = [3, 5, 7, 9, 12, 15, 17, 19, 21].filter(m => m <= maxFrets);

    // Helper to get Y coordinate for a string index
    // String 0 is lowest pitch. In tab/charts, lowest pitch is usually the BOTTOM line.
    // So index 0 -> max Y.
    const getStringY = (stringIndex: number) => {
        // stringIndex 0 (Low E) -> bottom line
        // stringIndex N (High E) -> top line
        return height - paddingY - (stringIndex * stringSpacing);
    };

    // Helper to get X coordinate for a fret line
    // Fret N line is at x = padding + nut + N * width
    const getFretLineX = (fretNum: number) => {
        return paddingX + nutWidth + (fretNum * fretWidth);
    };

    // Helper to get Center X for a note at fret N
    // If fret 0 (open), place it to left of nut.
    // If fret > 0, place it in middle of Fret N-1 and Fret N.
    const getNoteX = (fretNum: number) => {
        if (fretNum === 0) {
            return paddingX + (nutWidth / 2) - 15; // To the left of nut
        }
        const startX = getFretLineX(fretNum - 1);
        const endX = getFretLineX(fretNum);
        return (startX + endX) / 2;
    };

    return (
        <div className="fretboard-container" style={{ overflowX: 'auto', maxWidth: '100%' }}>
            <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${width} ${height}`}
                style={{ display: 'block', margin: '0 auto', maxHeight: '100%' }}
            >
                {/* Fretboard background */}
                <rect
                    x={paddingX + nutWidth}
                    y={paddingY}
                    width={width - (paddingX * 2) - nutWidth}
                    height={height - (paddingY * 2)}
                    fill="#999999" // Requested dark gray
                    stroke="none"
                />

                {/* Nut */}
                <rect
                    x={paddingX}
                    y={paddingY}
                    width={nutWidth}
                    height={height - (paddingY * 2)}
                    fill="#333" // Dark nut
                />

                {/* Fret Markers (Dots) on fretboard */}
                {markers.map(m => {
                    const cx = getNoteX(m);
                    const cy = height / 2;
                    const isDouble = m % 12 === 0;

                    if (isDouble) {
                        // Draw two dots
                        return (
                            <g key={`marker-${m}`}>
                                <circle cx={cx} cy={height / 2 - stringSpacing} r={6} fill="#777" />
                                <circle cx={cx} cy={height / 2 + stringSpacing} r={6} fill="#777" />
                            </g>
                        );
                    }

                    return (
                        <circle key={`marker-${m}`} cx={cx} cy={cy} r={6} fill="#777" />
                    );
                })}

                {/* Frets (Vertical lines) */}
                {Array.from({ length: maxFrets + 1 }).map((_, i) => {
                    if (i === 0) return null; // Nut handles 0
                    const x = getFretLineX(i);
                    return (
                        <line
                            key={`fret-${i}`}
                            x1={x}
                            y1={paddingY}
                            x2={x}
                            y2={height - paddingY}
                            stroke="#CCCCCC" // Lighter frets
                            strokeWidth={1}
                        />
                    );
                })}

                {/* Strings (Horizontal lines) */}
                {tuning.strings.map((_, i) => {
                    const y = getStringY(i);

                    // i=0 is LOW pitch (thickest). 
                    // Bolder: Increase base thick
                    const visualThickness = 4 - (i * 0.4); // 4 down to ~2

                    return (
                        <line
                            key={`string-${i}`}
                            x1={paddingX}
                            y1={y}
                            x2={width - paddingX}
                            y2={y}
                            stroke="#EEEEEE" // Lighter strings
                            strokeWidth={Math.max(1.5, visualThickness)}
                        />
                    );
                })}

                {/* Target Note Positions */}
                {positions.map((p, idx) => {
                    // Verify if fret is within range
                    if (p.fret > maxFrets) return null;

                    const cx = getNoteX(p.fret);
                    const cy = getStringY(p.stringIndex);

                    return (
                        <g key={`pos-${idx}`}>
                            <circle
                                cx={cx}
                                cy={cy}
                                r={10}
                                fill="var(--color-primary, #e63946)"
                                stroke="white"
                                strokeWidth={2}
                            />
                            <text
                                x={cx}
                                y={cy}
                                dy={4}
                                fill="white"
                                fontSize={10}
                                fontWeight="bold"
                                textAnchor="middle"
                            >
                                {p.fret}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}
