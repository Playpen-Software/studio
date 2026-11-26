//@ts-expect-error @electronbun/view doesn't supply a data type.
import { Electroview } from "electrobun/view";
import { type StoreRPCType } from '../../types/store-rpc-types';

import { waitForLoad } from "./playpen";

import * as load from './load';

// Import all modules that listen for events and aren't imported elsewhere, so electrobun can package them, and all top-level code is ran.
import './tabs/createSpace';
import './tabs/selectSpace';
import './tabs/settings';
import './tabs/workspace';

import './themeEditor';

// Import CSS files
import '../sheets/index.css';
import '../sheets/notifications.css';
import '../sheets/playpen.css';
import '../sheets/spaceFillers.css';
import '../sheets/tabs.css';
import '../sheets/tooltips.css';

import '../sheets/tabs/createSpace.css';
import '../sheets/tabs/load.css';
import '../sheets/tabs/selectSpace.css';
import '../sheets/tabs/settings.css';
import '../sheets/tabs/workspace.css';

const rpc = Electroview.defineRPC<StoreRPCType>({
    handlers: {
        requests: {},
        messages: {},
    }
});
export const electroview = new Electroview({ rpc });

export const store = {
    "sessionVersion": "1.0.0"
}

import * as tabs from './tabs';
import { preferences } from "./playpenPreferences";

export function updateDeveloperFunctionExposure() {
    const functions = {
        "gotoTab": tabs.goto,
        "showTab": tabs.show,
        "hideTab": tabs.hide,
        "navigateToTabFromURL": tabs.navigateFromURLParams,
        "forceCriticalError": criticalError
    };

    const context = window as any;
    const enableFeatures = Boolean(preferences['enableDeveloperFeatures']);

    Object.entries(functions).forEach(([key, fn]) => {
        context[key] = enableFeatures ? fn : undefined;
    });
}

export function criticalError(message = "An unexpected error occured."): void {
    const messageEl = document.getElementById('criticalError-message') as HTMLElement;

    try {
        tabs.goto('criticalError', { instant: true });
        if (messageEl) {
            messageEl.innerText = message;
        } else {
            console.error(`Critical Error: ${message}`);
        }
    } catch (err) {
        const errorMessage = err as string;
        console.error(`Failed to show critical error as styled tab: ${errorMessage}`);
        console.error(`Critical Error: ${message}`);

        tabs.hideAllTabs({ instant: true });
        const headerElement = document.createElement('h1');
        headerElement.innerText = "Store encountered a critical error";

        const fallbackMessageEl = document.createElement('code');
        fallbackMessageEl.innerText = message;

        const noteEl = document.createElement('span');
        noteEl.className = "playpen-disclaimer";
        noteEl.innerText = "You can check your console for more details."

        document.body.append(headerElement, fallbackMessageEl, noteEl);
    }
}

async function init() {
    await waitForLoad();
    load.init();
}

init();