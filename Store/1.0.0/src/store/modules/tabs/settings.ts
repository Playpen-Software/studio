import { showNotification, showPopup } from '../notifications';
import { electroview } from '../index';
import { resetThemeSettings } from '../themeEditor';
import { resetPreferences } from '../playpenPreferences';

let tabInitialized = false;

async function resetInventory(): Promise<void> {
    try {
        if (!electroview.rpc?.request.resetInventory) throw new Error('The inventory reset service is unavailable.');
        await electroview.rpc.request.resetInventory();
        showNotification('The connected database inventory has been reset.');
    } catch (error) {
        console.error('Failed to reset the connected database inventory:', error);
        showNotification('Failed to reset the connected database inventory.', 'error');
    }
}

async function resetAllAppData(): Promise<void> {
    try {
        if (!electroview.rpc?.request.resetAppData) throw new Error('The app-data reset service is unavailable.');
        await electroview.rpc.request.resetAppData();
        window.location.reload();
    } catch (error) {
        console.error('Failed to reset application data:', error);
        showNotification('Failed to reset application data.', 'error');
    }
}

function init(): void {
    if (tabInitialized) return;
    const resetBtn = document.getElementById('settings-reset') as HTMLButtonElement;
    resetBtn.addEventListener('click', () => {
        void chooseResetAction().catch(error => {
            console.error('Failed to complete settings reset:', error);
            showNotification('The selected reset could not be completed.', 'error');
        });
    });
    tabInitialized = true;
}

async function chooseResetAction(): Promise<void> {
    const option = await showPopup(
        'Choose something to reset',
        'Choose something to reset below.',
        'options',
        [
            { content: 'Everything', value: 'all' },
            { content: 'Preferences', value: 'preferences' },
            { content: 'Theme', value: 'theme' },
            { content: 'Local Inventory', value: 'inventory' },
            { content: 'Cancel', value: undefined, highlighted: true }
        ]
    );
    if (!option || option === 'cancel') return;

    const confirmation = await showPopup(
        'Confirm Reset',
        option === 'all'
            ? 'Are you sure you want to reset ALL app data? This cannot be undone.'
            : option === 'preferences'
                ? 'Are you sure you want to reset all settings? This cannot be undone.'
                : option === 'theme'
                    ? 'Are you sure you want to reset all theme settings? This cannot be undone. <br><br><span class="playpen-disclaimer">Note: You can export your themes as a file for sharing and later use.</span>'
                    : 'Are you sure you want to reset your inventory? This cannot be undone. <br><br><span class="playpen-disclaimer">Note: This only applies to your local inventory. Remote database inventory systems have to be reset from the Store Remote dashboard.</span>',
        'options',
        [
            { content: 'Cancel', value: false, highlighted: true },
            { content: 'Reset', value: true }
        ],
        undefined,
        true
    );
    if (!confirmation) return;

    switch (option) {
        case 'all': await resetAllAppData(); break;
        case 'preferences': await resetPreferences(); break;
        case 'theme': await resetThemeSettings(); break;
        case 'inventory': await resetInventory(); break;
    }
}

window.addEventListener('storeLoaded', init);