// Cloudflare Worker entry point (Workers with static assets)
//
// This Worker sits in front of your static site. For every request it
// checks whether the path is our one API route (/turn-credentials); if so
// it handles that itself, otherwise it hands the request straight to the
// static asset server (env.ASSETS), which serves public/index.html and
// anything else in that folder.
//
// SETUP (one-time, in the Cloudflare dashboard for this Worker project):
//   1. Realtime -> TURN Server -> Create. Copy the "Turn Token ID" and the
//      "API Token" it shows you (the token is shown once).
//   2. This Worker's Settings -> Variables and Secrets -> Add:
//        TURN_KEY_ID          = the Turn Token ID          (Secret)
//        TURN_KEY_API_TOKEN   = the API Token               (Secret)
//   3. Push this file (plus wrangler.jsonc, .assetsignore, and
//      public/index.html) to the GitHub repo this Worker deploys from.
//      The next auto-deploy picks it up.
//
// If TURN_KEY_ID / TURN_KEY_API_TOKEN aren't set yet, /turn-credentials
// just returns an error and the game quietly falls back to the free public
// relay it already uses — nothing breaks while you're setting this up.
//
// Docs: https://developers.cloudflare.com/realtime/turn/generate-credentials/

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/turn-credentials') {
      return handleTurnCredentials(env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleTurnCredentials(env) {
  const { TURN_KEY_ID, TURN_KEY_API_TOKEN } = env;

  if (!TURN_KEY_ID || !TURN_KEY_API_TOKEN) {
    return jsonResponse({ error: 'turn_not_configured' }, 500);
  }

  try {
    const upstream = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TURN_KEY_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        // 1 hour is plenty for a single game session; credentials are cheap
        // to re-mint, so we keep the lifetime short on purpose.
        body: JSON.stringify({ ttl: 3600 })
      }
    );

    if (!upstream.ok) {
      return jsonResponse({ error: 'upstream_error', status: upstream.status }, 502);
    }

    const data = await upstream.json();
    return jsonResponse(data, 200);
  } catch (err) {
    return jsonResponse({ error: 'fetch_failed' }, 502);
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Credentials are short-lived and per-request; never cache them.
      'Cache-Control': 'no-store'
    }
  });
}
