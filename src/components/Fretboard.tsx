import { useState } from 'react';
import type { Tuning, FretPosition } from '../music/Tunings';
import { getNoteDetails } from '../music/NoteUtils';

interface FretboardProps {
    tuning: Tuning;
    positions: FretPosition[];
    maxFrets?: number;
    interactive?: boolean;
    showHints?: boolean;
    showTooltips?: boolean;
    displayTranspose?: number;
    onPlayNote?: (midi: number) => void;
    onHover?: (midi: number | null) => void;
}

export function Fretboard({
    tuning,
    positions,
    maxFrets = 15,
    interactive = false,
    showHints = true,
    showTooltips = false,
    displayTranspose = 0,
    onPlayNote,
    onHover
}: FretboardProps) {
    const [hoverPos, setHoverPos] = useState<{ stringIndex: number, fret: number } | null>(null);

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
    // String 0 is lowest pitch (Bottom line)
    // String N is highest pitch (Top line)
    const getStringY = (stringIndex: number) => {
        return height - paddingY - (stringIndex * stringSpacing);
    };

    // Helper to get X coordinate for a fret line
    const getFretLineX = (fretNum: number) => {
        return paddingX + nutWidth + (fretNum * fretWidth);
    };

    // Helper to get Center X for a note at fret N
    const getNoteX = (fretNum: number) => {
        if (fretNum === 0) {
            return paddingX + (nutWidth / 2) - 15; // To the left of nut
        }
        const startX = getFretLineX(fretNum - 1);
        const endX = getFretLineX(fretNum);
        return (startX + endX) / 2;
    };

    const handleFretClick = (stringIndex: number, fret: number) => {
        if (!interactive || !onPlayNote) return;
        const baseMidi = tuning.strings[stringIndex];
        const noteMidi = baseMidi + fret;
        onPlayNote(noteMidi);
    };

    return (
        <div className="fretboard-container" style={{
            width: '100%',
            height: '100%',
            overflow: 'visible', // Allow tooltips to pop out
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            cursor: interactive ? 'pointer' : 'default'
        }}>
            <svg
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="xMidYMid meet"
                style={{
                    width: '100%',
                    height: '100%',
                    maxHeight: '100%',
                    display: 'block'
                }}
            >
                {/* Fretboard background */}
                <rect
                    x={paddingX + nutWidth}
                    y={paddingY}
                    width={width - (paddingX * 2) - nutWidth}
                    height={height - (paddingY * 2)}
                    fill="#999999"
                    stroke="none"
                />

                {/* Nut */}
                <rect
                    x={paddingX}
                    y={paddingY}
                    width={nutWidth}
                    height={height - (paddingY * 2)}
                    fill="#333"
                />

                {/* Fret Markers (Dots) */}
                {markers.map(m => {
                    const cx = getNoteX(m);
                    const isDouble = m % 12 === 0;

                    if (isDouble) {
                        return (
                            <g key={`marker-${m}`}>
                                <circle cx={cx} cy={height / 2 - stringSpacing} r={6} fill="#777" />
                                <circle cx={cx} cy={height / 2 + stringSpacing} r={6} fill="#777" />
                            </g>
                        );
                    }
                    return (
                        <circle key={`marker-${m}`} cx={cx} cy={height / 2} r={6} fill="#777" />
                    );
                })}

                {/* Frets (Vertical lines) */}
                {Array.from({ length: maxFrets + 1 }).map((_, i) => {
                    if (i === 0) return null;
                    const x = getFretLineX(i);
                    return (
                        <line
                            key={`fret-${i}`}
                            x1={x}
                            y1={paddingY}
                            x2={x}
                            y2={height - paddingY}
                            stroke="#CCCCCC"
                            strokeWidth={1}
                        />
                    );
                })}

                {/* Strings (Horizontal lines) */}
                {tuning.strings.map((_, i) => {
                    const y = getStringY(i);
                    const visualThickness = 4 - (i * 0.4);
                    return (
                        <line
                            key={`string-${i}`}
                            x1={paddingX}
                            y1={y}
                            x2={width - paddingX}
                            y2={y}
                            stroke="#EEEEEE"
                            strokeWidth={Math.max(1.5, visualThickness)}
                        />
                    );
                })}

                {/* Target Note Positions (Hints) */}
                {showHints && positions.map((p, idx) => {
                    if (p.fret > maxFrets) return null;
                    const cx = getNoteX(p.fret);
                    const cy = getStringY(p.stringIndex);

                    return (
                        <g key={`pos-${idx}`} style={{ pointerEvents: 'none' }}>
                            {/* Add pointerEvents: none so hints don't block clicks if they overlay logic */}
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

                {/* Hover Highlight (Ghost Dot) */}
                {interactive && hoverPos && (
                    (() => {
                        const cx = getNoteX(hoverPos.fret);
                        const cy = getStringY(hoverPos.stringIndex);

                        return (
                            <g style={{ pointerEvents: 'none' }}>
                                <circle
                                    cx={cx}
                                    cy={cy}
                                    r={8}
                                    fill="transparent"
                                    stroke="#888"
                                    strokeWidth={2}
                                />
                            </g>
                        );
                    })()
                )}

                {/* Interaction Overlay (Invisible hit targets) */}
                {interactive && tuning.strings.map((_, stringIndex) => {
                    const y = getStringY(stringIndex);
                    // Hit area height (centered on string)
                    const hitHeight = stringSpacing; // Full coverage between strings
                    const yStart = y - (hitHeight / 2);

                    return Array.from({ length: maxFrets + 1 }).map((_, fret) => {
                        // Calculate X range for this fret
                        let xStart = 0;
                        let xEnd = 0;

                        if (fret === 0) {
                            xStart = paddingX - 25; // Extend left a bit
                            xEnd = paddingX + nutWidth;
                        } else {
                            xStart = getFretLineX(fret - 1);
                            xEnd = getFretLineX(fret);
                        }

                        const rectWidth = xEnd - xStart;
                        const midi = tuning.strings[stringIndex] + fret;

                        return (
                            <rect
                                key={`hit-${stringIndex}-${fret}`}
                                x={xStart}
                                y={yStart}
                                width={rectWidth}
                                height={hitHeight}
                                fill="transparent"
                                style={{ cursor: 'pointer' }}
                                onClick={() => handleFretClick(stringIndex, fret)}
                                onMouseEnter={() => {
                                    setHoverPos({ stringIndex, fret });
                                    onHover?.(midi);
                                }}
                                onMouseLeave={() => {
                                    setHoverPos(null);
                                    onHover?.(null);
                                }}
                                className="fret-hit-target"
                            >
                                <title>String {stringIndex + 1}, Fret {fret}</title>
                            </rect>
                        );
                    });
                })}
            </svg>

            {/* HTML Tooltip Overlay */}
            {interactive && showTooltips && hoverPos && (() => {
                const cx = getNoteX(hoverPos.fret);
                const cy = getStringY(hoverPos.stringIndex);
                const midi = tuning.strings[hoverPos.stringIndex] + hoverPos.fret;

                // Convert to percentages to handle SVG scaling
                const left = (cx / width) * 100;
                const top = (cy / height) * 100;

                return (
                    <div style={{
                        position: 'absolute',
                        left: `${left}%`,
                        top: `${top}%`,
                        transform: 'translate(-50%, -100%) translateY(-15px)', // Center X, Move Y up.
                        background: '#333',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        zIndex: 10,
                        opacity: 0.9,
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none'
                    }}>
                        {getNoteDetails(midi + displayTranspose).scientific}
                        {/* CSS Arrow */}
                        <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            borderLeft: '6px solid transparent',
                            borderRight: '6px solid transparent',
                            borderTop: '6px solid #333'
                        }} />
                    </div>
                );
            })()}
        </div>
    );
}
