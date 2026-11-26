const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let skippedVersion = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: path.join(__dirname, 'favicon.png'),
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true
        }
    });

    mainWindow.loadFile('index.html');

    // Check for updates when the window is ready
    mainWindow.once('ready-to-show', () => {
        checkForUpdates();
    });
}

// Close app when all windows are closed (Windows/Linux)
app.on('window-all-closed', () => {
    app.quit();
});

app.whenReady().then(createWindow);

function checkForUpdates() {
    autoUpdater.autoDownload = false; // don't auto-download

    // Update is available
    autoUpdater.on('update-available', async (info) => {
        if (skippedVersion === info.version) return; // user skipped this version

        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: `Version ${info.version} is available. Do you want to download and install it now?`,
            buttons: ['Yes', 'No', 'Skip this version']
        });

        if (response === 0) { // Yes
            autoUpdater.downloadUpdate();
        } else if (response === 2) { // Skip
            skippedVersion = info.version;
        }
    });

    // Update downloaded and ready to install
    autoUpdater.on('update-downloaded', async () => {
        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Ready',
            message: 'Update downloaded. Install and restart now?',
            buttons: ['Yes', 'Later']
        });

        if (response === 0) {
            autoUpdater.quitAndInstall(); // replaces old version
        }
    });

    // Check for updates
    autoUpdater.checkForUpdates();
}