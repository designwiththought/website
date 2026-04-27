# Getting started

A walkthrough for filling this site with your own content. The placeholder
files at `src/content/**` show every supported shape — read alongside this doc.

## Run it

```sh
node build.js   # one-shot build → dist/
node serve.js   # dev server on http://localhost:3000 with watch + live reload
```

Requires Node 18+. No `package.json`, no dependencies. The whole pipeline is in
`build.js` (~1100 lines, two `require`s: `fs`, `path`).

## Where things live

```
src/
├─ content/         your content
│  ├─ articles/     essays + studies (kind: Essay or Study in frontmatter)
│  ├─ notes/        short fragments, grouped by month
│  ├─ projects/     case studies for things you've made
│  ├─ reading/      books — currently reading / queued / finished
│  ├─ music/        albums that mattered
│  ├─ movies/       a viewing diary
│  ├─ podcasts/     in rotation
│  ├─ bookshelf/    permanent shelf, grouped by section
│  ├─ site.json     title, name, email, hero aside, homepage reading strip
│  ├─ now.json      what you're up to this month (/now/)
│  ├─ about.json    portrait initials, work history, elsewhere links (/about/)
│  ├─ learning.json topics + resources (/learning/)
│  ├─ gear.json     gear by section (/gear/)
│  └─ colophon.json site credits (/colophon/)
├─ layouts/         html templates with {{var}}, {{#each}}, {{#if}}
├─ components/      MDX component templates (Dropcap, Pullquote, MarginaliaPin, Footnote)
├─ css/             tokens.css → kit.css → site.css, concatenated into one bundle
└─ js/              theme, drawer, tag filter, etc. — concatenated into one bundle
```

## Add a piece of writing

Drop a new MDX file in `src/content/articles/`. Filename is sorted, the prefix
controls position. Example:

```md
---
slug: a-thing-i-noticed
kind: Essay
title: "A thing I noticed"
summary: "One-sentence preview."
date: "12 January 2026"
read: "6 min"
tag1: "Craft"
tag2: "Notes"
toc:
  - id: "first-section"
    label: "First section"
---

<Dropcap text="Your opening paragraph. Becomes a drop-cap rendering." />

Body markdown. Headings (`## First section`) auto-slug to `id` anchors that the
toc array refers to.
```

`kind: Essay` lands at `/essays/<slug>/`; `kind: Study` lands at `/studies/<slug>/`.
Both surface on the homepage's "Recent writing" grid. Tags become real per-tag
pages at `/essays/tag/<slug>/` (and `/studies/tag/<slug>/`) automatically.

### MDX components

- `<Dropcap text="…" />` — drop cap opener.
- `<Pullquote text="…" cite="…" />` — pull quote with attribution.
- `<PullquoteNoCite text="…" />` — pull quote without a cite line.
- `<MarginaliaPin text="…" rotate="-3" />` — handwritten margin note that floats
  in the right gutter at viewport widths above 1200px.
- `<Footnote id="1" text="…" />` — inline footnote reference.

Components are resolved before the markdown parser runs, so they can't be wrapped
in `<p>` tags accidentally.

## Add a note

```md
---
slug: a-fragment
date: "Jan 12"
month: "January 2026"
title: "A fragment"
context: "where it was written"
---

The body of a note. The first paragraph becomes the lede on the reader; the
rest are the afterthought.
```

The four most-recent notes appear on the homepage's "From the notebook"
section. The full list is at `/notes/`, grouped by `month:`.

## Add a project

```md
---
slug: a-thing-im-building
title: "A thing I'm building"
summary: "One-sentence blurb."
kind: "Project"
plate: "cocoa"           # cocoa | terra | moss | honey
glyph: "A"
label: "Project type"
status: "§ In progress"  # In progress | Ongoing | Maintained = appears on homepage
year: "2026"
tag1: "Craft"
---

## Premise

