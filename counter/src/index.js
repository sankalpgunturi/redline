// redline install counter. One number: real installs (people who ran the install command).
// Routes:
//   GET /i      -> increment, returns "ok"
//   GET /badge  -> shields.io endpoint JSON (for the README badge)
//   GET /       -> { installs: N } (for the website)
const CORS = { "access-control-allow-origin": "*" };

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);

    if (pathname === "/i") {
      // ponytail: KV is last-write-wins -> can drop a count under truly concurrent
      // writes. Fine for a launch counter; move to a Durable Object if exact.
      const n = (parseInt(await env.COUNTER.get("installs")) || 0) + 1;
      await env.COUNTER.put("installs", String(n));
      return new Response("ok", { headers: CORS });
    }

    const n = parseInt(await env.COUNTER.get("installs")) || 0;

    if (pathname === "/badge") {
      // cacheSeconds tells shields (and GitHub's camo proxy) to refresh sooner.
      return Response.json(
        { schemaVersion: 1, label: "installs", message: String(n), color: "red", cacheSeconds: 300 },
        { headers: { ...CORS, "cache-control": "max-age=300" } },
      );
    }
    return Response.json({ installs: n }, { headers: CORS });
  },
};
