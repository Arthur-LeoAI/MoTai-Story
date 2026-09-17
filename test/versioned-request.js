// Existing lifecycle tests use the current version; concurrency tests send raw requests.
async function versionedOptions(baseUrl, pathname, options) {
  if (["PATCH", "DELETE"].includes(options.method) && /^\/api\/works\/[^/]+\/chapters\/[^/]+$/.test(pathname)) {
    const body = JSON.parse(options.body || "{}");
    if (body.baseRevision === undefined) {
      const workUrl = pathname.split("/").slice(0, 4).join("/");
      const { work } = await (await fetch(baseUrl + workUrl)).json();
      body.baseRevision = work?.chapters.find(c => c.id === pathname.split("/")[5])?.revision;
      return { ...options, body: JSON.stringify(body) };
    }
  }
  return options;
}
module.exports = { versionedOptions };
