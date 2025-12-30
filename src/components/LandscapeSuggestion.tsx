import React, { useState, useEffect } from 'react';
import { Smartphone } from 'lucide-react';
import '../styles/landscape-suggestion.css';

export const LandscapeSuggestion: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const checkOrientation = () => {
            const isMobile = window.innerWidth <= 768;
            const isPortrait = window.innerHeight > window.innerWidth;
            setIsVisible(isMobile && isPortrait);
        };

        checkOrientation();
        window.addEventListener('resize', checkOrientation);
        return () => window.removeEventListener('resize', checkOrientation);
    }, []);

    if (!isVisible) return null;

    return (
        <div className="landscape-suggestion">
            <Smartphone size={24} className="rotate-icon" />
            <span>For the best experience, please rotate your device to landscape.</span>
            <button className="dismiss-btn" onClick={() => setIsVisible(false)}>×</button>
        </div>
    );
};
