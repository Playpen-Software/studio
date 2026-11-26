import { preferences, registerPreferenceDefaults, type preferenceUpdateEventDetail } from './playpenPreferences';
import { applyThemeSettings } from './themeEditor';

registerPreferenceDefaults({
    loadMenuDelay: 750,
    enableDeveloperFeatures: false,
    enableHotkeyFix: false,
    spaceFillersEnabled: true,
    updateSpaceFillersOnTabChange: true,
    spaceFillerAnimations: true,
    useSpaceFillerBlur: true,
    transitionAnimations: true,
    spaceFillersDisabledTabs: []
});

function applyStoreSettings(): void {
    applyThemeSettings();
    if (!preferences['transitionAnimations']) {
        document.documentElement.style.setProperty('--transition-speed', '0s');
    }
}

window.addEventListener('storeLoaded', applyStoreSettings);
window.addEventListener('preferencesUpdate', (event) => {
    const { preference } = (event as CustomEvent<preferenceUpdateEventDetail>).detail;
    if (preference === 'transitionAnimations' || preference === 'themeVariables' || preference === 'enableDarkThemeSupport') {
        applyStoreSettings();
    }
});