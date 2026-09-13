import React, { useCallback, useMemo, useState, type ReactNode } from 'react';
import { type AppSettings, DEFAULT_SETTINGS } from '../types/SettingsTypes';
import { SettingsContext, type SettingsContextType } from './settings-context';

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

    // Stable identities so consumers can safely use these in effect deps
    const updateSettings = useCallback<SettingsContextType['updateSettings']>((newSettings) => {
        setSettings(newSettings);
    }, []);

    const updateSetting = useCallback<SettingsContextType['updateSetting']>((key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    }, []);

    const value = useMemo<SettingsContextType>(
        () => ({ settings, updateSettings, updateSetting }),
        [settings, updateSettings, updateSetting]
    );

    return (
        <SettingsContext.Provider value={value}>
            {children}
        </SettingsContext.Provider>
    );
};
