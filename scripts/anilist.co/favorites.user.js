// ==UserScript==
// @name         AniList Favorites
// @namespace    traviskinney.co
// @version      2026-09-26
// @description  Automatically sorts AniList favorites by title
// @author       Travis Kinney
// @match        https://anilist.co/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/**
 * AniList renders each favorites category as a Vue 2 component (`$el.__vue__`):
 *
 *   state     { type, sorting, favourites, sortedFavourites: [{ node }] }
 *   pager     { loading, hasNextPage, scrollHandler }
 *   actions | [Reorder]
 *           | [Cancel, Save Order]
 *   entity  | { title: { userPreferred } }
 *           | { name: { userPreferred } }
 *           | { name }
 *
 * Reorder slides out Sort beside it. Either one pages in the rest of the
 * category and switches on Reorder mode, and Sort also orders it by title with
 * numbers last. Save Order and Cancel stay AniList's.
 */

(function () {
  "use strict";

  const collator = new Intl.Collator(undefined, { numeric: true });
  const LEADING_SYMBOLS = /^[^\p{L}\p{N}]+/u; // "[Oshi no Ko]"
  const LEADING_NUMBER = /^\p{N}/u; // sorts last

  const loadAllPages = (section) =>
    new Promise((resolve) => {
      const loadNext = () => {
        if (section.loading) return;
        if (section.hasNextPage) {
          section.scrollHandler();
        } else {
          unwatch();
          resolve();
        }
      };
      const unwatch = section.$watch("loading", loadNext);
      loadNext();
    });

  const sortKeyOf = (section, id) => {
    const entity = section.$store.getters.entity(
      section.entityTypeMap[section.type],
      id,
    );
    const title =
      entity.title?.userPreferred ?? entity.name?.userPreferred ?? entity.name;
    return title.replace(LEADING_SYMBOLS, "");
  };

  const compareKeys = (a, b) =>
    LEADING_NUMBER.test(a) - LEADING_NUMBER.test(b) || collator.compare(a, b);

  const sortByTitle = (section) => {
    const sort = () =>
      section.sortedFavourites.sort((a, b) =>
        compareKeys(sortKeyOf(section, a.node), sortKeyOf(section, b.node)),
      );
    sort();
    // Any favorites reply resets the list to saved order, so reapply the sort.
    const unwatchFavourites = section.$watch("favourites", sort);
    const unwatchSorting = section.$watch("sorting", () => {
      unwatchFavourites();
      unwatchSorting();
    });
  };

  const reorder = async (section, sortEl, button, byTitle) => {
    if (sortEl.classList.contains("al-busy")) return;
    const label = button.textContent;
    button.textContent = "Loading...";
    sortEl.classList.add("al-busy");
    await loadAllPages(section);
    section.sorting = true;
    if (byTitle) sortByTitle(section);
    button.textContent = label;
    sortEl.classList.remove("al-busy", "al-open");
  };

  const addDrawers = () => {
    const selector =
      ".favourites:not(.preview):not(.sorting) > .section-header > .actions";
    for (const actions of document.querySelectorAll(selector)) {
      if (actions.querySelector(".al-sort")) continue;
      const section = actions.closest(".favourites").__vue__;
      // Clones carry the scoped data-v-* attribute that styles AniList's buttons.
      const sortEl = actions.lastElementChild.cloneNode();
      const reorderEl = actions.lastElementChild.cloneNode();
      sortEl.classList.add("al-sort");
      reorderEl.classList.add("al-reorder");
      sortEl.textContent = "Sort";
      reorderEl.textContent = "Reorder";
      sortEl.addEventListener("click", () =>
        reorder(section, sortEl, sortEl, true),
      );
      reorderEl.addEventListener("click", () => {
        if (sortEl.classList.contains("al-open")) {
          reorder(section, sortEl, reorderEl, false);
        } else {
          sortEl.classList.add("al-open");
        }
      });
      actions.prepend(sortEl, " ", reorderEl);
    }
  };

  const closeDrawers = (except) => {
    const open = ".al-sort.al-open:not(.al-busy)";
    for (const sortEl of document.querySelectorAll(open)) {
      if (sortEl !== except) sortEl.classList.remove("al-open");
    }
  };

  const style = document.createElement("style");
  style.textContent = `
    .favourites.sorting .al-sort,
    .favourites.sorting .al-reorder,
    .favourites:not(.preview):not(.sorting) > .section-header > .actions
      > div:not(.al-sort, .al-reorder) {
      display: none;
    }
    .favourites .actions > .al-sort {
      max-width: 10em;
      overflow: hidden;
      text-align: center;
      transition-duration: 0.2s;
      transition-property: max-width, margin, opacity, padding, visibility;
      vertical-align: bottom; /* overflow moves its baseline to the bottom */
      white-space: nowrap;
    }
    .favourites .actions > .al-sort::after {
      content: "Reorder"; /* sizes Sort to match */
      display: block;
      height: 0;
      visibility: hidden;
    }
    .favourites .actions > .al-sort:not(.al-open) {
      margin-left: 0;
      max-width: 0;
      opacity: 0;
      padding-left: 0;
      padding-right: 0;
      visibility: hidden;
    }
  `;
  document.head.append(style);

  document.addEventListener("click", (event) =>
    closeDrawers(event.target.closest?.(".actions")?.querySelector(".al-sort")),
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawers();
  });

  addDrawers();
  new MutationObserver(addDrawers).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
