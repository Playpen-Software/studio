import * as settings from './playpenPreferences';
import * as tabs from './tabs';
import * as index from './index';
import * as spaceFillers from './spaceFillers';
import * as notifications from './notifications';
import { initTooltips } from './tooltips';

import { populateSVGs } from "./playpen";

let delayTimeout: any;

const versionLabel = document.getElementById('load-footer-version') as HTMLSpanElement;
const exitBtn = document.getElementById('load-exit') as HTMLButtonElement;
const restartBtn = document.getElementById('load-restart') as HTMLButtonElement;
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
        notifications.showNotification(`Non-Critical Error: Failed to load user preferences: ${message}`, 'warning');
    }

    // Replace SVG Placeholders with SVGs
    try {
        await populateSVGs();
    } catch {
        try {
            await populateSVGs();
        } catch (err) {
            const message = err as string;
            notifications?.showNotification(`Non-Critical Error: Failed to replace icon placeholders: ${message}`, 'warning');
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
        notifications?.showNotification(`Non-Critical Error: Failed to load keyboard navigation fix: ${message}`, 'warning');
    }

    // Initialize space filler shapes
    try {
        spaceFillers.init();
    } catch (err) {
        const message = err as string;
        notifications?.showNotification(`Non-Critical Error: Failed to load space filler shapes: ${message}`, 'warning');
    }

    window.dispatchEvent(new CustomEvent('storeLoaded'));
    console.log('Store has loaded');
    delayTimeout = setTimeout(finishLoading, loadMenuDelay);
    console.log(`Load Delay: ${loadMenuDelay}`);
    skipDelayBtn.classList.remove('hidden');
    skipDelayBtn.addEventListener('click', () => {
        clearTimeout(delayTimeout);
        finishLoading();
    });
}

async function finishLoading() {
    if (isFinishing) return;
    isFinishing = true;
    console.log('(Load Delay has Ended)');

    // THIS IS TEMPORARILY SET TO 'workspace'. SET TO 'selectSpace' WHEN DONE
    // DEVELOPING THE WORKSPACE MENU
    tabs.goto('workspace', { logPrevious: false, removePrevious: true });
}

window.addEventListener('DOMContentLoaded', () => {
    exitBtn?.addEventListener('click', index.exit);
    restartBtn.addEventListener('click', index.restart);
});