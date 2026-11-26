import * as settings from './playpenPreferences';
import * as tabs from './tabs';
import * as index from '.';
import * as spaceFillers from './spaceFillers';
import { initTooltips } from './tooltips';

import { populateSVGs } from "./playpen";

let delayTimeout: any;

const versionLabel = document.getElementById('load-footer-version') as HTMLSpanElement;
const skipDelayBtn = document.getElementById('load-skipDelay') as HTMLButtonElement;

let isFinishing = false;
let initialization: Promise<void> | null = null;

export function init(): Promise<void> {
    if (!initialization) {
        initialization = initialize().catch(error => {
            initialization = null;
            throw error;
        });
    }
    return initialization;
}

async function initialize() {
    versionLabel!.innerText = `v${index.store.sessionVersion}` || "Failed to get session version";

    initTooltips();

    let loadMenuDelay: number = 750;

    // Load User Preferences
    try {
        await settings.init();
        loadMenuDelay = settings.preferences['loadMenuDelay'] ?? 750;
    } catch (err) {
        const message = err as string;
        console.warn(`Non-Critical Error: Failed to load user preferences: ${message}`);
    }

    // Replace SVG Placeholders with SVGs
    try {
        await populateSVGs();
    } catch {
        try {
            await populateSVGs();
        } catch (err) {
            const message = err as string;
            console.warn(`Non-Critical Error: Failed to replace icon placeholders: ${message}`);
        }
    }

    // Attempt to bind tab-navigation fix.
    try {
        document.addEventListener('keydown', (event: KeyboardEvent): void => {
            if (event.key !== 'Tab') return;

            const selector = 'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])';
            const focusables = Array.from(
                document.querySelectorAll<HTMLElement>(selector)
            ).filter((el: HTMLElement) => {
                const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0;
                const isNotDisabled = !el.hasAttribute('disabled');
                return isVisible && isNotDisabled;
            });

            if (focusables.length === 0) return;

            const firstEl = focusables[0];
            const lastEl = focusables[focusables.length - 1];
            const activeElement = document.activeElement as HTMLElement | null;

            if (event.shiftKey && activeElement === firstEl) {
                lastEl.focus();
                event.preventDefault();
            } else if (!event.shiftKey && activeElement === lastEl) {
                firstEl.focus();
                event.preventDefault();
            }
        });
    } catch (err) {
        const message = err as string;
        console.warn(`Non-Critical Error: Failed to load keyboard navigation fix: ${message}`);
    }

    // Initialize space filler shapes
    try {
        spaceFillers.init();
    } catch (err) {
        const message = err as string;
        console.warn(`Non-Critical Error: Failed to load space filler shapes: ${message}`);
    }

    // Apply hotkey fix
    try {
        window.addEventListener('keydown', async (event) => {
            if (!settings.preferences || !Boolean(settings.preferences['enableHotkeyFix'])) return;

            const key = event.key.toLowerCase();
            const devToolsCondition = key === 'f12' || (event.shiftKey && event.ctrlKey && key === 'i');
            const reloadCondition = (event.shiftKey && key === 'r') || key === 'f5';

            if (!devToolsCondition && !reloadCondition) return;

            if (devToolsCondition) {
                if (index.electroview?.rpc?.send?.toggleDevTools) {
                    event.preventDefault();
                    index.electroview.rpc.send.toggleDevTools();
                } else {
                    console.warn("DevTools RPC bridge not yet initialized.");
                }
            } else if (reloadCondition) {
                window.location.reload();
            }
        });
    } catch (err) {
        const error = err as string;
        console.warn(`Non-Critical Error: Failed to load the hotkey fix event listener: ${error}`);
    }

    window.dispatchEvent(new CustomEvent('storeLoaded'));
    console.log('Store has loaded');
    const timing = performance.getEntriesByType("navigation")[0];

    if (timing) {
        const navTiming = timing as PerformanceNavigationTiming;

        console.log("Total Page Load Time:", navTiming.loadEventEnd - navTiming.startTime, "ms");
        console.log("DOM Content Loaded Time:", navTiming.domContentLoadedEventEnd - navTiming.startTime, "ms");
        console.log("Time to First Byte (TTFB):", navTiming.responseStart - navTiming.startTime, "ms");
    }

    delayTimeout = setTimeout(finishLoading, loadMenuDelay);
    console.log(`Load Delay: ${loadMenuDelay}`);
    skipDelayBtn.classList.remove('hidden');
    skipDelayBtn.addEventListener('click', () => {
        clearTimeout(delayTimeout);
        finishLoading();
    });

    window.addEventListener('preferencesUpdate', index.updateDeveloperFunctionExposure);
    index.updateDeveloperFunctionExposure();
}

async function finishLoading() {
    if (isFinishing) return;
    isFinishing = true;
    console.log('(Load Delay has Ended)');

    // THIS IS TEMPORARILY SET TO 'workspace'. SET TO 'selectSpace' WHEN DONE
    // DEVELOPING THE WORKSPACE MENU
    tabs.goto('workspace', { logPrevious: false, removePrevious: true });
}