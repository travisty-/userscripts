// ==UserScript==
// @name         Nyaa Search Extensions
// @namespace    traviskinney.co
// @version      2026-09-05.1
// @description  Wide search bar (nav links collapsed into a menu) and date filtering with auto-paging
// @author       Travis Kinney
// @match        https://nyaa.si/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

/* global _format_date, _format_time_difference */

(function () {
  "use strict";

  const MENU_ID = "nt-navmenu";
  const PANEL_ID = "nt-panel";
  const COUNTER_ID = "nt-counter";
  const MAX_EXTRA_PAGES = 10;
  const FETCH_DELAY_MS = 250;
  const ROWS_PER_PAGE = 75;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_PRESET = "today";

  // Presets are rolling windows off the clock; manual From/To are local
  // calendar days, matching the Date column (nyaa's main.js rewrites it to
  // local time on DOMContentLoaded).
  const NO_FILTER = { id: "all", label: "All dates", bounds: () => null };
  const PRESETS = [
    NO_FILTER,
    {
      id: "today",
      label: "Today (24h)",
      bounds: () => ({ from: Date.now() - DAY_MS, to: Infinity }),
    },
    {
      id: "7d",
      label: "Last 7 days",
      bounds: () => ({ from: Date.now() - 7 * DAY_MS, to: Infinity }),
    },
    {
      id: "30d",
      label: "Last 30 days",
      bounds: () => ({ from: Date.now() - 30 * DAY_MS, to: Infinity }),
    },
    {
      id: "year",
      label: "This year",
      bounds: () => ({
        from: new Date(new Date().getFullYear(), 0, 1).getTime(),
        to: Infinity,
      }),
    },
  ];

  // Search, sort and page come from the URL and are fixed for the page's life.
  const pageState = (() => {
    const params = new URLSearchParams(location.search);
    const sortKey = params.get("s");
    return {
      hasQuery: Boolean((params.get("q") || "").trim()),
      dateSort: !sortKey || sortKey === "id",
      desc: params.get("o") !== "asc",
      page: Math.max(1, parseInt(params.get("p") || "1", 10) || 1),
    };
  })();

  // {from, to} in ms since epoch (either side may be infinite), or null for no filter
  let bounds = null;
  // Every loaded row in page order; the tbody holds only the ones in bounds.
  let allRows = [];
  let extraPagesLoaded = 0;
  let reachedEnd = false;
  let fetching = false;
  // Trailing note in the counter: fetch progress, or why auto-paging stopped.
  let status = "";

  let tbodyEl = null;
  let dateThEl = null;
  let panelEl = null;
  let counterEl = null;
  let fromInput = null;
  let toInput = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const injectStyles = () => {
    const style = document.createElement("style");
    style.textContent = `
      /* Navbar, from nyaa's 992px collapse breakpoint up: the original link
         list is replaced by the #${MENU_ID} dropdown, and the search form
         flexes into the freed space. !important is needed to beat Bootstrap's
         .navbar-collapse.collapse { display: block !important }. The
         input-group must switch from Bootstrap's shrink-to-fit inline-table
         to a full-width table, with the select/button cells pinned to their
         content so the input cell absorbs the leftover width. The collapsed
         (hamburger) navbar below the breakpoint keeps the stock link list. */
      @media (max-width: 991px) {
        #${MENU_ID} { display: none; }
      }
      @media (min-width: 992px) {
        .nt-orig-nav { display: none !important; }
        #navbar.nt-flex { display: flex !important; align-items: center; }
        #navbar.nt-flex > #${MENU_ID} { order: 0; }
        #navbar.nt-flex > form.navbar-form { order: 1; flex: 1 1 auto; float: none; }
        #navbar.nt-flex > ul.navbar-right { order: 2; }
        #navbar.nt-flex > form.navbar-form .search-container { display: table; width: 100%; }
        #navbar.nt-flex > form.navbar-form .nav-filter { width: 1%; }
        #navbar.nt-flex > form.navbar-form .search-btn { width: 1%; }
      }

      /* The whole Date header opens the sort+filter panel; the native
         full-header sort overlay link is disabled for this column since the
         panel has its own sort links. */
      th.hdr-date { position: relative; cursor: pointer; }
      th.hdr-date:hover { background: rgba(128, 128, 128, 0.14); }
      th.hdr-date > a { display: none; }
      /* Vertically center the native caret glyph (stock puts it at top: 12px). */
      table.torrent-list thead th.hdr-date:after { top: 50% !important; transform: translateY(-50%); }
      /* The caret doubles as the filter indicator while a filter is active. */
      table.torrent-list thead th.hdr-date.nt-filter-on:after { color: #337ab7 !important; }
      body.dark table.torrent-list thead th.hdr-date.nt-filter-on:after { color: #5bc0de !important; }

      /* Bootstrap's .table-responsive wrapper is a scroll container
         (overflow-x: auto), which would clip the panel below a short table. */
      .table-responsive:has(#${PANEL_ID}:not([hidden])) { overflow: visible; }
      #${PANEL_ID} {
        position: absolute; top: 100%; right: 0; z-index: 1000;
        min-width: 220px; padding: 8px; text-align: left;
        background: #fff; color: #333;
        border: 1px solid #ccc; border-radius: 4px;
        box-shadow: 0 6px 12px rgba(0, 0, 0, 0.2);
        font-weight: normal; cursor: default;
      }
      body.dark #${PANEL_ID} { background: #3c3c3c; color: #ddd; border-color: #202020; }
      #${PANEL_ID} .nt-preset, #${PANEL_ID} .nt-sort {
        display: block; width: 100%; text-align: left; border: none;
        background: transparent; color: inherit; padding: 4px 8px;
        border-radius: 3px; cursor: pointer; font-size: 13px;
        text-decoration: none; white-space: nowrap;
      }
      #${PANEL_ID} .nt-preset:hover, #${PANEL_ID} .nt-sort:hover {
        background: rgba(128, 128, 128, 0.18); color: inherit;
      }
      #${PANEL_ID} .nt-preset .fa, #${PANEL_ID} .nt-sort .fa { width: 16px; }
      /* Un-does nyaa's "table.torrent-list thead th a" rule, which turns every
         anchor inside a header cell into an invisible full-size sort overlay
         (position: absolute, opacity: 0, z-index: 10) and would otherwise
         swallow these links since the panel is inside the th. */
      #${PANEL_ID} a.nt-sort {
        position: static; opacity: 1; height: auto; z-index: auto;
      }
      #${PANEL_ID} hr { margin: 6px 0; border-color: rgba(128, 128, 128, 0.35); }
      #${PANEL_ID} label {
        display: flex; align-items: center; gap: 6px;
        font-weight: normal; font-size: 12px; margin: 4px 0;
      }
      #${PANEL_ID} label span { width: 34px; }
      #${PANEL_ID} input[type="date"] {
        flex: 1; font-size: 12px; padding: 2px 4px; color: inherit;
        background: transparent; border: 1px solid rgba(128, 128, 128, 0.5);
        border-radius: 3px; color-scheme: light;
      }
      body.dark #${PANEL_ID} input[type="date"] { color-scheme: dark; }
      #${PANEL_ID} .nt-actions { display: flex; gap: 6px; margin-top: 6px; }
      #${PANEL_ID} .nt-actions .btn { flex: 1; padding: 3px 0; }

      #${COUNTER_ID} { margin: 4px 0 6px; font-size: 12.5px; opacity: 0.85; text-align: right; }
    `;
    document.head.appendChild(style);
  };

  // --- Navbar ---

  const collapseNav = () => {
    const navbar = document.getElementById("navbar");
    const origNav =
      navbar && navbar.querySelector("ul.nav.navbar-nav:not(.navbar-right)");
    if (!origNav) return;

    const menu = document.createElement("ul");
    menu.id = MENU_ID;
    menu.className = "nav navbar-nav";
    // Bootstrap's data-api handles the toggle via a delegated listener, so no
    // extra JS wiring is needed for dynamically added dropdowns.
    menu.innerHTML = `
      <li class="dropdown">
        <a href="#" class="dropdown-toggle" data-toggle="dropdown" role="button" aria-haspopup="true" aria-expanded="false"><i class="fa fa-bars"></i> <span class="caret"></span></a>
        <ul class="dropdown-menu"></ul>
      </li>
    `;

    // Flattens the link list, including entries nested in the Info dropdown.
    const dd = menu.querySelector(".dropdown-menu");
    for (const a of origNav.querySelectorAll('a[href]:not([href="#"])')) {
      const item = document.createElement("li");
      if (a.parentElement.classList.contains("active"))
        item.className = "active";
      const link = document.createElement("a");
      link.href = a.getAttribute("href");
      link.textContent = a.textContent.trim();
      item.appendChild(link);
      dd.appendChild(item);
    }

    origNav.classList.add("nt-orig-nav");
    origNav.before(menu);
    navbar.classList.add("nt-flex");
  };

  // --- Date filter ---

  const rowTs = (row) => {
    const cell = row.querySelector("td[data-timestamp]");
    return cell
      ? parseInt(cell.getAttribute("data-timestamp"), 10) * 1000
      : NaN;
  };

  // The comments link (/view/N#comments) precedes the title link when a
  // torrent has comments, so the fragment is dropped to key on the torrent.
  const viewId = (row) => {
    const a = row.querySelector('a[href^="/view/"]');
    return a ? a.getAttribute("href").split("#")[0] : null;
  };

  // nyaa's main.js localizes [data-timestamp] cells in its DOMContentLoaded
  // handler, using these globals. Whether that handler runs before or after
  // this script depends on the userscript manager, and rows fetched later
  // never see it, so every row is formatted here as well.
  const localizeDate = (row) => {
    const cell = row.querySelector("td[data-timestamp]");
    if (!cell) return;
    const ts = parseInt(cell.getAttribute("data-timestamp"), 10);
    cell.textContent = _format_date(new Date(ts * 1000), false);
    cell.title = _format_time_difference(Math.floor(Date.now() / 1000) - ts);
  };

  const inBounds = (row) => {
    if (!bounds) return true;
    const ts = rowTs(row);
    return ts >= bounds.from && ts <= bounds.to;
  };

  // Rows outside the window leave the tbody entirely, so Bootstrap's striping,
  // hover and trusted/remake tints keep working on the visible rows.
  const applyFilter = () => {
    tbodyEl.replaceChildren(...allRows.filter(inBounds));
    dateThEl.classList.toggle("nt-filter-on", bounds !== null);
  };

  const setCounter = () => {
    const total = allRows.length;
    const parts = [
      bounds
        ? `${tbodyEl.rows.length} of ${total} loaded torrents match`
        : `${total} torrents loaded`,
    ];
    if (extraPagesLoaded)
      parts.push(
        `+${extraPagesLoaded} page${extraPagesLoaded === 1 ? "" : "s"} auto-fetched`,
      );
    if (status) parts.push(status);
    counterEl.textContent = parts.join(" · ");
  };

  const setStatus = (text) => {
    status = text;
    setCounter();
  };

  const fetchPageDoc = async (p) => {
    const url = new URL(location.href);
    url.searchParams.set("p", String(p));
    try {
      const res = await fetch(url.toString(), { credentials: "same-origin" });
      if (!res.ok) return null;
      return new DOMParser().parseFromString(await res.text(), "text/html");
    } catch {
      return null;
    }
  };

  // Rows are date-sorted, so the last loaded row bounds what later pages can
  // contain: once it falls outside the window, no further page matches.
  const morePossible = () => {
    const edge = allRows[allRows.length - 1];
    if (!edge) return false;
    const ts = rowTs(edge);
    return pageState.desc ? ts >= bounds.from : ts <= bounds.to;
  };

  const autoFetch = async () => {
    // A running loop re-reads bounds on every iteration.
    if (fetching) return;
    if (!bounds) {
      setStatus("");
      return;
    }
    if (!pageState.hasQuery) {
      setStatus("auto-paging needs a search query");
      return;
    }
    if (!pageState.dateSort) {
      setStatus("sort by date to autoload more pages");
      return;
    }

    fetching = true;
    const seen = new Set(allRows.map(viewId));
    let stopReason = "";
    while (bounds && !reachedEnd && morePossible()) {
      if (extraPagesLoaded >= MAX_EXTRA_PAGES) {
        stopReason = `stopped at ${MAX_EXTRA_PAGES}-page cap`;
        break;
      }
      const nextPage = pageState.page + extraPagesLoaded + 1;
      setStatus(`fetching page ${nextPage}…`);
      const doc = await fetchPageDoc(nextPage);
      const fetchedBody = doc && doc.querySelector("table.torrent-list tbody");
      if (!fetchedBody) {
        stopReason = `page ${nextPage} failed to load`;
        break;
      }
      const fetched = [...fetchedBody.rows];
      if (!fetched.length) {
        reachedEnd = true;
        break;
      }

      // Uploads landing between fetches shift rows onto later pages, so a
      // fetched page can repeat rows already loaded; dedupe on the /view/ link.
      for (const row of fetched) {
        const id = viewId(row);
        if (seen.has(id)) continue;
        seen.add(id);
        localizeDate(row);
        allRows.push(row);
      }
      extraPagesLoaded++;
      if (fetched.length < ROWS_PER_PAGE) reachedEnd = true;
      applyFilter();
      setStatus("");
      await sleep(FETCH_DELAY_MS);
    }
    fetching = false;
    setStatus(stopReason);
  };

  const updatePanelChecks = (presetId) => {
    for (const btn of panelEl.querySelectorAll(".nt-preset")) {
      btn
        .querySelector(".fa")
        .classList.toggle("fa-check", btn.dataset.preset === presetId);
    }
  };

  const setBounds = (b, presetId) => {
    bounds = b;
    applyFilter();
    updatePanelChecks(presetId);
    setCounter();
    autoFetch();
  };

  const hidePanel = () => {
    panelEl.hidden = true;
  };

  const selectPreset = (preset) => {
    fromInput.value = "";
    toInput.value = "";
    setBounds(preset.bounds(), preset.id);
    hidePanel();
  };

  // Local midnight of a date input value ("YYYY-MM-DD"), shifted by whole days.
  const localMidnight = (value, dayOffset) => {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d + dayOffset).getTime();
  };

  const sortUrl = (o) => {
    const url = new URL(location.href);
    url.searchParams.set("s", "id");
    url.searchParams.set("o", o);
    url.searchParams.delete("p");
    return url.toString();
  };

  const buildPanel = () => {
    panelEl = document.createElement("div");
    panelEl.id = PANEL_ID;
    panelEl.hidden = true;

    const { dateSort, desc } = pageState;
    panelEl.innerHTML = `
      <a class="nt-sort" href="${sortUrl("desc")}"><i class="fa${dateSort && desc ? " fa-check" : ""}"></i> Newest first</a>
      <a class="nt-sort" href="${sortUrl("asc")}"><i class="fa${dateSort && !desc ? " fa-check" : ""}"></i> Oldest first</a>
      <hr>
      ${PRESETS.map((p) => `<button type="button" class="nt-preset" data-preset="${p.id}"><i class="fa"></i> ${p.label}</button>`).join("")}
      <hr>
      <label><span>From</span><input type="date"></label>
      <label><span>To</span><input type="date"></label>
      <div class="nt-actions">
        <button type="button" class="btn btn-xs btn-primary">Apply</button>
        <button type="button" class="btn btn-xs btn-default">Clear</button>
      </div>
    `;

    for (const btn of panelEl.querySelectorAll(".nt-preset")) {
      const preset = PRESETS.find((p) => p.id === btn.dataset.preset);
      btn.addEventListener("click", () => selectPreset(preset));
    }
    [fromInput, toInput] = panelEl.querySelectorAll('input[type="date"]');
    const [applyBtn, clearBtn] = panelEl.querySelectorAll(".nt-actions .btn");
    applyBtn.addEventListener("click", () => {
      if (!fromInput.value && !toInput.value) {
        selectPreset(NO_FILTER);
        return;
      }
      setBounds(
        {
          from: fromInput.value ? localMidnight(fromInput.value, 0) : -Infinity,
          to: toInput.value ? localMidnight(toInput.value, 1) - 1 : Infinity,
        },
        "custom",
      );
      hidePanel();
    });
    clearBtn.addEventListener("click", () => selectPreset(NO_FILTER));
  };

  const setupFilter = () => {
    const tableEl = document.querySelector("table.torrent-list");
    tbodyEl = tableEl && tableEl.tBodies[0];
    dateThEl = tableEl && tableEl.querySelector("th.hdr-date");
    if (!tbodyEl || !dateThEl) return false;
    allRows = [...tbodyEl.rows];
    allRows.forEach(localizeDate);

    buildPanel();
    dateThEl.title = "Sort / filter by date (local time)";
    dateThEl.appendChild(panelEl);
    dateThEl.addEventListener("click", (event) => {
      if (panelEl.contains(event.target)) return;
      panelEl.hidden = !panelEl.hidden;
    });

    counterEl = document.createElement("div");
    counterEl.id = COUNTER_ID;
    (tableEl.closest(".table-responsive") || tableEl).before(counterEl);
    setCounter();

    document.addEventListener("click", (event) => {
      if (panelEl.hidden || dateThEl.contains(event.target)) return;
      hidePanel();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hidePanel();
    });
    return true;
  };

  injectStyles();
  collapseNav();
  // Below 768px nyaa hides the Date column, and the panel inside it, so a
  // default filter there would have no control to clear it.
  if (setupFilter() && dateThEl.offsetParent !== null) {
    selectPreset(PRESETS.find((p) => p.id === DEFAULT_PRESET));
  }
})();
