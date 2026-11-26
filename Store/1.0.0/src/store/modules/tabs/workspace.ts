import { WidthResizableElement } from "../resizableElements";

async function init() {
    console.log("GAH");
    const categoryPanel = document.getElementById('workspace-categoryPanel') as HTMLElement;
    const categoryPanelResizeHandle = document.getElementById('workspace-categoryPanelResizeHandle') as HTMLElement;

    new WidthResizableElement(categoryPanelResizeHandle, categoryPanel, "%", "flex", true);
}

window.addEventListener('storeLoaded', init);