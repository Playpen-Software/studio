const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// In Electron with nodeIntegration, we require jQuery if not loaded via script tag
// Or simply use the window object if it's already there
var $ = window.jQuery = window.$ = require('jquery');

// --- Configuration & Paths ---
const STORE_DIR = path.join(os.homedir(), 'nvxstdo', 'store');
const inventoryPath = path.join(STORE_DIR, 'inventory.ndjson');
const indexCssPath = path.join(os.homedir(), 'nvxstdo', 'appdata', 'index.css'); // Adjusted based on your snippet

let inventory = [];
let selectedItems = [];
let selectedItem = null;
let changed = false;

// --- Initialization ---
(function init() {
    try {
        // Ensure directory exists
        if (!fs.existsSync(STORE_DIR)) {
            fs.mkdirSync(STORE_DIR, { recursive: true });
        }
        // Ensure file exists
        if (!fs.existsSync(inventoryPath)) {
            fs.writeFileSync(inventoryPath, "");
            console.log("Created inventory file at:", inventoryPath);
        }
    } catch (err) {
        console.error("Initialization failed:", err);
    }
})();

$(document).ready(async () => {
    // Set up Search Input
    $("#explorerSearchBar").on("input", (e) => searchInventory(e.target.value));
    
    // Set up Save Button
    $("#save").on("click", async () => await saveInventoryNDJSON());

    // Initial Load
    updateButtonState();
    
    openTab("workpanel");
    await loadInventoryNDJSON();
    $('#workpanelProgress').text('Inventory Loaded.');
});

// --- File Operations ---

function createItemHtmlString(item) {
    const name = safeDecode(item.name);
    const location = safeDecode(item.location);
    const date = formatDate(safeDecode(item.date));
    const keywordsArr = (item.keywords || []).map(k => safeDecode(k));
    const keywordsDisplay = keywordsArr.length > 0 ? keywordsArr.join(", ") : "None";
    const quantity = item.quantity ?? 0;
    
    return `
        <div class="item" id="${item.id}" onclick="select('${item.id}')">
            <div class="nameSection"><span>${name}</span></div> 
            <div class="dateSection"><span>${date}</span></div> 
            <div class="locationSection"><span>${location || "—"}</span></div> 
            <div class="keywordSection"><span>${keywordsDisplay}</span></div> 
            <div class="amountSection"><span>${quantity}</span></div>
        </div>`;
}

