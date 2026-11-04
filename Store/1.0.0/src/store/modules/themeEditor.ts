import { populateSVGs } from './playpen';
import { showNotification, showPopup } from './notifications';
import { preferences, setPreferences, type preferenceUpdateEventDetail } from './playpenPreferences';
import { getActiveTab, type tabChangeEventDetail } from './tabs';

type ThemeValue = string | number;
type ThemeVariable = {
    name: string;
    property: string;
    description: string;
    type: 'color' | 'range' | 'select';
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    options?: string[];
};

const themeVariables: ThemeVariable[] = [
    { name: 'Accent Color', property: '--brand-primary', description: 'The main accent color used for primary buttons and highlights.', type: 'color' },
    { name: 'Primary Background', property: '--background-base', description: 'The main app background color.', type: 'color' },
    { name: 'Background Color Contrast', property: '--background-color-step-amount', description: 'How much darker backgrounds are than the ones they are stacked on top of. Increase this setting to increase contrast.', type: 'range', step: 0.1, min: 0, max: 20, unit: '%' },
    { name: 'Primary Text', property: '--text-primary', description: 'The main text color used throughout the app.', type: 'color' },
    { name: 'Light Text', property: '--text-tertiary', description: 'Text shown on colored or dark backgrounds.', type: 'color' },
    { name: 'Corner Radius', property: '--radius', description: 'How round corners are on things like buttons and menus.', type: 'range', min: 0, max: 24, step: 0.25, unit: 'px' },
    { name: 'Resting Area Padding', property: '--resting-area-padding', description: 'How much space there is around the inside of panels and other menus.', type: 'range', step: 0.1, min: 0, max: 24, unit: 'px' },
    { name: 'Element Gap', property: '--gap', description: 'The space between elements in lists, both left-right and top-bottom.', type: 'range', step: 0.1, min: 0, max: 24, unit: 'px' },
    { name: 'Clickable Area Vertical Padding', property: '--clickable-area-padding-y', description: 'How much space there is between the text and the top and bottom of buttons and other clickable elements.', type: 'range', min: 0, max: 2, step: 0.04, unit: 'rem' },
    { name: 'Clickable Area Horizontal Padding', property: '--clickable-area-padding-x', description: 'How much space there is between the text and the left and right of buttons and other clickable elements.', type: 'range', min: 0, max: 3, step: 0.05, unit: 'rem' },
    { name: 'Outline Thickness', property: '--outline-width', description: 'How thick the line around an item is when said item is clicked or focused on with the TAB key.', type: 'range', min: 1.5, max: 10, step: 0.5, unit: 'px' },
    { name: 'Outline Color', property: '--outline-color', description: 'The color of the line around an item is when said item is clicked or focused on with the TAB key.', type: 'color' },
    { name: 'Transition Speed', property: '--transition-speed', description: 'How long transition animations like fading and switching tabs take.', type: 'range', min: 0.2, max: 10, step: 0.05, unit: 's' },
    { name: 'Transition Easing Style', property: '--transition-easing-style', description: 'The easing style for transition animations', type: 'select', options: ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] }
];

let initialized = false;
let container: HTMLElement | null = null;

export function init(): void {
    if (initialized) return;
    container = document.getElementById('playpen-themeEditor');
    if (!container) return;

    container.addEventListener('click', event => {
        const button = (event.target as Element).closest<HTMLButtonElement>('[data-theme-action]');
        if (!button || !container?.contains(button)) return;
        const card = button.closest<HTMLElement>('[data-theme-property]');
        const variable = themeVariables.find(item => item.property === card?.dataset['themeProperty']);
        if (!variable) return;
        const action = button.dataset['themeAction'];

        const task = action === 'edit'
        ? editThemeVariable(variable)
        : action === 'copy'
        ? copyThemeVariable(variable)
        : action === 'reset'
        ? resetThemeVariable(variable.property)
        : Promise.resolve();
        void task.catch(showThemeError);
    });

    initialized = true;
    renderThemeEditor();
    applyThemeSettings();
}

export function applyThemeSettings(): void {
    const style = document.documentElement.style;
    const overrides = getThemeVariables();
    for (const variable of themeVariables) {
        const value = overrides[variable.property];
        if (value === undefined) style.removeProperty(variable.property);
        else style.setProperty(variable.property, cssValue(variable, value));
    }

    const root = getComputedStyle(document.documentElement);
    const inversedBackgroundStack = root.getPropertyValue('--background-stack-inverse');
    const inversedInsetShadow = root.getPropertyValue('--inset-shadow-inverse');
    const inversedOutsetShadow = root.getPropertyValue('--outset-shadow-inverse');

    if (preferences['enableDarkThemeSupport']) {
        style.setProperty('--background-stack', inversedBackgroundStack);
        style.setProperty('--inset-shadow', inversedInsetShadow)
        style.setProperty('--outset-shadow', inversedOutsetShadow);
    } else {
        style.removeProperty('--background-stack');
        style.removeProperty('--inset-shadow');
        style.removeProperty('--outset-shadow');
    }
}

