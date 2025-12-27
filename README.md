# Sheet Music Trainer

A web-based application designed to help musicians practice sight-reading and ear training. It listens to your instrument (or voice) via the microphone and gives real-time feedback.

[Live Demo](https://9x.github.io/sheetmusictrainer/) (If available)

## Features

-   **Sight Reading Mode**: Read notes from the interactive staff and play them on your instrument. The app listens and confirms when you hit the correct note.
-   **Ear Training Mode**: Listen to a reference note and try to reproduce it.
-   **Real-time Pitch Detection**: Uses your device's microphone to detect notes instantly.
-   **Instrument Support**: Optimized for Guitar and Piano, with configurable tunings for guitar.
-   **Virtual Instruments**: On-screen interactive guitar fretboard and piano keys for visual reference or touch input.
-   **Customizable**: Adjust difficulty (range, accidentals), key signatures, rhythm/metronome settings, and more.
-   **Zen Mode**: Distraction-free practice interface.

## Getting Started

### Prerequisites

-   Node.js (v18 or higher recommended)
-   npm

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/9x/sheetmusictrainer.git
    cd sheetmusictrainer
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Run the development server:
    ```bash
    npm run dev
    ```

4.  Open your browser and navigate to the local URL provided (usually `http://localhost:5173`).

## Technical Details

100% vibe coded using Google Antigravity and Gemini 3 pro.

This project is built with:
-   React + TypeScript
-   Vite
-   VexFlow (for music notation)
-   Pitchfinder (for audio detection)

For more details on the architecture, see [TECHNICAL_REALIZATION.md](./TECHNICAL_REALIZATION.md).

## License

MIT