async function loadInventoryNDJSON(onDone) {
    try {
        if (!fs.existsSync(inventoryPath)) {
            if (onDone) onDone();
            return;
        }
        
        inventory = [];
        const $explorer = $("#explorerItems");
        if ($explorer.length) $explorer.empty();

        // 1. Trace the total file size to calculate percentage updates
        const stats = fs.statSync(inventoryPath);
        const totalBytes = stats.size || 1; // Safeguard division by zero
        let bytesProcessed = 0;
        let lastReportedPercentage = -1;

        // 2. Open up the read stream pipeline
        const fileStream = fs.createReadStream(inventoryPath, { encoding: 'utf8' });
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        // 3. Batch variables to prevent layout thrashing
        const BATCH_SIZE = 100; 
        let fragment = document.createDocumentFragment();

        for await (const line of rl) {
            bytesProcessed += Buffer.byteLength(line, 'utf-8') + 1;
            
            // Calculate and display percentage tracking in the UI
            const currentPercentage = Math.floor((bytesProcessed / totalBytes) * 100);
            if (currentPercentage !== lastReportedPercentage) {
                $("#workpanelProgress").text(`Loading Inventory: ${Math.min(currentPercentage, 100)}%`);
                lastReportedPercentage = currentPercentage;
            }

            if (!line.trim()) continue;

            try {
                const item = JSON.parse(line);
                if (item != null) {
                    inventory.push(item);
                    
                    // Render string to node, and cache it to our temporary memory fragment
                    const itemHtmlString = createItemHtmlString(item);
                    const $element = $(itemHtmlString);
                    fragment.appendChild($element[0]);

                    // Flash the current batch to the DOM once the threshold is crossed
                    if (inventory.length % BATCH_SIZE === 0) {
                        if ($explorer.length) $explorer.append(fragment);
                        fragment = document.createDocumentFragment(); // Instantly spin up a new cache
                        
                        // Give Electron a microscopic pause to repaint the UI and render text
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
            } catch (parseErr) {
                console.error("Skipping malformed NDJSON line:", parseErr);
            }
        }

        // Flush any remaining trailing items left over in the final fragment cache
        if (fragment.childNodes.length > 0 && $explorer.length) {
            $explorer.append(fragment);
        }

        // NOTE: Because we are appending dynamically as they load, the items will render 
        // in the order they appear in the file. If you want them sorted alphabetically, 
        // you would have to sort the array and re-render *after* the entire load finishes.
        inventory.sort((a, b) => safeDecode(a.name).localeCompare(safeDecode(b.name)));

        if (onDone) onDone();
    } catch (err) {
        console.error("Failed to load NDJSON via progressive stream:", err);
    }
}

async function saveInventoryNDJSON() {
    try {
        const lines = inventory.map(item => JSON.stringify(item)).join("\n") + "\n";
        fs.writeFileSync(inventoryPath, lines, 'utf8');
        console.log("✅ Inventory saved successfully.");
        changed = false;
        updateButtonState();
    } catch (err) {
        console.error("❌ Failed to save inventory:", err);
        alert("Failed to save inventory:\n" + err.message);
    }
}

// --- Theme Management ---

async function updateThemeColor(newColor) {
    try {
        if (!fs.existsSync(indexCssPath)) return;
        
        let css = fs.readFileSync(indexCssPath, 'utf8');
        if (newColor === "default") {
            css = css.replace(/(--theme-color:\s*)([^;]+);/, "$1var(--default-theme-color);");
        } else {
            if (!/^#[a-fA-F0-9]{6}$/.test(newColor)) {
                console.error("Invalid color format.");
                return;
            }
            css = css.replace(/(--theme-color:\s*)(#[a-fA-F0-9]{6}|var\(--default-theme-color\));/, `$1${newColor};`);
        }

        fs.writeFileSync(indexCssPath, css);

        const themeLink = document.getElementById("mainStyle");
        if (themeLink) themeLink.href = themeLink.href.split("?")[0] + "?cacheBust=" + Date.now();
        console.log("🎨 Theme updated to", newColor);
    } catch (err) {
        console.error("Failed to update theme color:", err);
    }
}

// --- UI Logic ---

function appendItemToDOM(item) {
    const $explorer = $("#explorerItems");
    if (!$explorer.length) return;
    $explorer.append(createItemHtmlString(item));
}

function select(itemId) {
    const $item = $(`#${itemId}`);
    if (!$item.length) return;

    const isSelected = $item.hasClass("selected");

    if (!isSelected) {
        if (!selectedItems.includes(itemId)) selectedItems.push(itemId);
        $item.addClass("selected").removeClass("item");
    } else {
        selectedItems = selectedItems.filter(id => id !== itemId);
        $item.removeClass("selected").addClass("item");
    }

    selectedItem = selectedItems.length === 1 ? selectedItems[0] : null;
    updateButtonState();
}

function reloadExplorer() {
    $("#explorerItems").empty();
    inventory.forEach(item => appendItemToDOM(item));
    
    selectedItems.forEach(id => {
        $(`#${id}`).addClass("selected").removeClass("item");
    });
}

function searchInventory(query) {
    const lowerQuery = query.trim().toLowerCase();
    $("#explorerItems").empty();

    inventory.forEach(item => {
        const name = safeDecode(item.name).toLowerCase();
        const keywords = (item.keywords || []).map(k => safeDecode(k).toLowerCase());
        if (lowerQuery === "" || name.includes(lowerQuery) || keywords.some(k => k.includes(lowerQuery))) {
            appendItemToDOM(item);
        }
    });
}

// --- Panel/Tab Controls ---

function openPanel(id) {
    shade("open");
    $(".panel").fadeOut(150);
    $("#" + id).fadeIn(150);
}

function closePanel(id) {
    shade("close");
    $("#" + id).fadeOut(150, () => resetPanelInputs(id));
}

function openTab(id) {
    $(".tab").fadeOut(150);
    $("#" + id).fadeIn(150);
}

function shade(action) {
    action === "open" ? $("#shade").fadeIn(150) : $("#shade").fadeOut(150);
}

function resetPanelInputs(panelId) {
    $(`#${panelId}`).find("input, textarea, select").each(function() {
        if ($(this).is(":checkbox") || $(this).is(":radio")) {
            $(this).prop("checked", false);
        } else {
            $(this).val("");
        }
    });
}

function updateButtonState() {
    $("#removeItem").prop("disabled", selectedItems.length === 0);
    $("#editItem, #itemDetails").prop("disabled", selectedItems.length !== 1);
    $("#save").prop("disabled", !changed);
}

// --- Item Management ---

function addItem() {
    const name = $("#addItem-name").val().trim();
    const location = $("#addItem-location").val().trim();
    const quantity = parseInt($("#addItem-quantity").val().trim(), 10);
    const keywordsRaw = $("#addItem-keywords").val().trim();
    const $output = $("#addItem-output");

    if (!name || !location || isNaN(quantity)) {
        $output.text("Please fill in all required fields correctly.");
        return;
    }

    const id = name.toLowerCase().replace(/\s+/g, '-');
    if (inventory.find(item => item.id === id)) {
        $output.text("An item with that name already exists.");
        return;
    }

    const newItem = {
        id,
        name: encodeURIComponent(name),
        date: encodeURIComponent(new Date().toISOString()),
        location: encodeURIComponent(location),
        quantity,
        keywords: keywordsRaw ? keywordsRaw.split(",").map(k => encodeURIComponent(k.trim())).filter(k => k !== "") : []
    };

    // Bug Fix: Corrected property assignment error to method call
    $output.text("");

    inventory.push(newItem);
    changed = true;
    reloadExplorer();
    updateButtonState();
}

function removeSelectedItems() {
    if (!confirm(`Are you sure you want to remove ${selectedItems.length} items?`)) return;

    selectedItems.forEach(id => {
        const index = inventory.findIndex(item => item.id === id);
        if (index !== -1) inventory.splice(index, 1);
    });

    selectedItems = [];
    selectedItem = null;
    changed = true;
    reloadExplorer();
    updateButtonState();
}

// --- Helpers ---

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch { return str; }
}

function formatDate(isoStr) {
    if (!isoStr) return "—";
    const d = new Date(isoStr);
    return isNaN(d) ? isoStr : d.toISOString().split('T')[0];
}

async function quit() {
    if (changed) {
        openTab("quitMenu");
        await new Promise(r => setTimeout(r, 1000));
        await saveInventoryNDJSON();
    }
    window.close();
}

function editSelectedItem() {
    // Only proceed if exactly one item is selected
    if (selectedItems.length !== 1) return;
    
    const id = selectedItems[0];
    const item = inventory.find(it => it.id === id);
    if (!item) return;

    // Populate the input fields in the edit panel
    $("#editItem-name").val(safeDecode(item.name));
    $("#editItem-location").val(safeDecode(item.location));
    $("#editItem-quantity").val(item.quantity ?? 0);
    
    // Join keywords with a comma and space for the textarea/input
    const keywordsString = (item.keywords || []).map(k => safeDecode(k)).join(", ");
    $("#editItem-keywords").val(keywordsString);

    // Clear any previous error messages and show the panel
    $("#editItem-output").text("");
    openPanel("editItemPanel");
}

function detailItem() {
    // Check for the single selected item
    const id = selectedItem || (selectedItems.length === 1 ? selectedItems[0] : null);
    if (!id) return;

    const item = inventory.find(it => it.id === id);
    if (!item) return;

    // Helper to set values/text for detail fields
    $("#detailItem-name").val(safeDecode(item.name));
    $("#detailItem-name-encoded").val(item.name);
    
    $("#detailItem-location").val(safeDecode(item.location));
    $("#detailItem-location-encoded").val(item.location);
    
    const decodedKeywords = (item.keywords || []).map(k => safeDecode(k)).join(", ");
    const encodedKeywords = (item.keywords || []).join(", ");
    
    $("#detailItem-keywords").val(decodedKeywords || "None");
    $("#detailItem-keywords-encoded").val(encodedKeywords || "None");
    
    $("#detailItem-quantity").val(item.quantity ?? 0);
    $("#detailItem-modified").val(formatDate(safeDecode(item.date)));

    openPanel("itemDetailPanel");
}