export async function updateDarkThemeSupport(): Promise<void> {
    const currentOverrides = getThemeVariables();
    const backgroundVariable = themeVariables.find(variable => variable.property === '--background-base');
    const textVariable = themeVariables.find(variable => variable.property === '--text-primary');
    if (!backgroundVariable || !textVariable) return;

    const background = String(getCurrentThemeValue(backgroundVariable));
    const text = String(getCurrentThemeValue(textVariable));

    const isDark = Boolean(preferences['enableDarkThemeSupport']);

    if (isLightColor(background) === isDark) {
        currentOverrides['--background-base'] = invertLightnessHex(background);
    }

    if (isLightColor(text) === !isDark) {
        currentOverrides['--text-primary'] = invertLightnessHex(text);
    }

    await setPreferences({ themeVariables: currentOverrides });
    updateThemePreviews();
}

function isLightColor(hex: string): boolean {
    const rgb = hexToRgb(hex);
    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    return brightness >= 128;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        hex = hex.split('').map(char => char + char).join('');
    }
    const num = parseInt(hex, 16);
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
    };
}

function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (c: number) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    h /= 360; s /= 100; l /= 100;
    let r: number, g: number, b: number;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return { r: r * 255, g: g * 255, b: b * 255 };
}

function invertLightnessHex(hex: string): string {
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

    hsl.l = 100 - hsl.l;

    const newRgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(newRgb.r, newRgb.g, newRgb.b);
}

export { applyThemeSettings as applyThemeVariables };

export function getThemeVariables(): Record<string, ThemeValue> {
    const value = preferences['themeVariables'];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

    const record = value as Record<string, unknown>;
    return Object.fromEntries(themeVariables.flatMap(variable => {
        const candidate = record[variable.property];
        return isValidThemeValue(variable, candidate) ? [[variable.property, candidate]] : [];
    }));
}

export async function setThemeVariables(updates: Record<string, unknown>): Promise<void> {
    const validatedUpdates: Record<string, ThemeValue> = {};
    for (const [property, value] of Object.entries(updates)) {
        const variable = themeVariables.find(item => item.property === property);
        if (!variable || !isValidThemeValue(variable, value)) {
            throw new Error(`Invalid theme variable value for "${property}".`);
        }
        validatedUpdates[property] = value;
    }

    await setPreferences({ themeVariables: { ...getThemeVariables(), ...validatedUpdates } });
}

export async function resetThemeVariables(): Promise<void> {
    await setPreferences({ themeVariables: {} });
}

export async function resetThemeSettings(): Promise<void> {
    await setPreferences({ themeVariables: {}, enableDarkThemeSupport: false });
}

function renderThemeEditor(): void {
    if (!container?.isConnected) {
        container = document.getElementById('playpen-themeEditor');
    }
    if (!container) return;
    container.replaceChildren(...themeVariables.map(createThemeCard));
    populateSVGs();
}

function createThemeCard(variable: ThemeVariable): HTMLElement {
    const card = document.createElement('div');
    card.className = 'playpen-image-content-card';
    card.dataset['themeProperty'] = variable.property;

    const preview = document.createElement('div');
    preview.className = 'playpen-theme-preview image center standalone';
    preview.setAttribute('aria-label', `${variable.name} preview`);
    preview.setAttribute('data-preview-variable', JSON.stringify(variable));
    preview.appendChild(document.createElement('span'));
    updateThemePreview(preview, variable);

    const details = document.createElement('div');
    details.className = 'details-container';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = variable.name;
    const description = document.createElement('p');
    description.textContent = variable.description;
    details.append(title, document.createElement('hr'), description);

    const header = document.createElement('div');
    header.className = 'header-container';
    header.append(preview, details);

    const actions = document.createElement('div');
    actions.className = 'link-container';
    actions.append(
        createActionButton('Edit', 'edit', variable.name),
        createActionButton('Copy', 'copy', variable.name),
        createActionButton('Reset', 'reset', variable.name)
    );

    const primary = document.createElement('div');
    primary.className = 'primary-container';
    primary.append(header, actions);
    card.appendChild(primary);
    return card;
}

function createActionButton(label: string, action: string, name: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'playpen-primary-button';
    button.dataset['themeAction'] = action;
    button.setAttribute('aria-label', `${label} ${name}`);

    const icon = document.createElement('svgPlaceholder');
    icon.textContent = `assets/svg/settings/${action}.svg`;
    button.append(icon, document.createTextNode(label));
    return button;
}

