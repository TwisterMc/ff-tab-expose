// Tab screenshot cache: tabId -> { dataUrl, timestamp, title, url, favIconUrl }
const screenshotCache = new Map();

// Capture the currently visible tab
async function captureCurrentTab() {
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tabs.length) return;

    const tab = tabs[0];
    if (!tab.id || tab.id < 0) return;

    // Don't capture browser internal pages
    if (
      tab.url &&
      (tab.url.startsWith("about:") || tab.url.startsWith("moz-extension:"))
    ) {
      return;
    }

    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 70,
    });

    screenshotCache.set(tab.id, {
      dataUrl,
      timestamp: Date.now(),
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
    });
  } catch (e) {
    // Tab might not be capturable (e.g., about: pages)
  }
}

// Capture when user activates a tab
browser.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  // Small delay to let the tab fully render
  setTimeout(captureCurrentTab, 600);
});

// Update metadata when tab updates (title, url, favicon)
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    const existing = screenshotCache.get(tabId);
    if (existing) {
      screenshotCache.set(tabId, {
        ...existing,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl,
      });
    }
    // Capture if this is the active tab
    if (tab.active) {
      setTimeout(captureCurrentTab, 800);
    }
  }
});

// Clean up when tab is closed
browser.tabs.onRemoved.addListener((tabId) => {
  screenshotCache.delete(tabId);
});

async function toggleExposeTab() {
  const exposeUrl = browser.runtime.getURL("expose.html");

  // If exposé is already open, close it (toggle behavior)
  const existing = await browser.tabs.query({ url: exposeUrl });
  if (existing.length > 0) {
    await browser.tabs.remove(existing.map((tab) => tab.id));
    return;
  }

  await browser.tabs.create({ url: exposeUrl });
}

// Open exposé page when toolbar button clicked
browser.browserAction.onClicked.addListener(async () => {
  await toggleExposeTab();
  captureCurrentTab();
});

// Handle keyboard shortcut
browser.commands.onCommand.addListener(async (command) => {
  if (command === "open-expose") {
    await toggleExposeTab();
    captureCurrentTab();
  }
});

// Message handler: expose page requests all tab data
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_ALL_TABS") {
    browser.tabs.query({}).then(async (tabs) => {
      const result = tabs
        .filter((tab) => {
          const url = tab.url || "";
          return !url.startsWith("moz-extension:");
        })
        .map((tab) => ({
          id: tab.id,
          windowId: tab.windowId,
          title: tab.title || "Untitled",
          url: tab.url || "",
          favIconUrl: tab.favIconUrl || "",
          active: tab.active,
          pinned: tab.pinned,
          screenshot: screenshotCache.get(tab.id)?.dataUrl || null,
          screenshotAge: screenshotCache.get(tab.id)
            ? Date.now() - screenshotCache.get(tab.id).timestamp
            : null,
        }));
      sendResponse({ tabs: result });
    });
    return true; // async
  }

  if (message.type === "SWITCH_TAB") {
    browser.tabs.update(message.tabId, { active: true }).then(() => {
      browser.windows.update(message.windowId, { focused: true });
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "CLOSE_TAB") {
    browser.tabs.remove(message.tabId).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
});
