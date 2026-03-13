"use strict";

const statusMessage = document.getElementById("status-message");
const shortcutDisplay = document.getElementById("shortcut-display");
const manageShortcutsBtn = document.getElementById("manage-shortcuts-btn");

// Function to show status message
function showStatus(message, type = "info", duration = 3000) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type} show`;
  if (duration > 0) {
    setTimeout(() => {
      statusMessage.classList.remove("show");
    }, duration);
  }
}

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

// Handle manage shortcuts button
manageShortcutsBtn.addEventListener("click", async () => {
  try {
    if (browser.commands?.openShortcutSettings) {
      await browser.commands.openShortcutSettings();
      showStatus("Shortcut settings opened.", "success");
      return;
    }

    if (browser.runtime?.openOptionsPage) {
      await browser.runtime.openOptionsPage();
    }

    showStatus(
      "Open about:addons, then use the gear menu and choose Manage Extension Shortcuts.",
      "info",
      6000,
    );
  } catch (e) {
    console.error("Could not open shortcut settings:", e);
    showStatus(
      "Could not open shortcut settings automatically. Open about:addons and choose Manage Extension Shortcuts from the gear menu.",
      "info",
      7000,
    );
  }
});

// Initialize
loadShortcutInfo();
