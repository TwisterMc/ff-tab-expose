"use strict";

const grid = document.getElementById("grid");
const searchInput = document.getElementById("search");
const tabCountEl = document.getElementById("tab-count");

let allTabs = [];
let currentExposeTabId = null;
let ready = false;

// ── Init ──────────────────────────────────────────────

async function sendMessageWithRetry(message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await browser.runtime.sendMessage(message);
    } catch (e) {
      if (
        i < maxRetries - 1 &&
        e.message.includes("Receiving end does not exist")
      ) {
        // Background script not ready yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 100));
      } else {
        throw e;
      }
    }
  }
}

async function init() {
  const selfTab = await browser.tabs.getCurrent();
  currentExposeTabId = selfTab?.id ?? null;

  const response = await sendMessageWithRetry({ type: "GET_ALL_TABS" });
  allTabs = (response?.tabs ?? []).filter((t) => t.id !== currentExposeTabId);

  ready = true;
  render(allTabs);
  searchInput.focus();
}

// ── Render ────────────────────────────────────────────

function render(tabs) {
  grid.innerHTML = "";

  tabCountEl.textContent = `${tabs.length} tab${tabs.length !== 1 ? "s" : ""}`;

  if (tabs.length === 0) return;

  // Group by window
  const windows = new Map();
  for (const tab of tabs) {
    if (!windows.has(tab.windowId)) windows.set(tab.windowId, []);
    windows.get(tab.windowId).push(tab);
  }

  const windowIds = [...windows.keys()];
  const multiWindow = windowIds.length > 1;

  windowIds.forEach((windowId, wIndex) => {
    if (multiWindow) {
      const divider = document.createElement("div");
      divider.className = "window-group";
      divider.innerHTML = `
        <span class="window-label">Window ${wIndex + 1}</span>
        <span class="window-line"></span>
      `;
      grid.appendChild(divider);
    }

    windows.get(windowId).forEach((tab) => {
      grid.appendChild(buildCard(tab));
    });
  });
}

function buildCard(tab) {
  const card = document.createElement("div");
  card.className = "tab-card";
  card.dataset.tabId = tab.id;
  card.tabIndex = 0;
  card.setAttribute("role", "listitem");
  const labelParts = [tab.title || "Untitled"];
  if (tab.pinned) labelParts.push("pinned");
  card.setAttribute("aria-label", labelParts.join(", "));

  const domain = getDomain(tab.url);
  const ageMinutes =
    tab.screenshotAge != null ? Math.floor(tab.screenshotAge / 60000) : null;

  // Thumbnail
  const thumb = document.createElement("div");
  thumb.className = "tab-thumb";

  if (tab.screenshot) {
    const img = document.createElement("img");
    img.src = tab.screenshot;
    img.alt = "";
    img.loading = "lazy";
    thumb.appendChild(img);
  } else {
    const noShot = document.createElement("div");
    noShot.className = "no-screenshot";

    if (tab.favIconUrl) {
      const fav = document.createElement("img");
      fav.className = "favicon-large";
      fav.src = tab.favIconUrl;
      fav.alt = "";
      fav.onerror = () => fav.remove();
      noShot.appendChild(fav);
    }

    const label = document.createElement("span");
    label.className = "no-preview-label";
    label.textContent = "No preview yet";
    noShot.appendChild(label);
    thumb.appendChild(noShot);
  }

  // Pin badge
  if (tab.pinned) {
    const pin = document.createElement("div");
    pin.className = "pin-badge";
    pin.setAttribute("aria-hidden", "true");
    const pinImg = document.createElement("img");
    pinImg.src = browser.runtime.getURL("icons/pin.fill.svg");
    pinImg.alt = "";
    pin.appendChild(pinImg);
    thumb.appendChild(pin);
  }

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.className = "tab-close";
  closeBtn.title = "Close tab";
  closeBtn.tabIndex = -1;
  closeBtn.innerHTML = `
    <svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
      <line x1="1" y1="1" x2="9" y2="9"/>
      <line x1="9" y1="1" x2="1" y2="9"/>
    </svg>
  `;
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(tab.id, card);
  });
  thumb.appendChild(closeBtn);

  // Info bar
  const info = document.createElement("div");
  info.className = "tab-info";

  if (tab.favIconUrl) {
    const fav = document.createElement("img");
    fav.className = "tab-favicon";
    fav.src = tab.favIconUrl;
    fav.alt = "";
    fav.onerror = () => fav.replaceWith(makeFavPlaceholder());
    info.appendChild(fav);
  } else {
    info.appendChild(makeFavPlaceholder());
  }

  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tab.title || domain || "Untitled";
  title.title = tab.title + "\n" + tab.url;
  info.appendChild(title);

  if (ageMinutes != null && ageMinutes > 5) {
    const dot = document.createElement("div");
    dot.className = "stale-dot";
    dot.title = `Screenshot taken ${ageMinutes}m ago`;
    info.appendChild(dot);
  }

  card.appendChild(thumb);
  card.appendChild(info);

  card.addEventListener("click", () => switchToTab(tab.id, tab.windowId));

  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      switchToTab(tab.id, tab.windowId);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      closeTab(tab.id, card);
    }
  });

  return card;
}

function makeFavPlaceholder() {
  const ph = document.createElement("div");
  ph.className = "tab-favicon-placeholder";
  return ph;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ── Actions ───────────────────────────────────────────

async function switchToTab(tabId, windowId) {
  await sendMessageWithRetry({ type: "SWITCH_TAB", tabId, windowId });
  window.close();
}

async function closeTab(tabId, cardEl) {
  // Move focus before removing the card
  const cards = [...grid.querySelectorAll(".tab-card")];
  const idx = cards.indexOf(cardEl);
  const nextFocus = cards[idx + 1] ?? cards[idx - 1] ?? searchInput;

  cardEl.classList.add("removing");
  cardEl.addEventListener(
    "animationend",
    () => {
      cardEl.remove();
      nextFocus.focus();
    },
    { once: true },
  );

  allTabs = allTabs.filter((t) => t.id !== tabId);

  const query = searchInput.value.trim().toLowerCase();
  const filtered = query ? filterTabs(allTabs, query) : allTabs;
  tabCountEl.textContent = `${filtered.length} tab${filtered.length !== 1 ? "s" : ""}`;

  await sendMessageWithRetry({ type: "CLOSE_TAB", tabId });
}

// ── Search ────────────────────────────────────────────

function filterTabs(tabs, query) {
  const q = query.toLowerCase();
  return tabs.filter(
    (tab) =>
      tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q),
  );
}

searchInput.addEventListener("input", () => {
  if (!ready) return;
  const q = searchInput.value.trim();
  const results = q ? filterTabs(allTabs, q) : allTabs;
  render(results);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (searchInput.value) {
      searchInput.value = "";
      render(allTabs);
    } else {
      window.close();
    }
  }
  if (e.key === "Enter") {
    if (!ready) return;
    const q = searchInput.value.trim();
    const results = q ? filterTabs(allTabs, q) : allTabs;
    if (results.length === 1) {
      switchToTab(results[0].id, results[0].windowId);
    }
  }
});

// ── Keyboard nav ──────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.activeElement !== searchInput) {
    // If focus is on a card, return focus to search; otherwise close
    if (document.activeElement?.classList.contains("tab-card")) {
      searchInput.focus();
    } else {
      window.close();
    }
  }
});

// ── Start ─────────────────────────────────────────────

init().catch(console.error);
