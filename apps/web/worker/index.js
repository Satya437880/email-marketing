// Runs on Cloudflare in front of the website. Page and file requests are answered from the built site (the "dist" folder);
// requests for /v1 (the app's data), /t (open/click tracking) and /u (unsubscribe) are passed on to the API server.
// Set API_ORIGIN (in wrangler.jsonc, or as a variable in the Cloudflare dashboard) to the public address of the API.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = (env.API_ORIGIN || "").replace(/\/+$/, "");
    if (!origin || origin.includes("REPLACE-WITH")) {
      return new Response("The API address is not set yet. Set the API_ORIGIN variable for this site.", { status: 503 });
    }
    // Same path and query, same method, headers and body; only the address changes.
    const upstream = new Request(origin + url.pathname + url.search, request);
    upstream.headers.set("x-forwarded-host", url.host);
    upstream.headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
    return fetch(upstream, { redirect: "manual" });
  },
};
