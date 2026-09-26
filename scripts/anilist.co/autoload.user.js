// ==UserScript==
// @name         AniList Activity Autoload
// @namespace    traviskinney.co
// @version      2026-09-26
// @description  Floating button that loads every page of AniList activity feeds
// @author       Travis Kinney
// @match        https://anilist.co/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/**
 * AniList renders a profile's activity feed as a Vue 2 component, reachable as
 * `$el.__vue__` on `div.activity-feed-wrap`:
 *
 *   pager     { page, loading, hasNextPage, paused, scrollHandler }
 *   filter    { activityChanging }
 *
 * `scrollHandler` loads the next page and sets `paused` (which shows "Load
 * More") after every second one. A failed page stays counted in `page`, and
 * `loading` stays set.
 */

(function () {
  "use strict";

  const FAB_ID = "al-autoload-fab";
  const PROFILE_PATH = /^\/user\/[^/]+\/?$/; // activity feed

  // Pauses the active run, null while stopped.
  let pauseRun = null;
  let buttonEl = null;
  let statusEl = null;

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
      #${FAB_ID}[hidden] { display: none; }
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

  const pagesLoaded = (feed) => {
    const count = feed.loading ? feed.page - 1 : feed.page;
    return `${count} ${count === 1 ? "page" : "pages"} loaded`;
  };

  const start = () => {
    const feed = document.querySelector(".activity-feed-wrap")?.__vue__;
    if (!feed) {
      setStatus("No activity feed");
      return;
    }

    const finish = (message) => {
      unwatchLoading();
      unwatchFilter();
      feed.$off("hook:destroyed", pause);
      pauseRun = null;
      setRunningUI(false);
      setStatus(message);
    };

    const pause = () => {
      finish(pagesLoaded(feed));
      if (!feed.loading) return;
      // The page in flight still lands, so count it once it settles.
      const page = feed.page;
      const unwatch = feed.$watch("loading", () => {
        unwatch();
        if (!pauseRun && feed.page === page) setStatus(pagesLoaded(feed));
      });
    };

    const loadPage = () => {
      const page = feed.page + 1;
      feed.paused = false;
      feed.scrollHandler().catch(() => {
        if (pauseRun === pause) finish(`Page ${page} failed to load`);
        // Rewind the pager so the next run fetches the failed page again.
        if (feed.loading && feed.page === page) {
          feed.page -= 1;
          feed.loading = false;
        }
      });
    };

    const loadNext = () => {
      if (!feed.loading) {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "instant",
        });
        if (!feed.hasNextPage) {
          feed.paused = false; // hides the leftover "Load More"
          finish("All pages loaded");
          return;
        }
        loadPage();
      }
      setStatus(`Loading page ${feed.page}...`);
    };

    // A filter change resets the pager while the old page may still land. It
    // also resets `loading`, and watchers run in creation order, so this one
    // comes first.
    const unwatchFilter = feed.$watch("activityChanging", () =>
      finish("Filter changed"),
    );
    const unwatchLoading = feed.$watch("loading", loadNext);
    // Vue drops these watchers with the feed, so the run ends with it.
    feed.$once("hook:destroyed", pause);
    pauseRun = pause;
    setRunningUI(true);
    loadNext();
  };

  const toggleRunning = () => {
    if (pauseRun) pauseRun();
    else start();
  };

  createButton();

  const showOnProfile = () => {
    const onProfile = PROFILE_PATH.test(location.pathname);
    document.getElementById(FAB_ID).hidden = !onProfile;
  };
  showOnProfile();

  // AniList navigates client-side (history.pushState) and keeps the feed when
  // moving between profiles, so any route change ends a running load.
  const onNavigate = () => {
    if (pauseRun) pauseRun();
    showOnProfile();
  };
  window.addEventListener("popstate", onNavigate);
  const pushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    pushState(...args);
    onNavigate();
  };

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pauseRun) pauseRun();
  });
})();
