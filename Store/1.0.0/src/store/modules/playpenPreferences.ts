import { electroview } from '.';
import { init as initPlaypenLib } from './playpen';

const defaultPreferences: Record<string, unknown> = {};

export interface preferenceUpdateEventDetail {
    preference: string;
}

let currentPreferences: Record<string, unknown> = { ...defaultPreferences };
export let preferences: Readonly<Record<string, any>> = Object.freeze({ ...currentPreferences });

let pendingDeltaQueue: Record<string, unknown>[] = [];
let isWriting = false;
let settingsInputsInitialized = false;

export async function init(): Promise<void> {
    validatePreferenceInputs();
    const saved = await electroview.rpc?.request.getPreferences();
    currentPreferences = { ...defaultPreferences, ...saved };
    publishPreferences();

    initSettingsInputs();
    initPlaypenLib();
}

export function registerPreferenceDefaults(defaults: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(defaults)) {
        if (key in defaultPreferences && !Object.is(defaultPreferences[key], value)) {
            throw new Error(`Preference "${key}" has conflicting default values.`);
        }
        defaultPreferences[key] = value;
    }
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
    currentPreferences = { ...currentPreferences, ...updates };
    publishPreferences();
    Object.keys(updates).forEach(notifyPreferencesUpdate);

    pendingDeltaQueue.push(updates);

    await processQueue();
}

async function processQueue(): Promise<void> {
    if (isWriting || pendingDeltaQueue.length === 0) return;

    isWriting = true;

    try {
        while (pendingDeltaQueue.length > 0) {
            const batchUpdates = Object.assign({}, ...pendingDeltaQueue);
            pendingDeltaQueue = [];

            currentPreferences = { ...currentPreferences, ...batchUpdates };
            const snapshot = { ...currentPreferences };

            const saved = await electroview.rpc?.request.setPreferences(snapshot);
            if (saved !== true) {
                throw new Error(`Failed to save preferences batch.`);
            }
        }
    } catch (error) {
        console.error("Preference queue write error:", error);
    } finally {
        isWriting = false;
        if (pendingDeltaQueue.length > 0) {
            void processQueue();
        }
    }
}

function publishPreferences(): void {
    preferences = Object.freeze({ ...currentPreferences });
}

function validatePreferenceInputs(): void {
    for (const input of document.querySelectorAll<HTMLInputElement>('input[data-preferences-key]')) {
        const key = input.dataset['preferencesKey'];
        if (!key) throw new Error('A preference input is missing its data-preferences-key.');
        if (!(key in defaultPreferences)) {
            throw new Error(`Preference input "${key}" has no registered default value.`);
        }
    }
}

function initSettingsInputs(): void {
    if (settingsInputsInitialized) return;

    document.querySelectorAll<HTMLInputElement>('input[data-preferences-key]').forEach(input => {
        const key = input.dataset['preferencesKey'];
        if (!key) return;
        syncPreferenceInput(input, key);

        const saveInputPreference = () => {
            let value: unknown = input.type === 'checkbox'
                ? input.checked
                : input.type === 'number' ? input.valueAsNumber : input.value;
            if (typeof value === 'number' && Number.isNaN(value)) return;

            void setPreference(key, value).catch(error => {
                console.error(`Failed to save preference ${key}:`, error);
            });
        };

        input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', saveInputPreference);
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
    pendingDeltaQueue = [];

    const snapshot = { ...defaultPreferences };
    const saved = await electroview.rpc?.request.setPreferences(snapshot);
    if (saved !== true) {
        throw new Error('Failed to reset preferences.');
    }

    currentPreferences = snapshot;
    publishPreferences();
    Object.keys(defaultPreferences).forEach(notifyPreferencesUpdate);
    document.querySelectorAll<HTMLInputElement>('input[data-preferences-key]').forEach(input => {
        const key = input.dataset['preferencesKey'];
        if (key) syncPreferenceInput(input, key);
    });
    initPlaypenLib();
}

function notifyPreferencesUpdate(preference: string): void {
    window.dispatchEvent(new CustomEvent('preferencesUpdate', { detail: { preference } }));
}