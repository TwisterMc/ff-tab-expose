"use strict";

const shortcutDisplay = document.getElementById("shortcut-display");

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

// Initialize
loadShortcutInfo();
