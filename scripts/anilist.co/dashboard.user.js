// ==UserScript==
// @name         AniList Dashboard
// @namespace    traviskinney.co
// @version      2026-09-19
// @description  Show complete list previews on the AniList home dashboard
// @author       Travis Kinney
// @match        https://anilist.co/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/**
 * AniList fetches each dashboard list through a Workerize Worker RPC:
 *
 *   request   { type: "RPC", id, method: "fetch", params }
 *   params    [url, query, variables, headers, options]
 *   options   { page: { id: "homeListPreview-ANIME" or "-MANGA", key, schema } }
 *   reply   | { type: "RPC", id, result: { entities } }
 *           | { type: "RPC", id, error }
 *   entities  { listEntry, media, page: { [listId]: { pageData: [ids] } } }
 *
 * Lists are fetched with a composite ID (`<id>-<page>`) that AniList ignores.
 * The replies are then merged together and dispatched under the original ID.
 */

(function () {
  "use strict";

  const PER_PAGE = 50; // API maximum
  const PAGE_ARGS = "Page(perPage:$perPage)";

  const postMessage = Worker.prototype.postMessage;

  Worker.prototype.postMessage = function (message, ...rest) {
    const listId = message?.params?.[4]?.page?.id;
    if (!listId?.startsWith("homeListPreview"))
      return postMessage.call(this, message, ...rest);

    const [, query, variables] = message.params;
    const idPrefix = `${message.id}-`;
    const merged = {};
    let page = 0;

    const fetchPage = () => {
      page += 1;
      const pagedQuery = query.replace(
        PAGE_ARGS,
        `Page(page:${page},perPage:$perPage)`,
      );
      postMessage.call(this, {
        ...message,
        id: idPrefix + page,
        params: message.params
          .with(1, pagedQuery)
          .with(2, { ...variables, perPage: PER_PAGE }),
      });
    };

    const reply = (data) =>
      this.dispatchEvent(
        new MessageEvent("message", {
          data: { type: message.type, id: message.id, ...data },
        }),
      );

    this.addEventListener("message", ({ data }) => {
      if (typeof data?.id !== "string" || !data.id.startsWith(idPrefix)) return;
      // A failed later page keeps the pages already merged.
      if (data.error && !merged.page) {
        reply({ error: data.error });
        return;
      }

      const entities = data.result?.entities ?? {};
      const pageData = entities.page?.[listId]?.pageData ?? [];
      for (const [type, byId] of Object.entries(entities)) {
        if (type === "page" && merged.page) {
          // Offset paging over a live list can repeat IDs across pages.
          const known = merged.page[listId].pageData;
          known.push(...pageData.filter((id) => !known.includes(id)));
        } else {
          Object.assign((merged[type] ??= {}), byId);
        }
      }

      const full = pageData.length === PER_PAGE;
      if (full && query.includes(PAGE_ARGS)) fetchPage();
      else reply({ result: { entities: merged } });
    });

    fetchPage();
  };
})();
