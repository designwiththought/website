# Architecture

A reference for how this site is actually built. Written for the maintainer (me, in six months) so a small change doesn't require re-reading `build.js` from line one.

The public-facing version of this is the `Building this site` series on the colophon. This document is the internal companion: more mechanical, more file paths, fewer essays.

---

## 1. Philosophy in one paragraph

Node standard library only. One `build.js` file. Plain HTML out. Content is markdown with frontmatter. CSS is hand-written, token-driven, in three layers. JavaScript is small enhancers, one file per concern. Deploy is GitHub Pages, triggered by a single workflow on push to `main`. If something looks complicated, it's worth questioning.

The core rules:

- **No npm dependencies.** `package.json` is intentionally bare.
- **No bundler, no framework.** Source files ship.
- **No build-time code splitting, no client-side router.** The browser asks for `/notes/` and the server returns `dist/notes/index.html`.

---

## 2. Repository layout

```
website/
  build.js                     the whole build pipeline
  serve.js                     dev server (static, port from env)
  package.json                 minimal — no dependencies
  ARCHITECTURE.md              this file
  docs/                        other reference docs
  .github/workflows/pages.yml  CI: build + deploy on push to main

  src/
    site.json                  site-wide metadata (title, owner, email)
    nav.json                   drawer + footer nav config (see §10)
    layouts/                   HTML templates with {{...}} placeholders
    components/                MDX components (one HTML file each)
    content/
      site.json                site-wide constants
      nav.json                 nav config
      about.json               structured About page data
      colophon.json            structured Colophon page data
      now.json                 Now page state
      learning.json            Learning topics + resources
      gear.json                Gear list
      articles/                essays + studies + build series (.mdx)
      notes/                   short notes (.mdx, text or image)
      projects/                project case studies (.mdx)
      reading/                 reading items (.mdx)
      music/                   album entries (.mdx)
      movies/                  movie diary (.mdx)
      podcasts/                podcast entries (.mdx)
      bookshelf/               permanent-shelf books (.mdx)
      products/                product picks (.mdx)
    css/
      tokens.css               foundations: palette, type, scale, motion
      kit.css                  components: buttons, cards, nav, etc.
      site.css                 page-specific styles, layout, hero, etc.
    js/
      theme.js                 light/dark toggle + storage
      nav.js                   drawer dialog, focus trap, escape close
      texture.js               paper-grain scroll fade (see §9.4)
      tag-filter.js            client-side tag filter on index pages
      accessibility.js         reserved
      floorboards.js           reserved
    feed.xsl                   styled XSL preview for the Atom feeds

  dist/                        built site, written fresh per build
```

