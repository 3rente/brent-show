# brent-show

> **© 2026 Brent Eliason. All rights reserved. Not open source.** This code and its assets are public only so they can be
> served to brenteliason.com. Copying, reuse, redistribution, and use for training or improving AI/machine-learning
> models are not permitted. See [LICENSE](LICENSE). Map data credits are listed in section 4 of the LICENSE.

The hero, night drone show, orbit transition and career stories for brenteliason.com,
packaged to run inside Squarespace from GitHub Pages.

## Files
- `brent-show.js` — everything: markup, styles, animation. Mounts into `<div id="brent-show">`.
- `assets/` — portrait + depth map, drone formation, earth coastlines/lakes/city lights.
- `index.html` — standalone preview of exactly what Squarespace loads.

## 1. Publish on GitHub Pages
1. On GitHub: **New repository** → name it `brent-show` → **Public** → Create.
2. **Add file → Upload files** → drag in everything from this folder (keep the `assets` folder) → **Commit changes**.
3. **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main** / **(root)** → **Save**.
4. After about a minute, open `https://YOUR-USERNAME.github.io/brent-show/` — you should see the full page.

## 2. Add it to Squarespace (Core / Plus / Advanced, or legacy Business+)
1. Edit your home page → **Add Section** at the very top → choose a blank section.
2. Add a **Code** block to that section and paste:

```html
<div id="brent-show" data-accent="#FF5B1F"></div>
<script src="https://YOUR-USERNAME.github.io/brent-show/brent-show.js?v=1" defer></script>
```

3. Make sure **Display Source** is off → **Save** the page.
4. Open the live site (or Preview). Scripts don't always run inside the Squarespace editor itself.

What the script does on its own:
- Moves itself in front of that section and hides the section, so Squarespace's padding and grid can't clip it.
- Hides the template header and footer on that page (its own nav and footer replace them). Keep them with `data-hide-header="false"` or `data-hide-footer="false"`.
- Loads its fonts from Google Fonts.

Everything below that section stays normal, editable Squarespace content.

## Updating
Replace `brent-show.js` (or an asset) in the repo, then bump the version in the snippet (`?v=2`) so visitors get the new file
right away — GitHub Pages caches for about 10 minutes.

## Editing in Squarespace
While you edit the page, the show steps aside and the Code Block appears as a dashed placeholder
("BRENT SHOW · …"). Click it to change the snippet. The animation comes back when you leave edit mode.
If the editor ever has trouble, open the page with `?brentshow=off` at the end of the URL to turn the show off.
