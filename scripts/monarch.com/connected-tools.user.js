// ==UserScript==
// @name         Monarch Connected Tools
// @namespace    traviskinney.co
// @version      2026-10-08
// @description  Hides revoked entries from connected tools in the integrations settings
// @author       Travis Kinney
// @match        https://app.monarch.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/**
 * The Integrations page loads its list with one Apollo query over fetch:
 *
 *   request   POST <api>/graphql
 *             { operationName: "Web_GetConnectedApps", query, variables }
 *   reply     { data: { connectedApps: [{ id, name, scopes, authorizedAt, lastUsedAt, expiresAt, revokedAt }] } }
 *
 * Entries with a revokedAt date are dropped from the response before Apollo sees it.
 */

(function () {
  "use strict";

  const OPERATION = '"operationName":"Web_GetConnectedApps"';
  const fetch = window.fetch;

  window.fetch = async function (input, init) {
    const res = await fetch.call(this, input, init);
    if (typeof init?.body !== "string" || !init.body.includes(OPERATION))
      return res;
    const json = await res.json();
    const apps = json.data?.connectedApps;
    if (Array.isArray(apps))
      json.data.connectedApps = apps.filter((app) => !app.revokedAt);
    return new Response(JSON.stringify(json), res);
  };
})();
