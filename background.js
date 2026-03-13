// Tab screenshot cache: tabId -> { dataUrl, timestamp, title, url, favIconUrl }
const screenshotCache = new Map();

function setCachedScreenshot(tabId, entry) {
  screenshotCache.set(tabId, entry);
  browser.storage.local.set({ [`ss_${tabId}`]: entry });
}

function deleteCachedScreenshot(tabId) {
  screenshotCache.delete(tabId);
  browser.storage.local.remove(`ss_${tabId}`);
}

// Load persisted screenshots on startup, then clean up stale entries
browser.storage.local.get(null).then((stored) => {
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith("ss_")) {
      const tabId = parseInt(key.slice(3), 10);
      if (!isNaN(tabId)) screenshotCache.set(tabId, value);
    }
  }
  browser.tabs.query({}).then((tabs) => {
    const validIds = new Set(tabs.map((t) => t.id));
    const staleKeys = Object.keys(stored).filter((key) => {
      if (!key.startsWith("ss_")) return false;
      const tabId = parseInt(key.slice(3), 10);
      return !isNaN(tabId) && !validIds.has(tabId);
    });
    if (staleKeys.length) browser.storage.local.remove(staleKeys);
  });
});

function isCapturableUrl(url = "") {
  return !url.startsWith("about:") && !url.startsWith("moz-extension:");
}

async function captureTabScreenshot(tab) {
  if (!tab?.id || tab.id < 0) return null;
  if (!isCapturableUrl(tab.url || "")) return null;

  try {
    let dataUrl = null;

    // Firefox supports captureTab, which can capture non-active tabs.
    if (typeof browser.tabs.captureTab === "function") {
      dataUrl = await browser.tabs.captureTab(tab.id, {
        format: "jpeg",
        quality: 70,
      });
    } else if (tab.active) {
      dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, {
        format: "jpeg",
        quality: 70,
      });
    }

    if (!dataUrl) return null;

    setCachedScreenshot(tab.id, {
      dataUrl,
      timestamp: Date.now(),
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
    });

    return dataUrl;
  } catch (e) {
    return null;
  }
}

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
    if (!isCapturableUrl(tab.url || "")) {
      return;
    }

    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 70,
    });

    setCachedScreenshot(tab.id, {
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
      setCachedScreenshot(tabId, {
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
  deleteCachedScreenshot(tabId);
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
const toolbarAction = browser.action || browser.browserAction;
toolbarAction.onClicked.addListener(async () => {
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
  const exposeUrl = browser.runtime.getURL("expose.html");
  const isTrustedSender =
    sender?.id === browser.runtime.id &&
    typeof sender?.url === "string" &&
    sender.url.startsWith(exposeUrl);

  const privilegedTypes = new Set([
    "GET_ALL_TABS",
    "SWITCH_TAB",
    "CLOSE_TAB",
    "CAPTURE_MISSING_SCREENSHOTS",
  ]);

  if (privilegedTypes.has(message?.type) && !isTrustedSender) {
    sendResponse({ ok: false, error: "Unauthorized sender" });
    return false;
  }

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

  if (message.type === "CAPTURE_MISSING_SCREENSHOTS") {
    const requestedIds = (message.tabIds || []).filter((id) => id != null);

    Promise.all(
      requestedIds.map((id) => browser.tabs.get(id).catch(() => null)),
    ).then(async (tabs) => {
      const screenshots = {};

      for (const tab of tabs) {
        if (!tab?.id) continue;

        const existing = screenshotCache.get(tab.id);
        if (existing?.dataUrl) {
          screenshots[tab.id] = existing.dataUrl;
          continue;
        }

        const dataUrl = await captureTabScreenshot(tab);
        if (dataUrl) screenshots[tab.id] = dataUrl;
      }

      sendResponse({ screenshots });
    });

    return true;
  }
});
