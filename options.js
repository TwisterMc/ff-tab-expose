"use strict";

const shortcutDisplay = document.getElementById("shortcut-display");
const columnsInput = document.getElementById("columns-input");
const columnsValue = document.getElementById("columns-value");

// Load current command/shortcut info
async function loadShortcutInfo() {
  try {
    const commands = await browser.commands.getAll();
    const openExposeCommand = commands.find(
      (cmd) => cmd.name === "open-expose",
    );

    if (openExposeCommand) {
      const shortcut = openExposeCommand.shortcut || "Not set";
      shortcutDisplay.textContent = shortcut;
    }
  } catch (e) {
    console.error("Error loading shortcut info:", e);
  }
}

// Load and save columns setting
async function loadColumnsSettings() {
  try {
    const stored = await browser.storage.local.get("gridColumns");
    const columns = stored.gridColumns ?? 4;
    columnsInput.value = columns;
    columnsValue.textContent = columns;
  } catch (e) {
    console.error("Error loading columns setting:", e);
  }
}

function saveColumnsSetting() {
  const columns = parseInt(columnsInput.value, 10);
  columnsValue.textContent = columns;
  browser.storage.local.set({ gridColumns: columns });
}

columnsInput.addEventListener("input", saveColumnsSetting);

// Initialize
loadShortcutInfo();
loadColumnsSettings();
