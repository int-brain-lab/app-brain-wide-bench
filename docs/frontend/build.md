# Frontend build

How `frontend/` becomes what the server sends. Live since September 2026.

Background — the measurements, the options weighed, and what was ruled out — is in
`docs/frontend_bundle_plan_todo.md`.

## What it does

Vite bundles each HTML page's module graph into minified, content-hashed chunks. A page that
loaded 72 separate ES modules over a four-deep import waterfall now loads two or three chunks,
and on a second visit loads none.

Rollup hoists what the pages share — `navTop.js`, `navSide.js`, most of `js/core/` — into
common chunks, so they are fetched once for the whole site rather than per page. Vite emits the
`<link rel="modulepreload">` tags that keep the chunk graph one round trip deep.

## The source does not change

`frontend/js/` is plain browser ES modules: no bare specifiers, no `import.meta.env`, no
dynamic `import()`. The CDN libraries (Auth0, Tabulator, Chart.js, Lucide) are read as globals
from `<script src="https://…">` tags, never imported, so the bundle has no externals.

Development runs against the source and needs no build:

```bash
cd frontend && python -m http.server 8080
```

`npm run build` then `npm run preview` checks the bundle itself, which is worth doing before a
deploy but is not part of the edit loop.

## The pieces

| File | Does |
| --- | --- |
| `frontend/vite.config.js` | lists the HTML entries, turns on sourcemaps |
| `Dockerfile` | a `node:22-alpine` stage runs the build; the runtime image gets `dist/` |
| `Dockerfile.dockerignore` | prunes the build context, which is the parent directory |
| `app/main.py` | `StaticCacheMiddleware` — `immutable` for `/assets/`, `no-cache` for the rest |
| `nginx/nginx.conf` | `gzip` and `http2 on`, which the bundle rides on top of |

Entry points are discovered, not listed: `index.html` plus everything under `html/`. A new page
needs no config change.

Node exists only in the build stage. Nothing npm-managed reaches the browser and no Node
process runs in production.

## Why the caching is safe

HTML is always `no-cache`, so a reader gets the fresh document; the fresh document names the
chunk hashes; the chunks are `immutable` because a new build renames them rather than
overwriting. Page and chunks are therefore chosen together, and a deploy can never serve a
half-old mixture.

That mixture is the failure the unbundled tree could produce: a cached module importing a
symbol a freshly-fetched sibling no longer exports is a `SyntaxError` and a blank page.

## What this changes for you

- **`dist/` is never committed.** It is gitignored, dockerignored, and rebuilt in the image.
- **A frontend error can now fail a deploy.** The image build aborts before the migration and
  before the container swap, so the running site is untouched — but the error appears in
  `docker compose` output. `npm run build` locally first.
- **An unresolvable import is now fatal.** Unbundled it was a 404 on one module; Rollup treats
  it as a build error.
- **`nginx.conf` needs an explicit reload.** It is bind-mounted, so `docker compose up -d` sees
  no spec change and leaves the running config in memory:

  ```bash
  docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
  ```

## Verifying a deploy

```bash
SITE=https://brainwidebench.iblcore.org

curl -sI $SITE/html/models/models.html | grep -i cache-control   # no-cache
curl -s  $SITE/html/models/models.html | grep -o '/assets/[^"]*' # hashed chunks
curl -sI $SITE/js/pages/modelView.js | head -1                   # 404 — the source tree is gone

ASSET=$(curl -s $SITE/html/models/models.html | grep -o '/assets/[^"]*\.js' | head -1)
curl -sI -H 'Accept-Encoding: gzip' "$SITE$ASSET" | grep -iE 'cache-control|content-encoding'
```

In a browser, a hard reload should issue no `/js/…` request, and a second navigation no
JavaScript request at all.

## Rolling back

Revert the two lines in the Python stage of the `Dockerfile` (`rm -rf frontend` and the
`COPY --from`) and the `/assets/` branch in the middleware, then rebuild. The image serves the
source tree again and the next request names the unhashed `/js/` paths. Chunks left in browser
caches keep their expiry but nothing references them. No database schema is involved.