Body markdown.
```

Projects live at `/projects/<slug>/`. Active projects (status contains
`In progress`, `Ongoing`, or `Maintained`) appear in the homepage's
"Currently building" stack.

## Add a cultural item

Reading, music, movies, podcasts, and bookshelf each have their own MDX directory
and their own per-kind index page. They also aggregate into `/enjoying/`,
which paginates at 12 per page.

Frontmatter shapes — see the placeholder files for full examples:

| Kind       | Required fields                                                                |
|------------|--------------------------------------------------------------------------------|
| Reading    | `slug, kind: Reading, status (now\|next\|done), title, author, spine, note`     |
| Music      | `slug, kind: Music, year, title, artist, tag, note`                            |
| Movies     | `slug, kind: Movie, date, title, year, director, rating (0-5), note`           |
| Podcasts   | `slug, kind: Podcast, title, host, status, note`                               |
| Bookshelf  | `slug, kind: Bookshelf, section, title, author, year, note`                    |

`/reading/` groups by `status:`. `/bookshelf/` groups by `section:`. Sections
render in the order they first appear in the file numbering.

## Add a product

Products are external links — things you'd recommend, with a hero image, a
short note, and a "Buy from …" button that opens the source page in a new
tab. They live at `/products/` and `/products/<slug>/`.

```md
---
slug: a-thing-i-like
title: "A thing I like"
url: "https://example.com/products/the-thing"
imageUrl: ""                 # optional manual override
imageAlt: "A photo of the thing on a desk."
price: "$120"                # optional
note: "One-sentence preview."
tag1: "Tool"
---

Optional longer commentary.
```

### How the image works

On every build, `build.js` walks each product MDX file and tries, in order:

1. **A cached image on disk.** If `src/assets/products/<slug>.<ext>` already
   exists (committed alongside the rest of the site), use it. Skip the fetch.
2. **An explicit `imageUrl`.** If frontmatter sets it, fetch that URL and
   save it to the cache path above.
3. **`og:image` from the product URL.** Fetch the product page, parse it for
   `<meta property="og:image">` (then `twitter:image`, then the first `<img>`),
   fetch that, save it to the cache path.

If all three fail (HTTP 403 from a Cloudflare-protected site, no `og:image`,
broken image URL, network timeout) the build prints a warning that names the
exact path you should drop a file at, and the page renders with a paper-coloured
placeholder showing the title:

```
[products] could not fetch image for "a-thing-i-like": HTTP 403
           Add one manually at src/assets/products/a-thing-i-like.{jpg,png,webp}
           and the next build will pick it up.
```

So the failure mode is just a one-step fix: save your own image at the named
path, run the build again, image appears. The cache file is committed, so the
fetch only ever runs once per product.

## Edit the structured pages

`/now/`, `/about/`, `/learning/`, `/gear/`, and `/colophon/` are driven by their
matching JSON files in `src/content/`. Edit the JSON, run the build, the page
updates. The placeholder files show the expected shape.

`site.json` carries the global metadata: site title, your name and email, the
hero aside on the homepage, and the three-book reading strip beneath
"On the shelf, this month". The hero aside lets you change what the homepage
says about your current Writing / Building / Reading without redeploying any
MDX.

## Add a tag

Tags are derived from frontmatter, not from a list. Add `tag1: "Foo"` to any
essay and a `/essays/tag/foo/` page is generated, with a chip in the filter row
on `/essays/`. Same for studies.

## Customise the design

- `src/css/tokens.css` — palette (OKLCH), type scale, spacing, motion.
- `src/css/kit.css` — buttons, tags, cards, inputs.
- `src/css/site.css` — page-specific blocks.

See `/styles/` (linked from `/colophon/`) for a live specimen of every token and
component.

## Deploy

`.github/workflows/pages.yml` runs `node build.js` on every push to `main` (and
to any `claude/**` branch) and uploads `dist/` to GitHub Pages. The site has a
single live deploy — whichever branch finished last is what's live.

If you don't want feature-branch deploys to clobber `main`, remove
`'claude/**'` from the workflow's `branches:` list.
