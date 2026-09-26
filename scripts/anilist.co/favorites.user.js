// ==UserScript==
// @name         AniList Favorites
// @namespace    traviskinney.co
// @version      2026-09-26
// @description  Overrides the reorder button to load all favorites and sort them by title
// @author       Travis Kinney
// @match        https://anilist.co/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/**
 * AniList renders each favorites category as a Vue 2 component (`$el.__vue__`):
 *
 *   state     { type, sorting, favourites, sortedFavourites: [{ node }] }
 *   pager     { page, loading, hasNextPage, scrollHandler }
 *   actions | [Reorder]
 *           | [Cancel, Save Order]
 *   entity  | { title: { userPreferred } }
 *           | { name: { userPreferred } }
 *           | { name }
 *
 * A failed page stays counted in `page`, and `loading` stays set.
 *
 * Shift+click on Reorder pages in the rest of the category, orders it by title
 * with numbers last, and switches on Reorder mode. A plain click, Save Order,
 * and Cancel stay AniList's.
 */

(function () {
  "use strict";

  const ACTION = ".favourites:not(.preview) > .section-header > .actions > div";
  const collator = new Intl.Collator(undefined, { numeric: true });
  const LEADING_SYMBOLS = /^[^\p{L}\p{N}]+/u; // "[Oshi no Ko]"
  const LEADING_NUMBER = /^\p{N}/u; // sorts last

  const loadAllPages = (section) =>
    new Promise((resolve, reject) => {
      const loadNext = () => {
        if (section.loading) return;
        if (section.hasNextPage) {
          const page = section.page + 1;
          section.scrollHandler().catch((error) => {
            unwatch();
            // Rewind the pager so the next Shift+click refetches this page.
            if (section.loading && section.page === page) {
              section.page -= 1;
              section.loading = false;
            }
            reject(error);
          });
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

  const sortSection = async (section, button) => {
    // Vue patches this same text node into "Cancel", so edit it, never replace it.
    const label = button.firstChild;
    if (label.data === "Loading...") return;
    label.data = "Loading...";
    try {
      await loadAllPages(section);
    } catch {
      if (label.data === "Loading...") label.data = "Reorder";
      return;
    }
    // Vue relabels the button if a plain click enters Reorder mode meanwhile.
    if (label.data !== "Loading...") return;
    if (!label.isConnected) return; // section reused for another user
    section.sorting = true;
    sortByTitle(section);
  };

  const shiftActionTarget = (event) =>
    event.shiftKey && event.target.closest?.(ACTION);

  // Capturing runs ahead of Vue's own click handlers on the buttons.
  document.addEventListener(
    "click",
    (event) => {
      const button = shiftActionTarget(event);
      if (!button) return;
      // Includes Save Order, where a Shift+double-click's second click lands.
      event.stopPropagation();
      const section = button.closest(".favourites").__vue__;
      if (!section.sorting) sortSection(section, button);
    },
    true,
  );
  // Shift+mousedown would otherwise extend the text selection.
  document.addEventListener(
    "mousedown",
    (event) => {
      if (shiftActionTarget(event)) event.preventDefault();
    },
    true,
  );
})();
