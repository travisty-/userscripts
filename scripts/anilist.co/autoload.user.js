// ==UserScript==
// @name         AniList Activity Autoload
// @namespace    traviskinney.co
// @version      2026-09-05
// @description  Floating button that bulk-clicks "Load More" on AniList activity feeds
// @author       Travis Kinney
// @match        https://anilist.co/user/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const FAB_ID = "al-autoload-fab";
  const GROWTH_TIMEOUT_MS = 5000;
  const POLL_INTERVAL_MS = 100;

  // Serial of the active run, 0 while stopped. A loop whose serial no longer
  // matches was paused or superseded and exits silently.
  let activeRun = 0;
  let runs = 0;
  let pageCount = 0;
  let buttonEl = null;
  let statusEl = null;

  // AniList's control is a div.load-more, rendered only while the feed is paused.
  const findLoadMoreButton = () => {
    const element = document.querySelector(".load-more");
    return element && element.offsetParent !== null ? element : null;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const injectStyles = () => {
    const style = document.createElement("style");
    style.textContent = `
      #${FAB_ID} {
        position: fixed;
        bottom: 11px;
        right: 33px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        font-family: 'Overpass', -apple-system, BlinkMacSystemFont, sans-serif;
        user-select: none;
      }
      #${FAB_ID} .al-btn {
        background: rgb(61, 180, 242);
        color: white;
        border: none;
        border-radius: 4px;
        padding: 8px 20px;
        width: 110px;
        box-sizing: border-box;
        font-weight: 600;
        cursor: pointer;
        font-size: 13px;
        line-height: 1.4;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        transition: background 0.15s ease;
      }
      #${FAB_ID} .al-btn:hover { background: rgb(78, 196, 255); }
      #${FAB_ID} .al-btn.running { background: rgb(232, 93, 117); }
      #${FAB_ID} .al-btn.running:hover { background: rgb(245, 113, 137); }
      #${FAB_ID} .al-status {
        color: rgba(255, 255, 255, 0.9);
        font-size: 12px;
        line-height: 1.4;
        white-space: nowrap;
        text-align: center;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 4px rgba(0, 0, 0, 0.7);
        min-height: 17px;
        width: 110px;
      }
      #${FAB_ID} .al-status:empty { visibility: hidden; }
    `;
    document.head.appendChild(style);
  };

  const createButton = () => {
    injectStyles();

    const fab = document.createElement("div");
    fab.id = FAB_ID;
    fab.innerHTML = `<button class="al-btn">Autoload</button><span class="al-status"></span>`;
    [buttonEl, statusEl] = fab.children;
    buttonEl.addEventListener("click", toggleRunning);
    document.body.appendChild(fab);
  };

  const setStatus = (message) => {
    statusEl.textContent = message;
  };

  const setRunningUI = (isRunning) => {
    buttonEl.classList.toggle("running", isRunning);
    buttonEl.textContent = isRunning ? "Pause" : "Autoload";
  };

  const pagesLoaded = () =>
    `${pageCount} ${pageCount === 1 ? "page" : "pages"} loaded`;

  const finish = (message) => {
    activeRun = 0;
    setRunningUI(false);
    setStatus(message);
  };

  const waitFor = async (run, predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (activeRun === run && Date.now() < deadline) {
      if (predicate()) return true;
      await sleep(POLL_INTERVAL_MS);
    }
    return false;
  };

  const start = async () => {
    const run = ++runs;
    activeRun = run;
    setRunningUI(true);

    while (activeRun === run) {
      setStatus(`Loading page ${pageCount + 1}...`);
      const heightBefore = document.body.scrollHeight;
      window.scrollTo({ top: heightBefore, behavior: "instant" });
      const button = findLoadMoreButton();
      if (button) button.click();

      // The feed shows a spinner, which adds height of its own, while a
      // request is in flight; growth counts once the spinner is gone.
      const grew = await waitFor(
        run,
        () =>
          document.body.scrollHeight > heightBefore &&
          !document.querySelector(".scroller .emoji-spinner"),
        GROWTH_TIMEOUT_MS,
      );
      if (activeRun !== run) return;
      if (!grew) {
        finish("All pages loaded");
        return;
      }
      pageCount++;
    }
  };

  const toggleRunning = () => {
    if (activeRun) finish(pagesLoaded());
    else start();
  };

  createButton();

  // AniList navigates client-side (history.pushState) and remounts the feed on
  // every route change, which ends a running load and restarts the page count.
  const onNavigate = () => {
    if (activeRun) finish(pagesLoaded());
    pageCount = 0;
  };
  window.addEventListener("popstate", onNavigate);
  const pushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    pushState(...args);
    onNavigate();
  };

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeRun) finish(pagesLoaded());
  });
})();