`dist/` is gitignored in spirit but currently committed (so GitHub Pages doesn't have to rebuild). The CI workflow always overwrites it.

---

## 3. The build pipeline

`build.js` is one async function organised top-to-bottom. The numbered sections inside the file mirror this list. To trace a bug, find the section that emits the broken URL.

1. **Read site/nav/about/now/learning/gear/colophon JSON.**
2. **Render drawer + footer HTML from `nav.json`** (see §10). Stashed on `siteData.drawerNavHtml` and `siteData.footerNavHtml`.
3. **Read all content directories** via `parseMdxDir(...)`.
4. **Pre-render derived fields** — work highlights, learning resource lists, reading status labels, movie star ratings, product URL hosts.
5. **Partition articles** into `essays`, `studies`, and `buildSeries` by `kind` (see §5.1).
6. **Group articles by `series:`** field and pre-render the series nav + prev/next blocks (see §11).
7. **Pre-render the grouped notes list** (`homeNotesHtml`) for the home page and the notes index. Handles both text notes and image notes (see §5.3).
8. **Build the home page** (`/index.html`) — currently the hero + notes.
9. **Build the notes index and per-note readers** (`/notes/`, `/notes/<slug>/`).
10. **Build writing indexes and readers** (essays + studies + build series). The build series uses the same article layout but routes to `/build/<slug>/` and links back to `/colophon/`.
11. **Build the projects index** at `/projects/`, the **category indexes** at `/projects/cat/<slug>/`, and **per-project case-study pages**.
12. **Build the enjoying section**: per-kind indexes (reading, music, movies, podcasts, bookshelf, products), per-item reader pages, the aggregate `/enjoying/` index.
13. **Build flat content pages**: about, now, learning, gear, colophon. Colophon embeds the build-series list (`buildSeriesHtml`).
14. **Build the design-system page** at `/styles/`.
15. **Build the Atom feeds** at `/feed.xml` plus per-section feeds (`/essays/feed.xml`, etc.).
16. **Copy assets** from `src/assets/` to `dist/assets/`.
17. **Write the CSS bundle** at `dist/css/style.css` by concatenating `tokens.css` + `kit.css` + `site.css`.
18. **Write the JS bundle** at `dist/js/main.js` by concatenating every file in `src/js/`.

Total runtime: ~250–600ms on a laptop. The build is intentionally fast enough that there's no watch mode — re-run `node build.js` when content changes.

---

## 4. Content model

### 4.1 Frontmatter

Every `.mdx` file opens with YAML between two `---` lines. The parser handles strings, numbers, booleans, and arrays of objects (for `toc:`). Common fields:

| Field | Used by | Notes |
|-------|---------|-------|
| `slug` | All | URL segment. Required. |
| `title` | All | Display title. |
| `summary` | Most | One-sentence dek under the title. |
| `date` | Articles, notes | Human date like `01 January 2026`. |
| `read` | Articles | Reading time, e.g. `5 min`. |
| `kind` | Articles | `Essay`, `Study`, or `Build series`. Routes the page. |
| `tag1`, `tag2`, `tag3` | Articles, projects | Up to three tags. Used in indexes + filters. |
| `toc` | Articles | Array of `{id, label}` for the in-page TOC. |
| `series` | Articles | Series label (any string). Triggers series UI. |
| `seriesPart` | Articles | Order within the series (number). |
| `category` | Projects | One of `Code`, `Design`, `Accessibility`, `Hardware`, `Experiments`. |
| `status` | Projects | `In progress` / `Ongoing` / `Maintained` / `Shipped` / `Paused`. |
| `month` | Notes | Used to group notes in the index. |
| `context` | Notes | Italic kicker beneath the body. |
| `image` | Notes | URL for an image note. |
| `imageAlt` | Notes | Required when `image` is set. |
| `caption` | Notes | Optional caption beneath the image. |

### 4.2 MDX components

Four custom tags are recognised in article bodies. Each maps to `src/components/<Name>.html` with `{{prop}}` placeholders.

- `<Dropcap text="…" />` — display-typeface initial on the opening paragraph.
- `<Pullquote text="…" cite="…" />` — bordered quote with attribution.
- `<PullquoteNoCite text="…" />` — same, no attribution.
- `<MarginaliaPin text="…" />` — small note in the right gutter on wide viewports.

To add a new component: drop `src/components/<Name>.html` with the placeholders, then reference it as `<Name prop="value" />` in MDX. No code change needed in `build.js`.

### 4.3 Notes can be text or image

A note's body is text by default. If the frontmatter has `image:` (and `imageAlt:`), the row renders a `<figure>` instead. If both an `image:` and a body are present, the first body paragraph becomes the caption.

---

## 5. Article kinds and routing

`kind:` in article frontmatter drives where the page lives.

| `kind:` | Route | Index |
|---------|-------|-------|
| `Essay` (default) | `/essays/<slug>/` | `/essays/` |
| `Study` | `/studies/<slug>/` | `/studies/` |
| `Build series` | `/build/<slug>/` | linked from `/colophon/` |

Build-series posts also carry `series: "Building this site"` and `seriesPart: 1..5`, which triggers the series UI. They use the same article layout (`article.html`) and the same `buildWritingReader` function — only the directory and the back-link change.

---

## 6. The template engine

`renderTemplate(template, data)` lives at the top of `build.js`. Three constructs, three passes, all looped until stable.

### 6.1 Constructs

```handlebars
{{key}}                          simple substitution
{{a.b.c}}                        nested path
{{#each list}}…{{/each}}         loop
{{#if key}}…{{/if}}              conditional
```

That's the whole syntax. No filters, no partials, no escaping helpers. Whatever needs to be more complex is done in JS and passed in as an already-rendered HTML string.

### 6.2 Three passes

1. **`{{#each}}`**, innermost first, looped until no `each` blocks remain.
2. **`{{#if}}`**, same shape — innermost first, looped until stable.
3. **`{{key}}` / `{{a.b.c}}`**, looped until output stops changing.

The two looping properties exist for real reasons:

- **Nested `{{#if}}` requires innermost-first.** A naive non-greedy regex grabs the first `{{/if}}` it sees, which is the inner close on a nested block, leaving the outer close orphaned. Inside notes/image conditionals this was visibly broken; the fix is the regex pattern `(?:(?!\{\{#if\s)[\s\S])*?` for the body and a `do…while` that keeps re-running until the output stops changing.
- **Looping the simple-key pass** is what makes injected HTML resolve transitively. The drawer is built from `nav.json` as an HTML string containing `{{basePath}}`, then injected into pages via `{{drawerNavHtml}}`. Without the loop, `{{basePath}}` would ship literally to the browser. (This caused the `%7B%7BbasePath%7D%7Dnotes/` URL leak.)

---

## 7. The markdown parser

`parseMarkdown(md)` is a line-by-line state machine. Handles:

- Headings (`# … ######`) — `id` slugified from the text so TOC anchors work.
- Paragraphs.
- Unordered lists (`-` or `*`).
- Blockquotes (`> `).
- Horizontal rules (`---`).
- Fenced code blocks (` ``` `), with optional language tag. Content is HTML-escaped before being emitted inside `<pre><code class="language-xxx">…</code></pre>`.
- Inline: `**bold**`, `*italic*`, `` `code` ``, `[link](url)`.
- Raw HTML / JSX-style component tags at the start of a line — emitted verbatim so block components don't get wrapped in `<p>`.

What it doesn't handle: ordered lists, nested lists, tables, images, footnotes (those use `<Footnote>` component shorthand instead), reference-style links.

---

## 8. CSS architecture

Three files, concatenated into `dist/css/style.css` at build time.

### 8.1 `tokens.css` — foundations

- **Palette**, in OKLCH, with semantic aliases (`--bg`, `--fg`, `--accent`, etc).
- **Type scale**, sizes named `--t-h1` through `--t-micro`.
- **Spacing scale**, `--s-1` through `--s-11` in 4/8px steps.
- **Radii**, `--r-1` through `--r-card`.
- **Shadows**, mostly `none` in this design.
- **Motion** (`--ease-out`, `--dur-fast`).
- **Paper grain SVG** in `--paper-noise` and `--paper-flecks`.

Dark mode overrides the same custom properties under `[data-theme="dark"]`.

### 8.2 `kit.css` — components

The reusable patterns: `.btn`, `.tag`, `.kicker`, `.input`, `.essay-card`, `.project-tile`, `.note-item`, `.site-nav`, `.site-footer`, `.subscribe-card`, `.reader`. BEM-ish: `.essay-card__title`, `.note-item__figure`. No utility classes.

### 8.3 `site.css` — page-specific

The hero, the page header, sections, the grids, per-page blocks (CV, work history, podcasts grid, music shelf, movie diary), the drawer, the series nav, the build-series list, the code block surface, the paper grain layers (`body::before`, `body::after`), the glass nav.

### 8.4 Code blocks

`--bg-code` is a separate token from `--bg-sunken` (slightly darker warm cream / slightly lighter warm ink). Inline `code` and `pre` both sit on this surface. `pre` gets a hairline border and a 3px `--accent-soft` left rule. No syntax highlighting.

### 8.5 Paper grain

Two fixed full-viewport layers behind everything, `body::before` (broad grain) and `body::after` (sparse darker flecks). Driven by SVG `feTurbulence` + `feComponentTransfer` to threshold the alpha into discrete specks. Opacity is controlled by `--grain-opacity`, written every frame by `texture.js` from smoothed scroll velocity, so the grain dims during scroll and breathes back when motion stops. `prefers-reduced-motion: reduce` hides the layers entirely.

### 8.6 Glass nav

`.site-nav` is a full-width sticky strip with `backdrop-filter: blur(14px) saturate(140%)` over a 62% translucent `--bg`. Content stays in the 720px column via a `.site-nav__inner` wrapper. A `.site-nav::after` band just below the bar runs its own smaller `backdrop-filter: blur(6px)` with a top-to-bottom mask, so content scrolling under the bar passes through a soft blur ramp instead of a hard line.

---

## 9. JavaScript

Each file is wrapped in an IIFE, attaches its listeners on `DOMContentLoaded`, and bails early if the elements it expects aren't on the page. All files are concatenated into `dist/js/main.js` at build time.

### 9.1 `theme.js`

Reads `dwt-theme` from `localStorage`, sets/removes `data-theme="dark"` on `<html>`. Toggle button is `#theme-toggle`. Applies the theme synchronously before `DOMContentLoaded` to avoid a flash.

### 9.2 `nav.js`

Wires `#menu-open` to open `#site-menu-dialog` (the drawer), marks background siblings `inert`, focuses the dialog heading, traps tab focus, closes on `Esc` or `#menu-close`. Bails if `#menu-open` is missing.

### 9.3 `tag-filter.js`

On any index page with `[data-tags]` items and a `.filter-bar`, filters by tag without a reload.

### 9.4 `texture.js` — paper-grain fade

Samples scroll velocity per event, exponentially smooths it (`SMOOTH_IN`), and writes `--grain-opacity` on `<body>` each animation frame. A `requestAnimationFrame` loop decays the smoothed velocity (`SMOOTH_OUT`) once events stop. The grain dims toward `MIN_OPACITY` during motion and eases back to 1 over a few seconds.

Tunables at the top of the file:

```js
var MIN_OPACITY = 0.3;
var VEL_TO_FADE = 0.3;
var SMOOTH_IN = 0.06;
var SMOOTH_OUT = 0.97;
```

Bails entirely if `prefers-reduced-motion: reduce`.

### 9.5 `accessibility.js`, `floorboards.js`

Reserved placeholders. Kept so the concat order stays stable.

---

## 10. Nav configuration (`nav.json`)

The single source of truth for what appears in the drawer and the footer. Each item has an `enabled` flag.

```json
{
  "groups": [
    {
      "id": "writing",
      "label": "Writing",
      "items": [
        { "label": "Notes",   "href": "notes/",   "note": "Fragments",     "enabled": true  },
        { "label": "Essays",  "href": "essays/",  "note": "The long ones", "enabled": false }
      ]
    }
  ],
  "footerExtras": [
    { "label": "RSS",   "href": "feed.xml" },
    { "label": "Email", "href": "mailto:{{email}}" }
  ]
}
```

`build.js`'s `renderDrawerNav()` and `renderFooterNav()` walk the groups, filter by `enabled`, and emit HTML containing `{{basePath}}` (which the template engine resolves per-page). A group with zero enabled items is dropped entirely so no orphan headings appear.

Pages still build whether or not they're in the nav — disabling a route only removes it from the menus. Direct URLs continue to work, so deferred pages can be shared as preview links.

The current launch set is **Home, Now, Notes, About, Colophon**. Everything else is `"enabled": false`.

---

## 11. The series concept

Series is a structural relationship between articles — parts of one piece. Distinct from `tags` (topical) and the related-articles block ("you might also like").

Any article can opt into a series:

```yaml
series: "Building this site"
seriesPart: 3
```

Articles sharing a `series:` value are grouped and sorted by `seriesPart`. The article reader for a series article gets two new blocks:

- **Series TOC** at the top of the body — every part listed, current marked with "You are here" and rendered as a non-link.
- **Prev/Next** at the bottom — walks the series linearly, omits prev on first part and next on last.

When an article is in a series, the existing related + read-next blocks are suppressed. The series replaces them.

Build series posts (`kind: "Build series"`) all set `series: "Building this site"`. Future essays can use the same machinery for any multi-part piece.

---

## 12. Deploy

Single workflow file at `.github/workflows/pages.yml`. On push to `main`:

1. Checkout.
2. Install Node 20.
3. `node build.js` (no `npm install` first — there's nothing to install).
4. Upload `dist/` as a Pages artifact.
5. Deploy the artifact to Pages.

Typical end-to-end: ~35 seconds. Build itself is sub-second.

No dependency cache (nothing to cache). No preview deploys (no fork PRs). No CI link/a11y/Lighthouse check (audited manually). No CDN-purge step (Pages handles it).

---

## 13. Common tasks

### 13.1 Add an essay

```
src/content/articles/NN-my-essay.mdx
```

Frontmatter: `slug`, `kind: Essay`, `title`, `summary`, `date`, `read`, optional `tag1/2/3`, optional `toc`. Run `node build.js`. New page appears at `/essays/<slug>/`.

To make it visible in the launch nav, also flip `Essays` to `"enabled": true` in `nav.json`.

### 13.2 Add a note (text or image)

```
src/content/notes/NN-my-note.mdx
```

Text note: `slug`, `date`, `month`, `title`, optional `context`, body in markdown.

Image note: same plus `image:` (URL), `imageAlt:`, optional `caption:`. Body is optional.

### 13.3 Add a project

```
src/content/projects/NN-my-project.mdx
```

Frontmatter: `slug`, `title`, `summary`, `kind: Project`, optional `category` (Code/Design/Accessibility/Hardware/Experiments), `status`, `year`, `tag1/2/3`. Lands at `/projects/<slug>/` and appears on `/projects/`. With a category set, also appears on `/projects/cat/<slug>/`.

### 13.4 Change a colour or type token

Edit the relevant custom property in `src/css/tokens.css`. The dark-mode override under `[data-theme="dark"]` lives in the same file.

### 13.5 Flip a nav item on or off

Edit `enabled` in `src/content/nav.json`. Build.

### 13.6 Add a new series

In each piece of the series, set `series: "Series name"` and `seriesPart: N`. The series UI appears automatically; no code change needed.

### 13.7 Add a new MDX component

Create `src/components/<Name>.html` with `{{prop}}` placeholders. Reference it as `<Name prop="value" />` in any MDX body.

### 13.8 Tune the paper grain

Two SVG tokens in `tokens.css`: `--paper-noise` (broad) and `--paper-flecks` (sparse darker specks). Both use a `feComponentTransfer` discrete table to threshold the alpha. More non-zero entries = denser. Higher peak values = stronger specks. Light + dark have separate definitions.

### 13.9 Tune the grain's scroll fade

Tunables at the top of `src/js/texture.js`: `MIN_OPACITY`, `VEL_TO_FADE`, `SMOOTH_IN`, `SMOOTH_OUT`. CSS transition on the layers is 180ms linear — the JS smoothing is what makes the fade gradual.

---

## 14. Known quirks and lessons

- **Template engine needs to loop simple substitutions.** An interpolation that injects HTML containing further `{{...}}` placeholders won't resolve in one pass. The `do…while` loop in `renderTemplate` handles this.
- **Nested `{{#if}}` and `{{#each}}` need innermost-first matching.** A negative lookahead `(?:(?!\{\{#if\s)[\s\S])*?` in the body of the regex pattern restricts each match to a block without further nesting; loop until stable.
- **CSS grid `1fr` carries implicit `min-width: min-content`.** An image inside a grid cell expands the cell to the image's intrinsic width unless you use `minmax(0, 1fr)` and put `min-width: 0` on the body cell. This bit the image-note row.
- **Fixed-position noise behind moving content triggers motion sickness.** The grain fade in `texture.js` is not cosmetic — it's an accessibility default, with a hard opt-out under `prefers-reduced-motion`.
- **GitHub Pages CDN can hold the previous version at the edge for a few minutes** after a deploy. If something looks wrong right after a push, hard-refresh and wait before debugging.
- **Don't put hashed filenames on `style.css` / `main.js`** unless you also expose a stable alias. Stable URLs are how the site can be referenced from external tools (Figma code layers, embeds) without rewriting.

---

## 15. The reading order

If a new person inherits this repo, the order I'd hand them:

1. This file.
2. `docs/GETTING_STARTED.md`.
3. `build.js`, top to bottom.
4. `src/css/tokens.css`, then `kit.css`, then `site.css`.
5. The Build series essays at `/build/building-this-site-N-…/`.

Total reading time: about an hour. After that they should be able to fix anything in here without asking.
