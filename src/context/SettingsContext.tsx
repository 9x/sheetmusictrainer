import React, { createContext, useContext, useState, type ReactNode } from 'react';
import { type AppSettings, DEFAULT_SETTINGS } from '../types/SettingsTypes';

interface SettingsContextType {
    settings: AppSettings;
    updateSettings: (newSettings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

    const updateSettings = (newSettings: AppSettings | ((prev: AppSettings) => AppSettings)) => {
        setSettings(newSettings);
    };

    const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, updateSetting }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};
