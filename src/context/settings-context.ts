import { createContext } from 'react';
import { type AppSettings } from '../types/SettingsTypes';

export interface SettingsContextType {
    settings: AppSettings;
    updateSettings: (newSettings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
    updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export const SettingsContext = createContext<SettingsContextType | undefined>(undefined);
