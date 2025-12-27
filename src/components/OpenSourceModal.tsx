import React from 'react';
import { X } from 'lucide-react';
import '../styles/OpenSourceModal.css';

interface OpenSourceModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const LIBRARIES = [
    { name: 'React', url: 'https://react.dev/', description: 'The library for web and native user interfaces' },
    { name: 'TypeScript', url: 'https://www.typescriptlang.org/', description: 'JavaScript with syntax for types' },
    { name: 'Vite', url: 'https://vitejs.dev/', description: 'Next Generation Frontend Tooling' },
    { name: 'VexFlow', url: 'https://www.vexflow.com/', description: 'Music notation rendering for the web' },
    { name: 'Pitchfinder', url: 'https://github.com/peterkhayes/pitchfinder', description: 'Pitch detection algorithms' },
    { name: 'Lucide React', url: 'https://lucide.dev/', description: 'Beautiful & consistent icon toolkit' },
];

export const OpenSourceModal: React.FC<OpenSourceModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content open-source-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Open Source Libraries</h2>
                    <button className="close-button" onClick={onClose} aria-label="Close">
                        <X size={24} />
                    </button>
                </div>

                <div className="modal-body">
                    <p>This project relies on these amazing open source libraries:</p>
                    <ul className="library-list">
                        {LIBRARIES.map((lib) => (
                            <li key={lib.name} className="library-item">
                                <a href={lib.url} target="_blank" rel="noopener noreferrer" className="library-name">
                                    {lib.name}
                                </a>
                                <span className="library-desc">{lib.description}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
};
