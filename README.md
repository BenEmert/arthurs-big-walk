# Arthur's Big Walk 🐕

A browser-based endless runner starring Arthur the dog. Jump and duck your way
down an LA sidewalk, collect treats, and go as far as you can. No installs, no
build step — one HTML file, one JS file, runs anywhere.

## Play locally

Option 1 — just open the file: double-click `index.html`.

Option 2 — serve it (matches how GitHub Pages serves it):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

To test from other devices on the same wifi (phones included), find this
machine's local IP (`ipconfig getifaddr en0` on macOS) and open
`http://<that-ip>:8000` on the other device while the server is running.

## Controls

| Action | Keyboard | Touch |
|--------|----------|-------|
| Jump | Space / ↑ / W | Tap |
| Duck (hold) | ↓ / S | (coming with the touch-controls pass) |
| Start / restart | Space | Tap |

The game pauses automatically when you switch tabs.

## Deploying to GitHub Pages (first-time walkthrough)

GitHub Pages hosts static sites for free, straight from a repository. Once set
up, updating the live game is just `git push`.

1. **Create the repository.** On [github.com](https://github.com), click **+ →
   New repository**. Name it (e.g. `arthurs-big-walk`), leave it **Public**
   (Pages on a free account requires a public repo), and create it without any
   starter files if you're pushing an existing folder.

2. **Push the project.** From this folder:

   ```bash
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```

   (Skip the `remote add` if the remote is already configured.)

3. **Enable Pages.** In the repository on GitHub: **Settings → Pages** (left
   sidebar). Under **Build and deployment**, set **Source** to *Deploy from a
   branch*, choose branch **`main`** and folder **`/ (root)`**, then **Save**.

4. **Visit your game.** After a minute or two it will be live at:

   ```
   https://<your-username>.github.io/<repo-name>/
   ```

   The first deploy can take a few minutes; check the **Actions** tab to watch
   it build.

5. **Updating the live site.** Commit and push — that's it. Changes appear at
   the same URL after a short delay (hard-refresh with Cmd+Shift+R if you see
   a stale version).

### Practical caveats

- **The repo and site are public.** Anything pushed — including the Arthur
  photos in `assets/photos/` — is visible to anyone. Local-only reference
  material lives in `assets/reference/`, which is gitignored and never pushed.
- **Scores don't sync.** The high score (and later unlocks) live in your
  browser's `localStorage` — per browser, per device. Playing on your phone
  and your laptop keeps two separate bests.

## Project structure

```
index.html    canvas + page styling + bootstrap
game.js       constants, game loop, entities, rendering
assets/
  sprites/    game sprite sheets — Arthur, obstacles, treats, scenery (deployed)
  photos/     Arthur photos shown on menu/game-over screens (deployed)
  reference/  local-only sprite sources + generator scripts (gitignored)
```

## Development notes

- All gameplay tuning lives in the constants block at the top of `game.js`
  (`// TODO: tune` marks the deliberate balance knobs).
- Dev helper: append `?start=600` to the URL to begin runs at 600m — useful
  for testing distance-gated obstacle unlocks without playing there.
