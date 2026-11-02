// @ts-expect-error Electrobun's SDK modules are provided by the build toolchain.
import { Electroview } from "electrobun/view";
import { type UpdaterRPCType } from "../../types/updater-rpc-types";

// Import CSS
import '../sheets/index.css';
import '../sheets/playpen.css';
import '../sheets/tabs.css';

const rpc = Electroview.defineRPC<UpdaterRPCType>({
    handlers: {
        requests: {},
        messages: {
            displayDebug({ message, type }: { message: string; type?: string }) {
                console.log(`RPC Message Recieved: ${message}, ${type}`);
                displayDebug(message, type);
            }
        },
    }
});
let electroview: Electroview<typeof rpc>;

function wait(ms: number) {return new Promise((resolve) => { setTimeout(resolve, ms)})}

async function displayDebug(message: string, type = '') {
    console.log(`Display Debug Function Recieved: ${message}, ${type}`);
    const outputElement = document.getElementById('debug-output') as HTMLSpanElement;

    const messageElement = document.createElement('span') as HTMLElement;
    messageElement.className = type;
    messageElement.innerText = message;

    outputElement?.replaceChildren(messageElement);

    if (type === 'error') {
        const loader = document.getElementById('loader');
        // Remove loader to indicate a fatal error, and that the app is no longer loading and will not progress further.
        loader?.parentNode?.removeChild(loader);
        const message = 'Execution halted due to a fatal error.';
        console.log(message);
        throw new Error(message); // Halts Execution, due to unhandled exception.
    }
}

async function init() {
    const quitBtn = document.getElementById('quitBtn');

    quitBtn?.addEventListener('click', () => {
        electroview.rpc?.request.close();
    });

    displayDebug('Checking for updates...');
    const updateAvailable = await electroview.rpc?.request.checkUpdate();
    if (updateAvailable) {
        displayDebug(`New version ${updateAvailable} is available. Download now?`);
    } else {
        displayDebug(`No new versions found, continuing to store..`);
        await electroview.rpc?.request.storeHandoff();
    }
}

window.addEventListener('load', async () => {
    await wait(100);
    try {
        electroview = new Electroview({ rpc });
        await electroview.rpc?.request.ready();
        await init();
    } catch (err) {
        console.error("Failed to signal ready to Bun:", err);
    }
});
