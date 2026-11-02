import { electroview } from './index';
import { init as initPlaypenLib } from './playpen';
import { applyThemeSettings, init as initThemeEditor } from './themeEditor';

const defaultPreferences: Record<string, unknown> = { themeVariables: {} };

let currentPreferences: Record<string, unknown> = { ...defaultPreferences };
export let preferences: Readonly<Record<string, any>> = Object.freeze({ ...currentPreferences });
let preferenceWrite: Promise<void> = Promise.resolve();
let settingsInputsInitialized = false;

export async function init(): Promise<void> {
    registerInputPreferences();
    const saved = await electroview.rpc?.request.getPreferences();
    currentPreferences = { ...defaultPreferences, ...saved };
    publishPreferences();

    initSettingsInputs();
    applySettings();
    initThemeEditor();
    initPlaypenLib();
}

export function getPreference(key: string): unknown;
export function getPreference<T>(key: string, fallback: T): T;
export function getPreference<T>(key: string, fallback?: T): unknown | T {
    const value = currentPreferences[key];
    return value === undefined ? fallback : value;
}

export async function setPreference(key: string, value: unknown): Promise<void> {
    await setPreferences({ [key]: value });
}

export async function setPreferences(updates: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(updates)) {
        if (!(key in currentPreferences)) throw new Error(`Unknown preference: ${key}`);
        const existing = currentPreferences[key];
        if (value !== undefined && typeof value !== typeof existing) {
            throw new Error(`Preference "${key}" must be a ${typeof existing}.`);
        }
    }

    currentPreferences = { ...currentPreferences, ...updates };
    publishPreferences();
    applySettings();
    Object.keys(updates).forEach(notifyPreferencesUpdate);

    const snapshot = { ...currentPreferences };
    const write = preferenceWrite.then(async () => {
        const saved = await electroview.rpc?.request.setPreferences(snapshot);
        if (saved !== true) throw new Error(`Failed to save preferences: ${Object.keys(updates).join(', ')}.`);
    });
    preferenceWrite = write.catch(() => undefined);
    await write;
}

function publishPreferences(): void {
    preferences = Object.freeze({ ...currentPreferences });
}

function registerInputPreferences(): void {
    for (const input of document.querySelectorAll<HTMLInputElement>('input[data-preferences-key]')) {
        const key = input.dataset['preferencesKey'];
        const rawDefault = input.dataset['preferenceDefault'];
        if (!key) throw new Error('A preference input is missing its data-preferences-key.');
        if (rawDefault === undefined) {
            throw new Error(`Preference input "${key}" is missing data-preference-default.`);
        }

        const value = parseDefaultValue(input, key, rawDefault);
        if (key in defaultPreferences && !Object.is(defaultPreferences[key], value)) {
            throw new Error(`Preference "${key}" has conflicting default values.`);
        }
        defaultPreferences[key] = value;
    }
}

function parseDefaultValue(input: HTMLInputElement, key: string, value: string): unknown {
    if (input.type === 'checkbox') {
        if (value !== 'true' && value !== 'false') {
            throw new Error(`The default value for checkbox preference "${key}" must be "true" or "false".`);
        }
        return value === 'true';
    }

    if (input.type === 'number' || input.type === 'range') {
        if (value.trim() === '') {
            throw new Error(`The default value for numeric preference "${key}" cannot be empty.`);
        }
        const number = Number(value);
        if (!Number.isFinite(number)) {
            throw new Error(`The default value for numeric preference "${key}" must be a finite number.`);
        }
        return number;
    }

    return value;
}

function initSettingsInputs(): void {
    if (settingsInputsInitialized) return;

    document.querySelectorAll<HTMLInputElement>('input[data-preferences-key]').forEach(input => {
        const key = input.dataset['preferencesKey'];
        if (!key) return;
        syncPreferenceInput(input, key);

        input.addEventListener('change', () => {
            let value: unknown = input.type === 'checkbox'
                ? input.checked
                : input.type === 'number' ? input.valueAsNumber : input.value;
            if (typeof value === 'number' && Number.isNaN(value)) value = currentPreferences[key];
            void setPreference(key, value).catch(error => {
                console.error(`Failed to save preference ${key}:`, error);
            });
        });
    });

    window.addEventListener('preferencesUpdate', event => {
        const preference = (event as CustomEvent<{ preference: string }>).detail?.preference;
        if (!preference) return;
        document.querySelectorAll<HTMLInputElement>('input[data-preferences-key]')
            .forEach(input => {
                if (input.dataset['preferencesKey'] === preference) syncPreferenceInput(input, preference);
            });
    });
    settingsInputsInitialized = true;
}

function syncPreferenceInput(input: HTMLInputElement, key: string): void {
    const value = currentPreferences[key];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (input.type === 'number') input.valueAsNumber = Number(value);
    else input.value = String(value ?? '');
}

export async function resetPreferences(): Promise<void> {
    const snapshot = { ...defaultPreferences };
    const write = preferenceWrite.then(async () => {
        if (await electroview.rpc?.request.setPreferences(snapshot) !== true) {
            throw new Error('Failed to reset preferences.');
        }
        currentPreferences = snapshot;
        publishPreferences();
        applySettings();
        Object.keys(defaultPreferences).forEach(notifyPreferencesUpdate);
        document.querySelectorAll<HTMLInputElement>('input[data-preferences-key]').forEach(input => {
            const key = input.dataset['preferencesKey'];
            if (key) syncPreferenceInput(input, key);
        });
    });
    preferenceWrite = write.catch(() => undefined);
    await write;
    initPlaypenLib();
}

function applySettings(): void {
    applyThemeSettings();
    const style = document.documentElement.style;
    if (!preferences['transitionAnimations']) style.setProperty('--transition-speed', '0s');
}

function notifyPreferencesUpdate(preference: string): void {
    window.dispatchEvent(new CustomEvent('preferencesUpdate', { detail: { preference } }));
}