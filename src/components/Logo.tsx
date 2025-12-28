import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className }) => {
    return (
        <svg
            width="260"
            height="40"
            viewBox="0 0 260 40"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            aria-label="sight-reading.de logo"
        >
            <defs>
                <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    {/* Using currentColor strategy if needed, but for black/white requirement we stick to solid fill usually. 
              However, relying on currentColor allows dark mode adaptation. */}
                </linearGradient>
            </defs>

            {/* Icon: Stylized Fermata (Eye) */}
            <g transform="translate(5, 5) scale(1.1)">
                {/* The Arc (Eyelid) */}
                <path
                    d="M 2 18 Q 15 -5 28 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                />
                {/* The Dot (Pupil / Note head) */}
                <circle cx="15" cy="18" r="4" fill="currentColor" />
            </g>

            {/* Text */}
            <text
                x="48"
                y="28"
                fontFamily='"Inter", system-ui, -apple-system, sans-serif'
                fontSize="20"
                fill="currentColor"
            >
                <tspan fontWeight="700">sight-reading</tspan>
                <tspan fontWeight="300">.de</tspan>
            </text>
        </svg>
    );
};
