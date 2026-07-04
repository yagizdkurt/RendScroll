/* Helpers that stamp the current campaign onto server requests.
 *
 * Campaign-scoped endpoints are stateless: the server resolves an explicit
 * `campaign` query/body param first and only falls back to its select-campaign
 * default. These helpers read CampaignManager.active() at call time (so script
 * load order does not matter) and are no-ops when no campaign is active —
 * which also keeps node tests with stubbed fetch seeing unchanged URLs. */

const ServerApi = (() => {
  function campaign() {
    const cm = typeof globalThis !== "undefined" ? globalThis.CampaignManager : null;
    return (cm && typeof cm.active === "function" && cm.active()) || null;
  }

  // Append ?campaign=<name> (or &campaign=) to a GET endpoint URL.
  function withCampaign(url) {
    const name = campaign();
    if (!name) return url;
    const sep = url.indexOf("?") >= 0 ? "&" : "?";
    return url + sep + "campaign=" + encodeURIComponent(name);
  }

  // Add a campaign field to a POST body object (an explicit field wins).
  function withCampaignBody(obj) {
    const name = campaign();
    if (!name) return obj;
    return Object.assign({ campaign: name }, obj);
  }

  return { campaign, withCampaign, withCampaignBody };
})();

if (typeof globalThis !== "undefined") globalThis.ServerApi = ServerApi;
if (typeof module !== "undefined" && module.exports) module.exports = ServerApi;
