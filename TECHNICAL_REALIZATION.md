# Technical Realization

## Architecture Overview

The **Sheet Music Trainer** is a client-side Single Page Application (SPA) built with **React** and **TypeScript**, powered by **Vite**. It is designed to run entirely in the browser without a backend server, allowing for low-latency audio processing and interactivity.

### Key Architectural Choices

1.  **Component-Based UI**:
    - The application is structured into reusable components (e.g., `SheetMusic`, `Fretboard`, `PianoKeys`, `Controls`) to maintain separation of concerns.
    - State management is primarily handled via React's `useState` and `useReducer` at the `App` component level, with props drilling for simpler hierarchies.

2.  **Audio Processing**:
    - **Pitch Detection**: Utilizes the `pitchfinder` library (YIN algorithm) to detect pitch from the user's microphone in real-time. This processing happens in a dedicated hook/worker to keep the main thread responsive.
    - **Audio Synthesis**: Uses standard Web Audio API for generating simple tones (sine/triangle waves) for playback and feedback.

3.  **Music Rendering**:
    - **VexFlow**: The standard library for rendering music notation on the web. It is used in the `SheetMusic` component to draw the staff, notes, clefs, and key signatures dynamically based on the current state.

4.  **Responsiveness**:
    - The application uses CSS variables and media queries to adapt to different screen sizes, with specific optimizations for mobile landscape mode to support instrument practice on tablets and phones.

## Frameworks and Libraries

### Core
*   **[React](https://react.dev/)**: The library for web and native user interfaces.
*   **[TypeScript](https://www.typescriptlang.org/)**: Strongly typed JavaScript for safer development.
*   **[Vite](https://vitejs.dev/)**: Next Generation Frontend Tooling for fast development and building.

### Audio & Music
*   **[VexFlow](https://www.vexflow.com/)**: A JavaScript library for rendering music notation and guitar tablature.
*   **[Pitchfinder](https://github.com/peterkhayes/pitchfinder)**: A collection of pitch detection algorithms for Javascript. used for detecting the note played by the user.

### UI & Icons
*   **[Lucide React](https://lucide.dev/)**: A clean and consistent icon library for the interface.

## Directory Structure

```
src/
├── components/       # Reusable UI components (SheetMusic, Fretboard, etc.)
├── hooks/            # Custom React hooks (usePitchDetector, useAudioPlayer, etc.)
├── music/            # Music logic, tuning definitions, and note utilities
├── styles/           # Global styles and component-specific CSS
├── assets/           # Static assets
├── App.tsx           # Main application logic and layout
└── main.tsx          # Entry point
```