async function editThemeVariable(variable: ThemeVariable): Promise<void> {
    const value = getCurrentThemeValue(variable);
    const options = variable.type === 'select'
    ? variable.options!.map(option => ({
        content: option.replaceAll('-', ' ').replace(/\b\w/g, character => character.toUpperCase()),
        value: option
    }))
    : undefined;
    const inputProps = variable.type === 'range'
    ? { value: value as number, min: variable.min, max: variable.max, step: variable.step ?? 'any' }
    : { value };
    const updated = await showPopup<ThemeValue>(
        `Edit ${variable.name}`,
        variable.description,
        variable.type === 'select' ? 'radio' : variable.type,
        options,
        inputProps
    );
    if (updated === undefined) return;
    await setThemeVariables({ [variable.property]: variable.type === 'range' ? Number(updated) : updated });
}

async function copyThemeVariable(variable: ThemeVariable): Promise<void> {
    await navigator.clipboard.writeText(formatThemeValue(variable, getCurrentThemeValue(variable)));
}

async function resetThemeVariable(property: string): Promise<void> {
    const variables = getThemeVariables();
    delete variables[property];
    await setPreferences({ themeVariables: variables });
}

export function updateThemePreviews() {
    const previews = document.querySelectorAll('.playpen-theme-preview');
    previews.forEach(function (preview) {
        const previewEl = preview as HTMLElement;
        const variableAttribute = previewEl.getAttribute('data-preview-variable');
        if (variableAttribute) {
            const variable = JSON.parse(variableAttribute);
            updateThemePreview(previewEl, variable);
        }
    });
}

function updateThemePreview(preview: HTMLElement, variable: ThemeVariable): void {
    const value = getCurrentThemeValue(variable);
    const css = cssValue(variable, value);
    preview.style.setProperty(variable.property, css);

    switch (variable.property) {
        case '--brand-primary':
        case '--background-base': preview.style.backgroundColor = String(value); break;
        case '--text-primary':
        preview.style.backgroundColor = 'var(--background-base)';
        preview.style.color = String(value);
        break;
        case '--text-tertiary':
        preview.style.backgroundColor = 'var(--brand-primary)';
        preview.style.color = String(value);
        break;
        case '--outline-color': preview.style.border = `4px solid ${String(value)}`; break;
        case '--radius': preview.style.borderRadius = css; break;
        case '--outline-width': preview.style.outline = `${css} solid var(--outline-color)`; break;
        case '--transition-speed': preview.style.transition = `all ${css} var(--transition-easing-style)`; break;
        case '--transition-easing-style': preview.style.transition = `all var(--transition-speed) ${String(value)}`; break;
    }

    preview.querySelector('span')!.textContent = formatThemeValue(variable, value);
}

function getCurrentThemeValue(variable: ThemeVariable): ThemeValue {
    const override = getThemeVariables()[variable.property];
    if (override !== undefined) return override;

    const value = getComputedStyle(document.documentElement).getPropertyValue(variable.property).trim();
    if (variable.type === 'range') {
        const number = Number.parseFloat(value);
        if (Number.isFinite(number)) return number;
    } else if (value) {
        return value;
    }
    throw new Error(`CSS variable "${variable.property}" has no valid default value.`);
}

function isValidThemeValue(variable: ThemeVariable, value: unknown): value is ThemeValue {
    if (variable.type === 'color') return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
    if (variable.type === 'select') return typeof value === 'string' && variable.options?.includes(value) === true;
    return typeof value === 'number' && Number.isFinite(value) &&
    variable.min !== undefined && variable.max !== undefined &&
    value >= variable.min && value <= variable.max;
}

function cssValue(variable: ThemeVariable, value: ThemeValue): string {
    return variable.type === 'range' ? `${value}${variable.unit ?? ''}` : String(value);
}

function formatThemeValue(variable: ThemeVariable, value: ThemeValue): string {
    return variable.type === 'range' ? `${value}${variable.unit ?? ''}` : String(value);
}

function showThemeError(error: unknown): void {
    console.error('Theme setting action failed:', error);
    showNotification('The theme setting could not be changed.', 'error');
}

window.addEventListener('storeLoaded', init);
window.addEventListener('preferencesUpdate', (event) => {
    if (getActiveTab() !== 'settings_theme') return;
    applyThemeSettings();
    const eventDetails = event as CustomEvent<preferenceUpdateEventDetail>;
    const { preference } = eventDetails.detail;
    if (preference == 'enableDarkThemeSupport') updateDarkThemeSupport();
});
window.addEventListener('tabChange', (event) => {
    const eventDetails = event as CustomEvent<tabChangeEventDetail>;
    const { tabId } = eventDetails.detail;
    if (tabId === 'settings_theme') {
        renderThemeEditor();
    }
});