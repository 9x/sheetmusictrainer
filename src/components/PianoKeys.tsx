import { useState, useRef, useEffect, useMemo } from 'react';
import { getNoteDetails } from '../music/NoteUtils';

// Constants
const WHITE_KEY_WIDTH_PX = 40;
const BLACK_KEY_WIDTH_PERCENT = 0.6; // 60% of white key
const BLACK_KEY_HEIGHT_PERCENT = 0.65; // 65% of white key length

interface PianoKeysProps {
    minMidi?: number; // Default 21 (A0)
    maxMidi?: number; // Default 108 (C8)
    markedNotes?: number[]; // Notes to highlight (e.g. hints)
    interactive?: boolean;
    onPlayNote?: (midi: number) => void;
    onHover?: (midi: number | null) => void;
    showTooltips?: boolean;
    displayTranspose?: number;
    height?: number;
}

export function PianoKeys({
    minMidi = 36, // C2
    maxMidi = 84, // C6
    markedNotes = [],
    interactive = true,
    onPlayNote,
    onHover,
    showTooltips = false,
    displayTranspose = 0,
    height = 160
}: PianoKeysProps) {
    const [viewMode, setViewMode] = useState<'full' | 'zoomed'>('zoomed');
    const [hoverMidi, setHoverMidi] = useState<number | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Helpers to determine key type and position
    const getIsBlackKey = (midi: number) => {
        const n = midi % 12;
        return [1, 3, 6, 8, 10].includes(n);
    };

    // Calculate the total number of WHITE keys in the range
    // This allows us to size them evenly
    const keys = useMemo(() => {
        const k = [];
        let whiteKeyCount = 0;
        for (let i = minMidi; i <= maxMidi; i++) {
            const isBlack = getIsBlackKey(i);
            if (!isBlack) whiteKeyCount++;
            k.push({ midi: i, isBlack });
        }
        return { list: k, whiteKeyCount };
    }, [minMidi, maxMidi]);

    // Handle Scrolling logic for zoomed view
    const handleScroll = () => {
        // Placeholder if we need scroll position logic later
    };

    // Scroll to center initially or when switching to zoomed
    useEffect(() => {
        if (viewMode === 'zoomed' && scrollRef.current) {
            const container = scrollRef.current;
            const contentWidth = container.scrollWidth;
            const clientWidth = container.clientWidth;
            // Center it roughly around Middle C (60) or the center of range
            // For now, simpler: center the scroll view
            container.scrollLeft = (contentWidth - clientWidth) / 2;
        }
    }, [viewMode]);


    // We'll use SVG for precision
    // 1. Calculate White Key Width based on Total Width
    // In 'full' mode: width = 100% / whiteKeyCount
    // In 'zoomed' mode: width = fixed pixel value (e.g. 40px)

    const whiteKeyWidth = viewMode === 'full' ? 100 / keys.whiteKeyCount : WHITE_KEY_WIDTH_PX; // % or px
    const totalWidthVal = viewMode === 'full' ? 100 : keys.whiteKeyCount * WHITE_KEY_WIDTH_PX;

    // Generate Key Definitions for SVG
    const keyRects = useMemo(() => {
        const rects = [];
        let currentWhiteIndex = 0;

        // Pass 1: White Keys
        for (const k of keys.list) {
            if (!k.isBlack) {
                rects.push({
                    midi: k.midi,
                    isBlack: false,
                    x: currentWhiteIndex * whiteKeyWidth,
                    width: whiteKeyWidth,
                    height: 100, // 100%
                    isC: k.midi % 12 === 0,
                    label: (k.midi % 12 === 0) ? `C${Math.floor(k.midi / 12) - 1}` : null
                });
                currentWhiteIndex++;
            }
        }

        // Pass 2: Black Keys
        // Black keys are positioned between white keys.
        // C# is between 0 and 1 (C and D)
        // Offset is usually:
        // C# : center on boundary of C/D
        // D# : center on boundary of D/E
        // F# : center on boundary of F/G
        // G# : center on boundary of G/A
        // A# : center on boundary of A/B

        // We need to find the X of the LEFT white key.
        // If Midi is M (black), left white is M-1.
        // Wait, not always.
        // C(0), C#(1), D(2) -> C# is between C and D.
        // F(5), F#(6), G(7) -> F# is between F and G.

        // Let's iterate again and calculate.
        let whiteIndex = 0;
        for (const k of keys.list) {
            if (!k.isBlack) {
                whiteIndex++;
            } else {
                // It's a black key. It sits on top of the boundary after the (whiteIndex - 1)th white key.
                // Center of black key ~= Right edge of previous white key.
                // Fine tuning: varying visual offsets exist, but centering is safe for virtual piano.

                // The C key is at index 0. Its right edge is (0+1) * w = w.
                // So center of C# is at w.

                const blackWidth = whiteKeyWidth * BLACK_KEY_WIDTH_PERCENT;
                const x = (whiteIndex * whiteKeyWidth) - (blackWidth / 2);

                rects.push({
                    midi: k.midi,
                    isBlack: true,
                    x: x,
                    width: blackWidth,
                    height: 65, // % height
                    isC: false
                });
            }
        }

        // Sort specifically so black keys are last (on top in SVG z-order)
        return rects.sort((a, b) => (a.isBlack === b.isBlack) ? 0 : a.isBlack ? 1 : -1);

    }, [keys, whiteKeyWidth, viewMode]);


    return (
        <div className="piano-wrapper" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>

            {/* Controls Bar */}
            <div className="piano-controls" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px', fontSize: '12px', color: '#888' }}>
                <div className="range-info">
                    Range: {keys.list[0]?.midi} - {keys.list[keys.list.length - 1]?.midi}
                </div>

                <div className="view-toggles" style={{ display: 'flex', gap: '8px', background: '#333', padding: '2px', borderRadius: '4px' }}>
                    <button
                        onClick={() => setViewMode('zoomed')}
                        style={{
                            background: viewMode === 'zoomed' ? '#666' : 'transparent',
                            border: 'none', color: 'white', padding: '2px 8px', borderRadius: '2px', cursor: 'pointer', fontSize: '10px'
                        }}
                    >
                        Zoom
                    </button>
                    <button
                        onClick={() => setViewMode('full')}
                        style={{
                            background: viewMode === 'full' ? '#666' : 'transparent',
                            border: 'none', color: 'white', padding: '2px 8px', borderRadius: '2px', cursor: 'pointer', fontSize: '10px'
                        }}
                    >
                        Full
                    </button>
                </div>
            </div>

            {/* Piano Scroll Container */}
            <div
                ref={scrollRef}
                className="piano-scroll-area"
                onScroll={handleScroll}
                style={{
                    width: '100%',
                    overflowX: viewMode === 'full' ? 'hidden' : 'auto',
                    borderTop: '1px solid #444',
                    background: '#222',
                    position: 'relative'
                }}
            >
                <div style={{
                    width: viewMode === 'full' ? '100%' : `${totalWidthVal}px`,
                    height: `${height}px`,
                    position: 'relative'
                }}>
                    <svg
                        width="100%"
                        height="100%"
                        viewBox={`0 0 ${viewMode === 'full' ? 100 : totalWidthVal} 100`}
                        preserveAspectRatio="none"
                        style={{ display: 'block' }}
                    >
                        {keyRects.map(k => {
                            const isMarked = markedNotes.includes(k.midi);

                            // Styling
                            let fill = k.isBlack ? '#222' : '#fff';
                            if (isMarked) {
                                fill = k.isBlack ? '#d32f2f' : '#ffcdd2'; // Red-ish for marked
                            } else if (interactive && hoverMidi === k.midi) {
                                fill = k.isBlack ? '#444' : '#eee'; // Subtle hover
                            }

                            const stroke = '#000';
                            const rectHeight = k.isBlack ? BLACK_KEY_HEIGHT_PERCENT * 100 : 100;

                            return (
                                <g
                                    key={k.midi}
                                    onClick={() => interactive && onPlayNote?.(k.midi)}
                                    onMouseEnter={() => {
                                        if (interactive) {
                                            setHoverMidi(k.midi);
                                            onHover?.(k.midi);
                                        }
                                    }}
                                    onMouseLeave={() => {
                                        if (interactive) {
                                            setHoverMidi(null);
                                            onHover?.(null);
                                        }
                                    }}
                                    style={{ cursor: interactive ? 'pointer' : 'default' }}
                                >
                                    <rect
                                        x={k.x}
                                        y={0}
                                        width={k.width}
                                        height={rectHeight}
                                        fill={fill}
                                        stroke={stroke}
                                        strokeWidth={0.5}
                                        vectorEffect="non-scaling-stroke"
                                        rx={k.isBlack ? 0 : 2}
                                        ry={k.isBlack ? 0 : 2}
                                    />


                                </g>
                            );
                        })}
                    </svg>

                    {/* Overlay for Labels to avoid distortion */}
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                        {keyRects.map(k => {
                            if (k.isBlack || !k.label) return null;
                            // Calculate left position as percentage or pixel
                            const left = viewMode === 'full'
                                ? `${k.x + (k.width / 2)}%`
                                : `${k.x + (k.width / 2)}px`;

                            return (
                                <div
                                    key={`lbl-${k.midi}`}
                                    style={{
                                        position: 'absolute',
                                        left: left,
                                        bottom: '8px',
                                        transform: 'translateX(-50%)',
                                        fontSize: '10px',
                                        color: '#999',
                                        userSelect: 'none'
                                    }}
                                >
                                    {k.label}
                                </div>
                            );
                        })}

                        {/* HTML Tooltip Overlay (Prevents distortion) */}
                        {interactive && showTooltips && hoverMidi && (() => {
                            const k = keyRects.find(k => k.midi === hoverMidi);
                            if (!k) return null;

                            const left = viewMode === 'full'
                                ? `${k.x + (k.width / 2)}%`
                                : `${k.x + (k.width / 2)}px`;

                            return (
                                <div
                                    key={`tooltip-${k.midi}`}
                                    style={{
                                        position: 'absolute',
                                        left: left,
                                        bottom: '40px', // Positioned above labels
                                        transform: 'translateX(-50%)',
                                        background: '#333',
                                        color: 'white',
                                        padding: '4px 8px',
                                        borderRadius: '6px',
                                        fontSize: '14px',
                                        fontWeight: 'bold',
                                        zIndex: 10,
                                        opacity: 0.9,
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    {getNoteDetails(hoverMidi + displayTranspose).scientific}
                                    {/* Simple CSS Arrow */}
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
                </div>
            </div>
        </div >
    );
}
