#!/usr/bin/env node

/**
 * Static Site Generator
 * Zero-dependency build script using Node.js built-ins.
 * Parses MDX (frontmatter + markdown + components), renders templates, outputs static HTML.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

// ---------------------------------------------------------------------------
// HTTP fetch helpers — used by the /products/ build-time image grabber.
// Pure Node, no dependencies. Browser-like UA so we get past the laziest
// scrapers; anything stricter (Cloudflare, etc.) falls through to the
// placeholder path with a console warning.
// ---------------------------------------------------------------------------
function fetchUrl(url, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var lib = url.startsWith('https:') ? https : http;
    var req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
        'Accept': opts.binary ? 'image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, function (res) {
      // Follow redirects (max 5)
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) !== -1 && res.headers.location) {
        var depth = (opts._depth || 0) + 1;
        if (depth > 5) return reject(new Error('too many redirects'));
        var next = new URL(res.headers.location, url).toString();
        return fetchUrl(next, Object.assign({}, opts, { _depth: depth })).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var buf = Buffer.concat(chunks);
        if (opts.binary) {
          resolve({ buf: buf, contentType: res.headers['content-type'] || '' });
        } else {
          resolve(buf.toString('utf8'));
        }
      });
    });
    req.setTimeout(8000, function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

function extractImageUrlFromHtml(html, baseUrl) {
  // og:image (either attribute order), then twitter:image, then first <img>.
  var m = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i)
       || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i);
  if (m) return new URL(m[1], baseUrl).toString();
  m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
  if (m) return new URL(m[1], baseUrl).toString();
  m = html.match(/<img[^>]+src=["']([^"']+\.(?:jpe?g|png|webp|avif))["']/i);
  if (m) return new URL(m[1], baseUrl).toString();
  return null;
}

function extFromContentType(ct) {
  ct = (ct || '').toLowerCase();
  if (ct.indexOf('png') !== -1)  return '.png';
  if (ct.indexOf('webp') !== -1) return '.webp';
  if (ct.indexOf('avif') !== -1) return '.avif';
  if (ct.indexOf('gif') !== -1)  return '.gif';
  return '.jpg';
}

// ---------------------------------------------------------------------------
// Utility: recursive mkdir
// ---------------------------------------------------------------------------
function mkdirp(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Utility: clean dist
// ---------------------------------------------------------------------------
function cleanDist() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true, force: true });
  }
  mkdirp(DIST);
}

// ---------------------------------------------------------------------------
// Frontmatter Parser
// Parses YAML-lite frontmatter between --- fences.
// Supports: strings, arrays of objects (indented with - key: val).
// ---------------------------------------------------------------------------
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { data: {}, content: raw };

  const yamlBlock = match[1];
  const content = raw.slice(match[0].length).trim();
  const data = {};
  let currentKey = null;
  let currentArray = null;
  let currentObj = null;

  const lines = yamlBlock.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Array item: "  - key: val"
    const arrayItemMatch = line.match(/^  - (\w+):\s*"?(.+?)"?\s*$/);
    if (arrayItemMatch && currentArray) {
      // Start new object in array
      if (currentObj) currentArray.push(currentObj);
      currentObj = {};
      currentObj[arrayItemMatch[1]] = stripQuotes(arrayItemMatch[2]);
      continue;
    }

    // Continuation of array object: "    key: val"
    const arrayContMatch = line.match(/^    (\w+):\s*"?(.+?)"?\s*$/);
    if (arrayContMatch && currentObj) {
      currentObj[arrayContMatch[1]] = stripQuotes(arrayContMatch[2]);
      continue;
    }

    // Top-level key with array value (next lines are array items)
    const arrayKeyMatch = line.match(/^(\w+):\s*$/);
    if (arrayKeyMatch) {
      // Flush previous array
      if (currentArray && currentKey) {
        if (currentObj) currentArray.push(currentObj);
        data[currentKey] = currentArray;
      }
      currentKey = arrayKeyMatch[1];
      currentArray = [];
      currentObj = null;
      continue;
    }

    // Top-level key: value
    const kvMatch = line.match(/^(\w+):\s*"?(.+?)"?\s*$/);
    if (kvMatch) {
      // Flush previous array
      if (currentArray && currentKey) {
        if (currentObj) currentArray.push(currentObj);
        data[currentKey] = currentArray;
        currentArray = null;
        currentObj = null;
        currentKey = null;
      }
      data[kvMatch[1]] = stripQuotes(kvMatch[2]);
      continue;
    }
  }

  // Flush trailing array
  if (currentArray && currentKey) {
    if (currentObj) currentArray.push(currentObj);
    data[currentKey] = currentArray;
  }

  return { data, content };
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Markdown Parser
// Converts markdown to HTML. Handles: paragraphs, headings, bold, italic,
// links, inline code, blockquotes, horizontal rules, unordered lists.
// ---------------------------------------------------------------------------
function parseMarkdown(md) {
  const lines = md.split('\n');
  const output = [];
  let inBlockquote = false;
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Blank line — close open blocks
    if (line.trim() === '') {
      if (inBlockquote) { output.push('</blockquote>'); inBlockquote = false; }
      if (inList) { output.push('</ul>'); inList = false; }
      continue;
    }

    // Headings — slugify to an id so TOC anchors work
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const id = text.toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
      output.push('<h' + level + ' id="' + id + '">' + inlineFormat(text) + '</h' + level + '>');
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      output.push('<hr>');
      continue;
    }

    // Raw HTML / JSX component tag at the start of a line — emit as-is so
    // block-level elements (Pullquote, Dropcap, MarginaliaPin, manual <div>)
    // are not wrapped in <p>. Matches lines that begin with `<TagName` where
    // TagName starts with a letter.
    if (/^\s*<[A-Za-z][\w-]*/.test(line)) {
      output.push(line);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      if (!inBlockquote) { output.push('<blockquote>'); inBlockquote = true; }
      output.push('<p>' + inlineFormat(line.slice(2)) + '</p>');
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { output.push('<ul>'); inList = true; }
      output.push('<li>' + inlineFormat(line.replace(/^[-*]\s+/, '')) + '</li>');
      continue;
    }

    // Paragraph
    output.push('<p>' + inlineFormat(line) + '</p>');
  }

  if (inBlockquote) output.push('</blockquote>');
  if (inList) output.push('</ul>');

  return output.join('\n');
}

function inlineFormat(text) {
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  text = text.replace(/`(.+?)`/g, '<code>$1</code>');
  // Links
  text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  return text;
}

// ---------------------------------------------------------------------------
// MDX Component Resolver
// Transforms <Footnote id="1" text="..." /> into HTML using component templates.
// ---------------------------------------------------------------------------
function resolveComponents(html) {
  // Load component templates
  const componentsDir = path.join(SRC, 'components');
  const components = {};
  if (fs.existsSync(componentsDir)) {
    fs.readdirSync(componentsDir).forEach(function (file) {
      if (file.endsWith('.html')) {
        const name = file.replace('.html', '');
        components[name] = fs.readFileSync(path.join(componentsDir, file), 'utf8');
      }
    });
  }

  // Match self-closing JSX components: <ComponentName prop="val" prop='val' />
  // Only component names starting with an uppercase letter — this keeps the
  // match from leaking across a neighbouring lowercase HTML tag like
  // `<div id="opening"></div>` while still letting attribute values contain
  // inline HTML (`<code>`, `<em>`, etc.) because their tag names are lower.
  return html.replace(/<([A-Z]\w*)\s+([\s\S]*?)\/>/g, function (match, name, attrsStr) {
    const template = components[name];
    if (!template) return match; // Leave unknown components as-is

    // Parse attributes
    const attrs = {};
    const attrRegex = /(\w+)=(?:"([^"]*?)"|'([^']*?)')/g;
    let m;
    while ((m = attrRegex.exec(attrsStr)) !== null) {
      attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
    }

    // Replace {{prop}} in template
    let result = template;
    Object.keys(attrs).forEach(function (key) {
      result = result.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), attrs[key]);
    });
    return result;
  });
}

// ---------------------------------------------------------------------------
// HTML escaping for {{var}} substitutions.
//
// By default every {{var}} substitution is HTML-escaped — characters that
// would close an attribute (") or open a tag (<, >) become entities. This
// stops user content from leaking into the surrounding markup.
//
// Two opt-outs for raw passthrough:
//   1. Naming convention: vars whose name ends in "Html" pass through.
//      Used for blocks pre-rendered by build.js (bodyHtml, starsHtml,
//      filterRowHtml, …).
//   2. Whitelist: a small set of structural slots that are always raw
//      regardless of name (the page-content slot, the icon sprite).
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

var RAW_KEYS = new Set(['content', 'iconSprite']);

// XML escaping for feed payloads. Same set as HTML escape plus apostrophe →
// &apos;, which is the XML-correct entity. Escaping all five keeps Atom
// validators happy.
function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Parse the site's free-form date strings to ISO. Falls back to "now" so
// feeds always have a valid <updated> even when frontmatter dates are
// missing or formatted oddly ("Apr 14", "2026 →", etc.).
function toIsoDate(s) {
  if (!s) return new Date().toISOString();
  var t = Date.parse(String(s));
  if (!isNaN(t)) return new Date(t).toISOString();
  return new Date().toISOString();
}

// Strip HTML tags + collapse whitespace for plain-text summaries.
function plainSummary(html, maxLen) {
  var s = String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
  return s;
}

// Pill-style "Subscribe to <label>" feed link rendered into each section
// index's page-header. Lives on its own line so it reads as a quiet
// invitation, visually distinct from the small footer RSS social link.
function renderFeedLinkHtml(href, label) {
  return '<p class="page-header__feed">' +
           '<a class="page-feed-link" href="' + href + '">' +
             '<svg class="page-feed-link__icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
               '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>' +
             '</svg>' +
             '<span>Subscribe to ' + escapeHtml(label) + '</span>' +
           '</a>' +
         '</p>';
}

function isRawKey(name) {
  // Last segment of a dot-path drives the rule for nested lookups.
  var leaf = name.indexOf('.') === -1 ? name : name.split('.').pop();
  return /Html$/.test(leaf) || RAW_KEYS.has(leaf);
}

function renderValue(name, value) {
  if (value === undefined || value === null) return '';
  return isRawKey(name) ? String(value) : escapeHtml(value);
}

// ---------------------------------------------------------------------------
// Template Engine
// Supports: {{variable}}, {{nested.variable}},
// {{#each arrayName}}...{{/each}}, {{#if condition}}...{{/if}}
// ---------------------------------------------------------------------------
function renderTemplate(template, data) {
  let output = template;

  // {{#each key}} ... {{/each}}
  output = output.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, function (_, key, block) {
    const arr = data[key];
    if (!Array.isArray(arr)) return '';
    return arr.map(function (item) {
      // Merge item data with parent data (item takes precedence)
      var merged = Object.assign({}, data, item);
      return renderTemplate(block, merged);
    }).join('');
  });

  // {{#if key}} ... {{/if}}
  output = output.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, function (_, key, block) {
    return data[key] ? renderTemplate(block, data) : '';
  });

  // {{a.b.c}} — support multi-level dot notation
  output = output.replace(/\{\{([\w.]+)\}\}/g, function (match, keyPath) {
    if (!keyPath.includes('.')) return match; // Leave simple keys for next pass
    var parts = keyPath.split('.');
    var val = data;
    for (var i = 0; i < parts.length; i++) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        val = val[parts[i]];
      } else {
        return '';
      }
    }
    return renderValue(keyPath, val);
  });

  // {{key}}
  output = output.replace(/\{\{(\w+)\}\}/g, function (_, key) {
    return renderValue(key, data[key]);
  });

  return output;
}

// ---------------------------------------------------------------------------
// Build Process
// ---------------------------------------------------------------------------
async function ensureProductImage(product) {
  // Where the cached image lives long-term — committed alongside the rest
  // of src/assets so it survives the dist clean and skips re-fetching on
  // every build.
  var cacheDir = path.join(SRC, 'assets', 'products');
  mkdirp(cacheDir);

  // 1. Use a manually-saved image if it's already on disk.
  var exts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];
  for (var i = 0; i < exts.length; i++) {
    var p = path.join(cacheDir, product.slug + exts[i]);
    if (fs.existsSync(p)) {
      product.imageRel = 'assets/products/' + product.slug + exts[i];
      return;
    }
  }

  // 2. Pick an image source: explicit override > og:image scraped from the URL.
  try {
    var imageUrl = product.imageUrl;
    if (!imageUrl) {
      if (!product.url) throw new Error('no product url');
      var html = await fetchUrl(product.url);
      imageUrl = extractImageUrlFromHtml(html, product.url);
      if (!imageUrl) throw new Error('no og:image in page');
    }
    var fetched = await fetchUrl(imageUrl, { binary: true });
    var ext = extFromContentType(fetched.contentType);
    var outPath = path.join(cacheDir, product.slug + ext);
    fs.writeFileSync(outPath, fetched.buf);
    product.imageRel = 'assets/products/' + product.slug + ext;
    console.log('[products] fetched image for "' + product.slug + '" → ' + product.imageRel);
  } catch (err) {
    product.imageRel = '';
    console.warn(
      '[products] could not fetch image for "' + product.slug + '": ' + err.message + '\n' +
      '           Add one manually at src/assets/products/' + product.slug + '.{jpg,png,webp} ' +
      'and the next build will pick it up.'
    );
  }
}

async function build() {
  var startTime = Date.now();
  console.log('[build] Starting...');

  cleanDist();

  // 1. Read site data
  var siteData = JSON.parse(fs.readFileSync(path.join(SRC, 'content', 'site.json'), 'utf8'));
  var nowData = JSON.parse(fs.readFileSync(path.join(SRC, 'content', 'now.json'), 'utf8'));
  var aboutData = JSON.parse(fs.readFileSync(path.join(SRC, 'content', 'about.json'), 'utf8'));
  var learningData = JSON.parse(fs.readFileSync(path.join(SRC, 'content', 'learning.json'), 'utf8'));
  var gearData = JSON.parse(fs.readFileSync(path.join(SRC, 'content', 'gear.json'), 'utf8'));
  var colophonData = JSON.parse(fs.readFileSync(path.join(SRC, 'content', 'colophon.json'), 'utf8'));

  // Pre-render each work entry's highlights bullet list — the template
  // engine can't nest {{#each}} inside {{#each}}, so do it up front.
  aboutData.work.forEach(function (w) {
    if (w.highlights && w.highlights.length) {
      w.highlightsHtml = w.highlights.map(function (h) {
        return '<li>' + h + '</li>';
      }).join('');
    }
  });

  // Pre-render learning resources per topic.
  var learningKindLabel = {
    book: 'Book', course: 'Course', talk: 'Talk', paper: 'Paper',
    reading: 'Reading', tool: 'Tool', newsletter: 'Letter',
    community: 'Community', event: 'Event'
  };
  learningData.topics.forEach(function (t) {
    t.resourcesHtml = (t.resources || []).map(function (r) {
      var kind = learningKindLabel[r.kind] || r.kind;
      return '<li class="learning-resource">' +
               '<span class="learning-resource__kind">' + kind + '</span>' +
               '<span>' +
                 '<span class="learning-resource__label">' + r.label + '</span>' +
                 '<span class="learning-resource__author">— ' + r.author + '</span>' +
               '</span>' +
             '</li>';
    }).join('');
  });

  // Pre-render gear items per section.
  gearData.sections.forEach(function (s) {
    s.itemsHtml = (s.items || []).map(function (g) {
      return '<li class="gear-row">' +
               '<span class="gear-row__name">' + g.name + '</span>' +
               '<p class="gear-row__note">' + g.note + '</p>' +
             '</li>';
    }).join('');
  });

  // 2. Read layouts
  var baseLayout = fs.readFileSync(path.join(SRC, 'layouts', 'base.html'), 'utf8');
  var homeLayout = fs.readFileSync(path.join(SRC, 'layouts', 'home.html'), 'utf8');
  var articleLayout = fs.readFileSync(path.join(SRC, 'layouts', 'article.html'), 'utf8');
  var notesLayout = fs.readFileSync(path.join(SRC, 'layouts', 'notes.html'), 'utf8');
  var noteLayout = fs.readFileSync(path.join(SRC, 'layouts', 'note.html'), 'utf8');
  var projectsLayout = fs.readFileSync(path.join(SRC, 'layouts', 'projects.html'), 'utf8');
  var projectLayout = fs.readFileSync(path.join(SRC, 'layouts', 'project.html'), 'utf8');
  var writingIndexLayout = fs.readFileSync(path.join(SRC, 'layouts', 'writing-index.html'), 'utf8');
  var nowLayout = fs.readFileSync(path.join(SRC, 'layouts', 'now.html'), 'utf8');
  var aboutLayout = fs.readFileSync(path.join(SRC, 'layouts', 'about.html'), 'utf8');
  var learningLayout = fs.readFileSync(path.join(SRC, 'layouts', 'learning.html'), 'utf8');
  var gearLayout = fs.readFileSync(path.join(SRC, 'layouts', 'gear.html'), 'utf8');
  var colophonLayout = fs.readFileSync(path.join(SRC, 'layouts', 'colophon.html'), 'utf8');
  var stylesLayout = fs.readFileSync(path.join(SRC, 'layouts', 'styles.html'), 'utf8');
  var productsIndexLayout = fs.readFileSync(path.join(SRC, 'layouts', 'products-index.html'), 'utf8');
  var productLayout = fs.readFileSync(path.join(SRC, 'layouts', 'product.html'), 'utf8');
  var readingLayout = fs.readFileSync(path.join(SRC, 'layouts', 'reading.html'), 'utf8');
  var musicLayout = fs.readFileSync(path.join(SRC, 'layouts', 'music.html'), 'utf8');
  var moviesLayout = fs.readFileSync(path.join(SRC, 'layouts', 'movies.html'), 'utf8');
  var podcastsLayout = fs.readFileSync(path.join(SRC, 'layouts', 'podcasts.html'), 'utf8');
  var bookshelfLayout = fs.readFileSync(path.join(SRC, 'layouts', 'bookshelf.html'), 'utf8');
  var enjoyingLayout = fs.readFileSync(path.join(SRC, 'layouts', 'enjoying.html'), 'utf8');
  var readingIndexLayout   = fs.readFileSync(path.join(SRC, 'layouts', 'reading-index.html'), 'utf8');
  var musicIndexLayout     = fs.readFileSync(path.join(SRC, 'layouts', 'music-index.html'), 'utf8');
  var moviesIndexLayout    = fs.readFileSync(path.join(SRC, 'layouts', 'movies-index.html'), 'utf8');
  var podcastsIndexLayout  = fs.readFileSync(path.join(SRC, 'layouts', 'podcasts-index.html'), 'utf8');
  var bookshelfIndexLayout = fs.readFileSync(path.join(SRC, 'layouts', 'bookshelf-index.html'), 'utf8');

  // 3. Read icon sprite
  var iconSprite = fs.readFileSync(path.join(SRC, 'assets', 'icons.svg'), 'utf8');

  // 4. Parse MDX files from a directory
  function parseMdxDir(dir) {
    if (!fs.existsSync(dir)) return [];
    var files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.mdx'); }).sort();
    return files.map(function (file) {
      var raw = fs.readFileSync(path.join(dir, file), 'utf8');
      var parsed = parseFrontmatter(raw);
      var bodyHtml = parseMarkdown(parsed.content);
      bodyHtml = resolveComponents(bodyHtml);

      var footnotes = [];
      var fnRegex = /<Footnote\s+([\s\S]*?)\/>/g;
      var fnMatch;
      while ((fnMatch = fnRegex.exec(raw)) !== null) {
        var attrs = {};
        var attrRegex = /(\w+)=(?:"([^"]*?)"|'([^']*?)')/g;
        var am;
        while ((am = attrRegex.exec(fnMatch[1])) !== null) {
          attrs[am[1]] = am[2] !== undefined ? am[2] : am[3];
        }
        if (attrs.id && attrs.text) {
          footnotes.push({ id: attrs.id, text: attrs.text });
        }
      }

      return Object.assign({}, parsed.data, {
        bodyHtml: bodyHtml,
        footnotes: footnotes.length > 0 ? footnotes : parsed.data.footnotes || []
      });
    });
  }

  var articles = parseMdxDir(path.join(SRC, 'content', 'articles'));
  var projects = parseMdxDir(path.join(SRC, 'content', 'projects'));
  var notes = parseMdxDir(path.join(SRC, 'content', 'notes'));
  var reading = parseMdxDir(path.join(SRC, 'content', 'reading'));
  var music = parseMdxDir(path.join(SRC, 'content', 'music'));
  var movies = parseMdxDir(path.join(SRC, 'content', 'movies'));
  var podcasts = parseMdxDir(path.join(SRC, 'content', 'podcasts'));
  var bookshelf = parseMdxDir(path.join(SRC, 'content', 'bookshelf'));
  var products = parseMdxDir(path.join(SRC, 'content', 'products'));

  // Derive each product's url host once, so it's available both in the
  // aggregate /enjoying/ feed (used as the byline) and on the per-product
  // reader's "Buy from …" button.
  products.forEach(function (p) {
    if (p.url) {
      try { p.urlHost = new URL(p.url).hostname.replace(/^www\./, ''); }
      catch (e) { p.urlHost = ''; }
    }
  });

  // Split each entry's body into a lede + afterthoughtHtml, mirroring notes.
  function splitLede(entries) {
    entries.forEach(function (e) {
      var paras = (e.bodyHtml || '').match(/<p>[\s\S]*?<\/p>/g) || [];
      e.ledeHtml = paras.length ? paras[0].replace(/^<p>|<\/p>$/g, '') : '';
      e.afterthoughtHtml = paras.slice(1).join('\n');
    });
  }
  splitLede(reading);
  splitLede(music);
  splitLede(movies);
  splitLede(podcasts);
  splitLede(bookshelf);

  // Reading: status → display label.
  var readingStatusLabel = { now: 'Now reading', next: 'Queued', done: 'Finished' };
  reading.forEach(function (r) {
    r.statusLabel = readingStatusLabel[r.status] || r.status;
  });

  // Movies: pre-render the 5-star rating block. Use the WHITE STAR ☆ for
  // unfilled positions so the empty state reads as an outlined star
  // shape instead of a faded fill — visible to low-vision users and in
  // glare. The parent .movie-row__rating carries an aria-label, so the
  // glyphs themselves are wrapped in aria-hidden to keep AT clean.
  movies.forEach(function (m) {
    var rating = Math.max(0, Math.min(5, parseInt(m.rating, 10) || 0));
    var filled = '★'.repeat(rating);
    var empty = '☆'.repeat(5 - rating);
    m.starsHtml = '<span aria-hidden="true">' + filled + empty + '</span>';
  });

  // Partition articles into essays and studies by kind. Each piece gets its
  // own page at /essays/<slug>/ or /studies/<slug>/, so compute the url up
  // front so every template that lists articles can reach the right place.
  articles.forEach(function (a) {
    var dir = a.kind === 'Study' ? 'studies' : 'essays';
    a.url = dir + '/' + a.slug + '/';
  });
  var essays = articles.filter(function (a) { return a.kind !== 'Study'; });
  var studies = articles.filter(function (a) { return a.kind === 'Study'; });

  // Pre-render the grouped notes list for the /notes/ index and the homepage.
  function renderNoteItem(n, hrefPrefix) {
    var href = hrefPrefix + 'notes/' + n.slug + '/';
    return '<li class="note-item">' +
             '<span class="note-item__date">' + n.date + '</span>' +
             '<div>' +
               '<a href="' + href + '" class="note-item__link">' +
                 '<p class="note-item__body">' + n.ledeHtml + '</p>' +
               '</a>' +
               (n.context ? '<div class="note-item__context">' + n.context + '</div>' : '') +
             '</div>' +
           '</li>';
  }

  // Pull the first paragraph out of each note's body as its lede preview,
  // and keep any trailing paragraphs as the "afterthought" for the reader.
  notes.forEach(function (n) {
    var paras = [];
    var re = /<p>([\s\S]*?)<\/p>/g;
    var m;
    while ((m = re.exec(n.bodyHtml)) !== null) {
      paras.push(m[1]);
    }
    n.ledeHtml = paras[0] || '';
    n.afterthoughtHtml = paras.slice(1).map(function (p) {
      return '<p>' + p + '</p>';
    }).join('\n');
  });

  // Group notes by month, preserving newest-first order.
  var notesGroups = [];
  var notesByMonth = {};
  notes.forEach(function (n) {
    var m = n.month || 'Notes';
    if (!notesByMonth[m]) {
      notesByMonth[m] = { month: m, notes: [] };
      notesGroups.push(notesByMonth[m]);
    }
    notesByMonth[m].notes.push(n);
  });

  function renderNotesGroups(hrefPrefix) {
    return notesGroups.map(function (g) {
      return '<section class="notes-month">' +
               '<h3 class="notes-month__label">' + g.month + '</h3>' +
               '<ul class="note-list">' +
                 g.notes.map(function (n) { return renderNoteItem(n, hrefPrefix); }).join('') +
               '</ul>' +
             '</section>';
    }).join('\n');
  }

  // 5. Concatenate CSS
  mkdirp(path.join(DIST, 'css'));
  var cssOrder = ['tokens.css', 'kit.css', 'site.css'];
  var cssBundle = cssOrder.map(function (file) {
    return fs.readFileSync(path.join(SRC, 'css', file), 'utf8');
  }).join('\n\n');
  fs.writeFileSync(path.join(DIST, 'css', 'style.css'), cssBundle);

  // 6. Concatenate JS
  mkdirp(path.join(DIST, 'js'));
  var jsOrder = ['theme.js', 'accessibility.js', 'nav.js', 'texture.js', 'floorboards.js', 'tag-filter.js'];
  var jsBundle = jsOrder.map(function (file) {
    var filePath = path.join(SRC, 'js', file);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return '';
  }).join('\n\n');
  fs.writeFileSync(path.join(DIST, 'js', 'main.js'), jsBundle);

  // 7. Build home page
  var recentNotes = notes.slice(0, 4);
  var homeNotesHtml = '<ul class="note-list">' +
    recentNotes.map(function (n) { return renderNoteItem(n, ''); }).join('') +
    '</ul>';

  var homeData = Object.assign({}, siteData, {
    recentArticles: articles.slice(0, 3),
    articleCount: articles.length,
    homeProjects: projects.filter(function (p) {
      return p.status && /In progress|Ongoing|Maintained/i.test(p.status);
    }).slice(0, 2),
    projectCount: projects.length,
    homeNotesHtml: homeNotesHtml,
    feedLinkHtml: renderFeedLinkHtml('feed.xml', 'all updates'),
    basePath: '',
    iconSprite: iconSprite,
    pageTitle: siteData.title,
    pageDescription: siteData.description
  });

  var homeContent = renderTemplate(homeLayout, homeData);
  var homeHtml = renderTemplate(baseLayout, Object.assign({}, homeData, { content: homeContent }));
  fs.writeFileSync(path.join(DIST, 'index.html'), homeHtml);
  console.log('[build] index.html');

  // 7a. Build notes index
  mkdirp(path.join(DIST, 'notes'));
  var notesIndexData = Object.assign({}, siteData, {
    notesGroupsHtml: renderNotesGroups('../'),
    feedLinkHtml: renderFeedLinkHtml('feed.xml', 'notes'),
    basePath: '../',
    iconSprite: iconSprite,
    pageTitle: 'Notes — ' + siteData.title,
    pageDescription: 'Short thoughts and unfinished fragments by ' + siteData.ownerName + '.'
  });
  var notesIndexContent = renderTemplate(notesLayout, notesIndexData);
  var notesIndexHtml = renderTemplate(baseLayout, Object.assign({}, notesIndexData, { content: notesIndexContent }));
  fs.writeFileSync(path.join(DIST, 'notes', 'index.html'), notesIndexHtml);
  console.log('[build] notes/index.html');

  // 7b. Build individual note pages (prev = older, next = newer)
  notes.forEach(function (note, idx) {
    var noteDir = path.join(DIST, 'notes', note.slug);
    mkdirp(noteDir);

    var newer = idx > 0 ? notes[idx - 1] : null;
    var older = idx < notes.length - 1 ? notes[idx + 1] : null;
    var related = notes.filter(function (n, i) { return i !== idx; }).slice(0, 3);

    var noteData = Object.assign({}, siteData, note, {
      prev: older ? { slug: older.slug, title: older.title, date: older.date } : null,
      next: newer ? { slug: newer.slug, title: newer.title, date: newer.date } : null,
      related: related.map(function (r) {
        return { slug: r.slug, title: r.title, date: r.date };
      }),
      basePath: '../../',
      iconSprite: iconSprite,
      pageTitle: note.title + ' — ' + siteData.title,
      pageDescription: note.title
    });

    var noteContent = renderTemplate(noteLayout, noteData);
    var noteHtml = renderTemplate(baseLayout, Object.assign({}, noteData, { content: noteContent }));
    fs.writeFileSync(path.join(noteDir, 'index.html'), noteHtml);
    console.log('[build] notes/' + note.slug + '/index.html');
  });

  // 8. Build /essays/ and /studies/ indexes + their individual pages

  // Each article gets a pipe-joined tagList (e.g. "A11y|Keyboard|Craft") that
  // the writing-index template stamps onto the card as data-tags. The
  // tag-filter runtime reads it to decide what to show/hide.
  articles.forEach(function (a) {
    a.tagList = [a.tag1, a.tag2, a.tag3].filter(Boolean).join('|');
  });

  function slugifyTag(t) {
    return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function renderFilterRow(allItems, kindLabel, chipBase, activeTag) {
    // Per-page tag bar. Each /essays/ and /studies/ index emits its own —
    // the kind is already implied by the route, so no kind chips here.
    // Tags come from the union across all items in the kind so the same
    // chip set appears on the kind index and every tag page.
    //
    // Chips are real <a> links to /<kind>/tag/<slug>/. With JS the
    // tag-filter runtime hijacks the click and filters in place via the
    // hidden attribute; without JS, the click navigates and the static
    // tag page renders a pre-filtered DOM.
    if (!allItems.length) return '';
    var tagSet = {};
    allItems.forEach(function (it) {
      [it.tag1, it.tag2, it.tag3].filter(Boolean).forEach(function (t) {
        tagSet[t] = true;
      });
    });
    var tags = Object.keys(tagSet).sort();
    if (!tags.length) return '';

    function chip(href, label, tag, isActive) {
      var cls = 'filter-bar__btn' + (isActive ? ' is-active' : '');
      var ariaPressed = isActive ? 'true' : 'false';
      var ariaCurrent = isActive ? ' aria-current="page"' : '';
      return '<a class="' + cls + '" href="' + href + '"' +
             ' data-tag="' + tag + '" aria-pressed="' + ariaPressed + '"' +
             ariaCurrent + '>' + label + '</a>';
    }

    var allActive = !activeTag;
    var allHref = chipBase;  // back to /<kind>/
    var allChip = chip(allHref, 'All', 'all', allActive);

    var tagChips = tags.map(function (t) {
      var slug = slugifyTag(t);
      return chip(chipBase + 'tag/' + slug + '/', t, t, activeTag === t);
    }).join('');

    var labelId = 'tag-filter-label-' + kindLabel.toLowerCase();
    var liveId  = 'tag-filter-live-'  + kindLabel.toLowerCase();

    return '<div class="filter-row" data-tag-filter>' +
             '<span id="' + labelId + '" class="filter-row__label">Filter ' + kindLabel + ' by tag</span>' +
             '<div class="filter-bar filter-bar--tags" role="group" aria-labelledby="' + labelId + '">' +
               allChip + tagChips +
             '</div>' +
             '<p id="' + liveId + '" class="visually-hidden" aria-live="polite" aria-atomic="true"></p>' +
           '</div>';
  }

  function buildWritingIndex(dir, allItems, meta) {
    mkdirp(path.join(DIST, dir));

    // Kind index — render every item visible. The filter row's "All"
    // chip is current; tag chips link to /<dir>/tag/<slug>/.
    var displayed = allItems.map(function (it) {
      return Object.assign({}, it, { hiddenAttr: '' });
    });

    var data = Object.assign({}, siteData, {
      items: displayed,
      pageKicker: meta.kicker,
      pageHeading: meta.heading,
      pageDek: meta.dek,
      feedLinkHtml: renderFeedLinkHtml('feed.xml', meta.kindLabel),
      filterRowHtml: renderFilterRow(allItems, meta.kindLabel, '', null),
      emptyHtml: allItems.length === 0
        ? '<p class="empty-state">' + meta.empty + '</p>'
        : '',
      basePath: '../',
      iconSprite: iconSprite,
      pageTitle: meta.heading + ' — ' + siteData.title,
      pageDescription: meta.dek
    });
    var content = renderTemplate(writingIndexLayout, data);
    var html = renderTemplate(baseLayout, Object.assign({}, data, { content: content }));
    fs.writeFileSync(path.join(DIST, dir, 'index.html'), html);
    console.log('[build] ' + dir + '/index.html');

    // Per-tag pages — every item is in DOM, but non-matching items get a
    // server-rendered hidden attribute so the no-JS view shows only the
    // tagged subset, while the JS runtime can swap visibility instantly
    // when the user picks another chip.
    var tagSet = {};
    allItems.forEach(function (it) {
      [it.tag1, it.tag2, it.tag3].filter(Boolean).forEach(function (t) {
        tagSet[t] = true;
      });
    });
    var tags = Object.keys(tagSet);
    if (tags.length) mkdirp(path.join(DIST, dir, 'tag'));
    tags.forEach(function (tag) {
      var slug = slugifyTag(tag);
      var tagDir = path.join(DIST, dir, 'tag', slug);
      mkdirp(tagDir);

      var tagged = allItems.map(function (it) {
        var matches = [it.tag1, it.tag2, it.tag3].indexOf(tag) !== -1;
        return Object.assign({}, it, { hiddenAttr: matches ? '' : 'hidden' });
      });
      var matchCount = tagged.filter(function (it) { return !it.hiddenAttr; }).length;

      var tagData = Object.assign({}, siteData, {
        items: tagged,
        pageKicker: meta.kicker,
        pageHeading: meta.heading + ' · ' + tag,
        pageDek: 'Filtered to ' + tag + '. ' + meta.dek,
        feedLinkHtml: renderFeedLinkHtml('../feed.xml', meta.kindLabel),
        filterRowHtml: renderFilterRow(allItems, meta.kindLabel, '../', tag),
        emptyHtml: matchCount === 0
          ? '<p class="empty-state">No ' + meta.kindLabel + ' tagged ' + tag + '.</p>'
          : '',
        basePath: '../../../',
        iconSprite: iconSprite,
        pageTitle: meta.heading + ' · ' + tag + ' — ' + siteData.title,
        pageDescription: 'Filtered to ' + tag + '. ' + meta.dek
      });
      var tagContent = renderTemplate(writingIndexLayout, tagData);
      var tagHtml = renderTemplate(baseLayout, Object.assign({}, tagData, { content: tagContent }));
      fs.writeFileSync(path.join(tagDir, 'index.html'), tagHtml);
      console.log('[build] ' + dir + '/tag/' + slug + '/index.html');
    });
  }

  // Pre-render the two "related" blocks a reader shows: the pair of compact
  // essay cards under the body, and the "§ Read next" list inside the sticky
  // TOC aside. The template engine can't nest {{#each}} inside {{#if}}, so do
  // this once per piece and pass the finished HTML in.
  function renderRelatedHtml(related) {
    if (!related.length) return '';
    var cards = related.map(function (r) {
      var tagSpans = [r.tag1, r.tag2, r.tag3].filter(Boolean)
        .map(function (t) { return '<span class="tag">' + t + '</span>'; }).join('');
      return '<a class="essay-card essay-card--compact" href="../../' + r.url + '">' +
               '<div class="essay-card__meta">' +
                 '<span class="kicker">&sect; ' + r.kind + '</span>' +
                 '<span class="essay-card__date">' + r.date + (r.read ? ' &middot; ' + r.read : '') + '</span>' +
               '</div>' +
               '<h3 class="essay-card__title">' + r.title + '</h3>' +
               '<p class="essay-card__dek">' + r.summary + '</p>' +
               (tagSpans ? '<div class="essay-card__tags">' + tagSpans + '</div>' : '') +
             '</a>';
    }).join('');
    return '<div class="reader__related">' +
             '<h3 class="section__title section__title--sm">Related</h3>' +
             '<div class="grid grid--2">' + cards + '</div>' +
           '</div>';
  }

  function renderReadNextHtml(related) {
    if (!related.length) return '';
    var items = related.map(function (r) {
      return '<li><a href="../../' + r.url + '">' + r.title + '</a></li>';
    }).join('');
    return '<div class="toc__aside">' +
             '<span class="kicker">&para; Read next</span>' +
             '<ul class="toc__next">' + items + '</ul>' +
           '</div>';
  }

  function buildWritingReader(dir, items, meta) {
    items.forEach(function (item) {
      var itemDir = path.join(DIST, dir, item.slug);
      mkdirp(itemDir);

      // Two pieces that aren't this one, same pool the design picks from
      // (all articles, not just essays or studies). Keeps the two lists in
      // sync: compact cards under the body + link list in the TOC.
      var related = articles.filter(function (a) { return a.slug !== item.slug; }).slice(0, 2);

      var data = Object.assign({}, siteData, item, {
        basePath: '../../',
        backHref: dir + '/',
        backLabel: meta.backLabel,
        relatedHtml: renderRelatedHtml(related),
        readNextHtml: renderReadNextHtml(related),
        iconSprite: iconSprite,
        pageTitle: item.title + ' — ' + siteData.title,
        pageDescription: item.summary
      });

      var content = renderTemplate(articleLayout, data);
      var html = renderTemplate(baseLayout, Object.assign({}, data, { content: content }));
      fs.writeFileSync(path.join(itemDir, 'index.html'), html);
      console.log('[build] ' + dir + '/' + item.slug + '/index.html');
    });
  }

  buildWritingIndex('essays', essays, {
    kicker: '§ Essays',
    heading: 'Essays',
    dek: 'Long-form writing. Published slowly, revised often. The ones I’d still send to a friend.',
    empty: 'No essays yet.',
    kindLabel: 'essays'
  });
  buildWritingReader('essays', essays, { backLabel: 'All essays' });

  buildWritingIndex('studies', studies, {
    kicker: '§ Studies',
    heading: 'Studies',
    dek: 'Short, investigated pieces. Each one answers a specific question, usually with a small data set and a stronger opinion than the data deserves.',
    empty: 'No studies yet.',
    kindLabel: 'studies'
  });
  buildWritingReader('studies', studies, { backLabel: 'All studies' });

  // 9. Build projects index — grouped by lifecycle status so visitors can
  // see what's alive at a glance instead of hunting through dates. The
  // status: frontmatter field carries a leading symbol (§ / ¶); strip it
  // before bucketing.
  function projectStatusBucket(status) {
    var s = String(status || '').toLowerCase();
    if (/in progress|ongoing|maintained/.test(s)) return 'in-flight';
    if (/shipped/.test(s))                        return 'shipped';
    if (/paused|shelved|archived/.test(s))        return 'paused';
    return 'in-flight'; // sensible default — un-tagged work is treated as live
  }

  function renderProjectTile(p) {
    return '<a class="project-tile" href="../projects/' + p.slug + '/">' +
             '<div class="project-tile__plate project-tile__plate--' + (p.plate || 'cocoa') + '">' +
               '<div class="project-tile__glyph">' + escapeHtml(p.glyph || '') + '</div>' +
               '<div class="project-tile__plate-label">' + escapeHtml(p.label || '') + '</div>' +
             '</div>' +
             '<div class="project-tile__body">' +
               '<div class="project-tile__meta">' +
                 '<span class="kicker">' + escapeHtml(p.status || '') + '</span>' +
                 '<span class="project-tile__year">' + escapeHtml(p.year || '') + '</span>' +
               '</div>' +
               '<h4 class="project-tile__title">' + escapeHtml(p.title || '') + '</h4>' +
               '<p class="project-tile__blurb">' + escapeHtml(p.summary || '') + '</p>' +
             '</div>' +
           '</a>';
  }

  var PROJECT_GROUPS = [
    { key: 'in-flight', label: 'In flight' },
    { key: 'shipped',   label: 'Shipped' },
    { key: 'paused',    label: 'Paused' }
  ];
  var projectGroupsHtml = PROJECT_GROUPS.map(function (g) {
    var members = projects.filter(function (p) { return projectStatusBucket(p.status) === g.key; });
    if (!members.length) return '';
    return '<section class="projects-group">' +
             '<h3 class="projects-group__label">' + g.label +
               ' <span class="projects-group__count">' + members.length + '</span>' +
             '</h3>' +
             '<div class="grid grid--projects">' + members.map(renderProjectTile).join('') + '</div>' +
           '</section>';
  }).join('');

  mkdirp(path.join(DIST, 'projects'));
  var projectsIndexData = Object.assign({}, siteData, {
    groupsHtml: projectGroupsHtml,
    feedLinkHtml: renderFeedLinkHtml('feed.xml', 'projects'),
    basePath: '../',
    iconSprite: iconSprite,
    pageTitle: 'Projects — ' + siteData.title,
    pageDescription: 'Projects by ' + siteData.ownerName + '.'
  });
  var projectsIndexContent = renderTemplate(projectsLayout, projectsIndexData);
  var projectsIndexHtml = renderTemplate(baseLayout, Object.assign({}, projectsIndexData, { content: projectsIndexContent }));
  fs.writeFileSync(path.join(DIST, 'projects', 'index.html'), projectsIndexHtml);
  console.log('[build] projects/index.html');

  // 9a. Build individual project pages
  projects.forEach(function (project) {
    var slug = project.slug;
    var projectDir = path.join(DIST, 'projects', slug);
    mkdirp(projectDir);

    // Join any frontmatter tags (tag1/tag2/tag3) into a single string so the
    // reader__meta row matches the design reference — one kicker containing
    // "tag · tag · tag" rather than several fragments.
    var tags = [project.tag1, project.tag2, project.tag3].filter(function (t) { return !!t; });
    var tagsJoined = tags.join(' · ');

    var projectData = Object.assign({}, siteData, project, {
      basePath: '../../',
      iconSprite: iconSprite,
      tagsJoined: tagsJoined,
      pageTitle: project.title + ' — ' + siteData.title,
      pageDescription: project.summary
    });

    var projectContent = renderTemplate(projectLayout, projectData);
    var projectHtml = renderTemplate(baseLayout, Object.assign({}, projectData, { content: projectContent }));
    fs.writeFileSync(path.join(projectDir, 'index.html'), projectHtml);
    console.log('[build] projects/' + slug + '/index.html');
  });

  // 10. Build /now/
  mkdirp(path.join(DIST, 'now'));
  var nowTemplateData = Object.assign({}, siteData, {
    items: nowData.items,
    nowUpdated: nowData.updated,
    basePath: '../',
    iconSprite: iconSprite,
    pageTitle: 'Now — ' + siteData.title,
    pageDescription: 'What ' + siteData.ownerName + ' is up to this month.'
  });
  var nowContent = renderTemplate(nowLayout, nowTemplateData);
  var nowHtml = renderTemplate(baseLayout, Object.assign({}, nowTemplateData, { content: nowContent }));
  fs.writeFileSync(path.join(DIST, 'now', 'index.html'), nowHtml);
  console.log('[build] now/index.html');

  // 11. Build /about/
  mkdirp(path.join(DIST, 'about'));
  var aboutTemplateData = Object.assign({}, siteData, {
    initials: aboutData.initials,
    work: aboutData.work,
    elsewhere: aboutData.elsewhere,
    basePath: '../',
    iconSprite: iconSprite,
    pageTitle: 'About — ' + siteData.title,
    pageDescription: 'About ' + siteData.ownerName + ' — designer, developer, accessibility lead.'
  });
  var aboutContent = renderTemplate(aboutLayout, aboutTemplateData);
  var aboutHtml = renderTemplate(baseLayout, Object.assign({}, aboutTemplateData, { content: aboutContent }));
  fs.writeFileSync(path.join(DIST, 'about', 'index.html'), aboutHtml);
  console.log('[build] about/index.html');

  // 12. Build /learning/
  mkdirp(path.join(DIST, 'learning'));
  var learningTemplateData = Object.assign({}, siteData, {
    topics: learningData.topics,
    basePath: '../',
    iconSprite: iconSprite,
    pageTitle: 'Learning — ' + siteData.title,
    pageDescription: 'What ' + siteData.ownerName + ' is chasing — accessibility, perceptual contrast, management as craft.'
  });
  var learningContent = renderTemplate(learningLayout, learningTemplateData);
  var learningHtml = renderTemplate(baseLayout, Object.assign({}, learningTemplateData, { content: learningContent }));
  fs.writeFileSync(path.join(DIST, 'learning', 'index.html'), learningHtml);
  console.log('[build] learning/index.html');

  // 13. Build /gear/
  mkdirp(path.join(DIST, 'gear'));
  var gearTemplateData = Object.assign({}, siteData, {
    sections: gearData.sections,
    basePath: '../',
    iconSprite: iconSprite,
    pageTitle: 'Gear — ' + siteData.title,
    pageDescription: 'The tools ' + siteData.ownerName + ' actually uses.'
  });
  var gearContent = renderTemplate(gearLayout, gearTemplateData);
  var gearHtml = renderTemplate(baseLayout, Object.assign({}, gearTemplateData, { content: gearContent }));
  fs.writeFileSync(path.join(DIST, 'gear', 'index.html'), gearHtml);
  console.log('[build] gear/index.html');

  // 14. Build /colophon/
  mkdirp(path.join(DIST, 'colophon'));
  var colophonTemplateData = Object.assign({}, siteData, {
    items: colophonData.items,
    basePath: '../',
    iconSprite: iconSprite,
    pageTitle: 'Colophon — ' + siteData.title,
    pageDescription: 'How ' + siteData.ownerName + '’s site is made.'
  });
  var colophonContent = renderTemplate(colophonLayout, colophonTemplateData);
  var colophonHtml = renderTemplate(baseLayout, Object.assign({}, colophonTemplateData, { content: colophonContent }));
  fs.writeFileSync(path.join(DIST, 'colophon', 'index.html'), colophonHtml);
  console.log('[build] colophon/index.html');

  // 14a. Styles — design-system specimen page, linked from the colophon.
  mkdirp(path.join(DIST, 'styles'));
  var stylesData = Object.assign({}, siteData, {
    basePath: '../',
    iconSprite: iconSprite,
    pageTitle: 'Styles — ' + siteData.title,
    pageDescription: 'A live specimen of the palette, type, and components this site is built from.'
  });
  var stylesContent = renderTemplate(stylesLayout, stylesData);
  var stylesHtml = renderTemplate(baseLayout, Object.assign({}, stylesData, { content: stylesContent }));
  fs.writeFileSync(path.join(DIST, 'styles', 'index.html'), stylesHtml);
  console.log('[build] styles/index.html');

  // 15. Per-entry pages for the cultural kinds (reading, music, movies,
  // podcasts, bookshelf). Each is browseable with prev/next neighbours,
  // mirroring the notes reader pattern.
  function buildEntryPages(dir, items, layout) {
    if (!items.length) return;
    mkdirp(path.join(DIST, dir));
    items.forEach(function (item, idx) {
      var slug = item.slug;
      var entryDir = path.join(DIST, dir, slug);
      mkdirp(entryDir);

      var prev = idx > 0 ? items[idx - 1] : null;
      var next = idx < items.length - 1 ? items[idx + 1] : null;

      var data = Object.assign({}, siteData, item, {
        prev: prev ? { slug: prev.slug, title: prev.title } : null,
        next: next ? { slug: next.slug, title: next.title } : null,
        basePath: '../../',
        iconSprite: iconSprite,
        pageTitle: item.title + ' — ' + siteData.title,
        pageDescription: item.note || item.title
      });

      var content = renderTemplate(layout, data);
      var html = renderTemplate(baseLayout, Object.assign({}, data, { content: content }));
      fs.writeFileSync(path.join(entryDir, 'index.html'), html);
      console.log('[build] ' + dir + '/' + slug + '/index.html');
    });
  }
  buildEntryPages('reading', reading, readingLayout);
  buildEntryPages('music', music, musicLayout);
  buildEntryPages('movies', movies, moviesLayout);
  buildEntryPages('podcasts', podcasts, podcastsLayout);
  buildEntryPages('bookshelf', bookshelf, bookshelfLayout);

  // Shared shape for both the per-kind indexes and the aggregate /enjoying/ stream.
  function enjoyingItem(kindLabel, kindPath, e, byline, subMeta) {
    return {
      kindLabel: kindLabel,
      kindPath: kindPath,
      slug: e.slug,
      title: e.title,
      byline: byline,
      subMeta: subMeta,
      note: e.note || ''
    };
  }

  // 16a. Per-kind indexes (/reading/, /music/, /movies/, /podcasts/, /bookshelf/).
  // Each is a flat list of cards linking to /<kind>/<slug>/, with a tail
  // link back into the unified /enjoying/ stream.
  // Generic per-kind emitter — takes a layout, the data shape that
  // layout expects, and writes /<dir>/index.html.
  function writeKindIndex(dir, layout, data) {
    if (!data || !data.itemCount) return;
    mkdirp(path.join(DIST, dir));
    var fullData = Object.assign({}, siteData, data, {
      feedLinkHtml: renderFeedLinkHtml('feed.xml', dir),
      basePath: '../',
      iconSprite: iconSprite,
      pageTitle: data.pageHeading + ' — ' + siteData.title,
      pageDescription: data.pageDek
    });
    var content = renderTemplate(layout, fullData);
    var html = renderTemplate(baseLayout, Object.assign({}, fullData, { content: content }));
    fs.writeFileSync(path.join(DIST, dir, 'index.html'), html);
    console.log('[build] ' + dir + '/index.html');
  }

  // 16a-i. Reading — grouped by status (now → next → done), each group is
  // a .reading-group with a .book-grid of .book-card items.
  function renderReadingBook(r) {
    return '<li>' +
             '<a class="book-card" href="../reading/' + r.slug + '/">' +
               '<div class="book-card__cover">' +
                 '<div class="cover-placeholder cover-placeholder--book reading-card__spine reading-card__spine--' + r.spine + '">' +
                   '<span class="reading-card__spine-title">' + r.title + '</span>' +
                 '</div>' +
               '</div>' +
               '<h4 class="book-card__title">' + r.title + '</h4>' +
               '<div class="book-card__author">' + r.author + '</div>' +
               '<p class="book-card__note">' + r.note + '</p>' +
             '</a>' +
           '</li>';
  }
  var readingGroupsOrder = [
    { status: 'now',  label: 'Now reading' },
    { status: 'next', label: 'Queued' },
    { status: 'done', label: 'Finished, recently' }
  ];
  var readingGroupsHtml = readingGroupsOrder.map(function (g) {
    var group = reading.filter(function (r) { return r.status === g.status; });
    if (!group.length) return '';
    return '<section class="reading-group">' +
             '<h3 class="notes-month__label">' + g.label +
               ' <span class="reading-group__count">' + group.length + '</span>' +
             '</h3>' +
             '<ul class="book-grid">' + group.map(renderReadingBook).join('') + '</ul>' +
           '</section>';
  }).join('');
  writeKindIndex('reading', readingIndexLayout, {
    pageKicker: '§ Reading',
    pageHeading: 'Reading list',
    pageDek: 'What’s on the shelf, what’s up next, and what I’ve recently finished. Updated when I remember — probably monthly.',
    groupsHtml: readingGroupsHtml,
    itemCount: reading.length
  });

  // 16a-ii. Music — flat .album-grid of .album-card; movie/album markup
  // shapes match the design's components.
  writeKindIndex('music', musicIndexLayout, {
    pageKicker: '§ Music',
    pageHeading: 'Albums that mattered',
    pageDek: 'Not a scrobble feed — a short list of records that earned a permanent hold on my attention. Roughly chronological; lightly annotated.',
    items: music,
    itemCount: music.length
  });

  // 16a-iii. Movies — letterboxd-style .movies-diary rows: poster + body +
  // 5★ rating column.
  writeKindIndex('movies', moviesIndexLayout, {
    pageKicker: '§ Movies',
    pageHeading: 'A viewing diary',
    pageDek: 'Most recent first. Five-star scale, honestly used. Re-watches marked in the note.',
    items: movies,
    itemCount: movies.length
  });

  // 16a-iv. Podcasts — .podcast-grid two-up cards (cover left, body right).
  writeKindIndex('podcasts', podcastsIndexLayout, {
    pageKicker: '§ Podcasts',
    pageHeading: 'In rotation',
    pageDek: 'What’s in the feed. Mostly craft and long-form interviews. I quit podcasts for years — this is the short list I came back to.',
    items: podcasts,
    itemCount: podcasts.length
  });

  // 16a-v. Bookshelf — grouped by section (Craft / Working / Fiction /
  // Essays), each section is a .bookshelf-section with a .book-grid.
  function renderBookshelfBook(b) {
    return '<li>' +
             '<a class="book-card" href="../bookshelf/' + b.slug + '/">' +
               '<div class="book-card__cover">' +
                 '<div class="cover-placeholder cover-placeholder--paper cover-placeholder--book">' +
                   b.title +
                 '</div>' +
               '</div>' +
               '<h4 class="book-card__title">' + b.title + '</h4>' +
               '<div class="book-card__author">' + b.author +
                 ' <span class="book-card__year">&middot; ' + b.year + '</span>' +
               '</div>' +
               '<p class="book-card__note">' + b.note + '</p>' +
             '</a>' +
           '</li>';
  }
  // Group preserving first-encounter order from the MDX file numbering.
  var bookshelfSections = [];
  var bookshelfBySection = {};
  bookshelf.forEach(function (b) {
    if (!bookshelfBySection[b.section]) {
      bookshelfBySection[b.section] = { name: b.section, books: [] };
      bookshelfSections.push(bookshelfBySection[b.section]);
    }
    bookshelfBySection[b.section].books.push(b);
  });
  var bookshelfSectionsHtml = bookshelfSections.map(function (s) {
    return '<section class="bookshelf-section">' +
             '<h3 class="bookshelf-section__title">' + s.name + '</h3>' +
             '<ul class="book-grid">' + s.books.map(renderBookshelfBook).join('') + '</ul>' +
           '</section>';
  }).join('');
  writeKindIndex('bookshelf', bookshelfIndexLayout, {
    pageKicker: '§ Bookshelf',
    pageHeading: 'Books that earned a permanent spot',
    pageDek: 'Separate from the current reading list. The shelf I carry between moves — books I reach for year after year, and the recent ones I already know I will.',
    sectionsHtml: bookshelfSectionsHtml,
    itemCount: bookshelf.length
  });

  // 16. Aggregate /enjoying/ index, paginated.
  var enjoyingItems = [].concat(
    movies.map(function (m) {
      return enjoyingItem('Movie', 'movies', m, 'dir. ' + m.director, m.date);
    }),
    music.map(function (m) {
      return enjoyingItem('Music', 'music', m, m.artist, String(m.year));
    }),
    reading.map(function (r) {
      return enjoyingItem('Reading', 'reading', r, r.author, r.statusLabel);
    }),
    podcasts.map(function (p) {
      return enjoyingItem('Podcast', 'podcasts', p, 'Host: ' + p.host, p.status);
    }),
    bookshelf.map(function (b) {
      return enjoyingItem('Bookshelf', 'bookshelf', b, b.author, b.section);
    }),
    products.map(function (p) {
      return enjoyingItem('Product', 'products', p, p.urlHost || '', p.price || '');
    })
  );

  var ENJOYING_PER_PAGE = 12;
  var enjoyingPages = Math.max(1, Math.ceil(enjoyingItems.length / ENJOYING_PER_PAGE));
  mkdirp(path.join(DIST, 'enjoying'));
  for (var page = 1; page <= enjoyingPages; page++) {
    var start = (page - 1) * ENJOYING_PER_PAGE;
    var slice = enjoyingItems.slice(start, start + ENJOYING_PER_PAGE);
    var basePath = page === 1 ? '../' : '../../';
    var pageDir = page === 1
      ? path.join(DIST, 'enjoying')
      : path.join(DIST, 'enjoying', String(page));
    if (page > 1) mkdirp(pageDir);

    function pageHref(n) {
      // Build a relative href from the current page to page n.
      if (page === 1) return n === 1 ? '' : (String(n) + '/');
      // From /enjoying/<page>/, prev is either /enjoying/ (n=1) or /enjoying/<n>/
      return n === 1 ? '../' : ('../' + String(n) + '/');
    }

    var data = Object.assign({}, siteData, {
      items: slice,
      pageNumber: page,
      totalPages: enjoyingPages,
      prevHref: page > 1 ? pageHref(page - 1) : '',
      nextHref: page < enjoyingPages ? pageHref(page + 1) : '',
      pageKicker: '§ Enjoying',
      pageHeading: 'Enjoying',
      pageDek: 'Books, records, films, podcasts. The things I keep coming back to, lightly annotated.',
      basePath: basePath,
      iconSprite: iconSprite,
      pageTitle: (page === 1 ? 'Enjoying' : 'Enjoying — page ' + page) + ' — ' + siteData.title,
      pageDescription: 'Reading, music, movies, podcasts, bookshelf — ' + siteData.ownerName + '.'
    });

    var content = renderTemplate(enjoyingLayout, data);
    var html = renderTemplate(baseLayout, Object.assign({}, data, { content: content }));
    fs.writeFileSync(path.join(pageDir, 'index.html'), html);
    console.log('[build] enjoying' + (page === 1 ? '' : '/' + page) + '/index.html');
  }

  // 17. Products — index + per-product readers. Hero images are fetched at
  // build time (already deferred until here so the /enjoying/ aggregate
  // doesn't wait on the network).
  await Promise.all(products.map(ensureProductImage));

  // Copy each cached image into dist and pre-render cover HTML at the
  // depth used by the products index (one level deep — basePath '../').
  products.forEach(function (p) {
    if (p.imageRel) {
      var srcPath = path.join(SRC, p.imageRel);
      var dstPath = path.join(DIST, p.imageRel);
      mkdirp(path.dirname(dstPath));
      fs.copyFileSync(srcPath, dstPath);
    }
    p.coverHtml = p.imageRel
      ? '<img class="product-card__img" src="' + '../' + p.imageRel + '" alt="' + escapeHtml(p.imageAlt || p.title) + '">'
      : '<div class="cover-placeholder cover-placeholder--paper cover-placeholder--book">' + escapeHtml(p.title) + '</div>';
  });

  if (products.length) {
    mkdirp(path.join(DIST, 'products'));

    // /products/ index
    var productsIndexData = Object.assign({}, siteData, {
      items: products,
      feedLinkHtml: renderFeedLinkHtml('feed.xml', 'products'),
      basePath: '../',
      iconSprite: iconSprite,
      pageTitle: 'Products — ' + siteData.title,
      pageDescription: 'A short list of products worth recommending.'
    });
    var productsIndexContent = renderTemplate(productsIndexLayout, productsIndexData);
    var productsIndexHtml = renderTemplate(baseLayout, Object.assign({}, productsIndexData, { content: productsIndexContent }));
    fs.writeFileSync(path.join(DIST, 'products', 'index.html'), productsIndexHtml);
    console.log('[build] products/index.html');

    // /products/<slug>/ reader. Cover HTML for the deeper page needs an
    // extra `../` prefix to climb out of the slug directory.
    products.forEach(function (p) {
      var pCover = p.imageRel
        ? '<img class="product-card__img" src="' + '../../' + p.imageRel + '" alt="' + escapeHtml(p.imageAlt || p.title) + '">'
        : '<div class="cover-placeholder cover-placeholder--paper cover-placeholder--book">' + escapeHtml(p.title) + '</div>';
      var data = Object.assign({}, siteData, p, {
        coverHtml: pCover,
        basePath: '../../',
        iconSprite: iconSprite,
        pageTitle: p.title + ' — ' + siteData.title,
        pageDescription: p.note || p.title
      });
      var content = renderTemplate(productLayout, data);
      var html = renderTemplate(baseLayout, Object.assign({}, data, { content: content }));
      var dir = path.join(DIST, 'products', p.slug);
      mkdirp(dir);
      fs.writeFileSync(path.join(dir, 'index.html'), html);
      console.log('[build] products/' + p.slug + '/index.html');
    });
  }

  // 18. Atom feeds — one per section + a global combined feed. Each feed
  // points at the shared /feed.xsl stylesheet so opening the URL in a
  // browser renders a friendly HTML preview instead of a wall of XML.
  var siteUrl = String(siteData.siteUrl || '').replace(/\/$/, '');

  function entryFromItem(item, sectionPath) {
    var url = siteUrl + '/' + sectionPath + '/' + item.slug + '/';
    var summary = item.summary || item.note || item.dek || plainSummary(item.bodyHtml, 280) || '';
    return {
      title: item.title || '(untitled)',
      link: url,
      id: url,
      updated: toIsoDate(item.date || item.year || item.month),
      summary: plainSummary(summary, 280)
    };
  }

  function renderAtomFeed(meta, entries) {
    var ordered = entries.slice().sort(function (a, b) {
      return b.updated.localeCompare(a.updated);
    }).slice(0, 30);
    var feedUrl = siteUrl + meta.path + 'feed.xml';
    var sectionUrl = siteUrl + meta.path;

    var lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    // Root-relative href so the XSL applies on every host the site is
    // served from — browsers only honour an <?xml-stylesheet?> PI when
    // the stylesheet is same-origin with the XML, so an absolute URL
    // built off siteUrl fails the moment siteUrl points anywhere other
    // than the host the user is currently visiting.
    lines.push('<?xml-stylesheet type="text/xsl" href="/feed.xsl"?>');
    lines.push('<feed xmlns="http://www.w3.org/2005/Atom">');
    lines.push('  <title>' + escapeXml(meta.title) + '</title>');
    lines.push('  <subtitle>' + escapeXml(meta.subtitle || '') + '</subtitle>');
    lines.push('  <link href="' + escapeXml(sectionUrl) + '" />');
    lines.push('  <link rel="self" type="application/atom+xml" href="' + escapeXml(feedUrl) + '" />');
    lines.push('  <id>' + escapeXml(feedUrl) + '</id>');
    lines.push('  <updated>' + (ordered[0] ? ordered[0].updated : new Date().toISOString()) + '</updated>');
    lines.push('  <author>');
    lines.push('    <name>' + escapeXml(siteData.ownerName) + '</name>');
    lines.push('    <email>' + escapeXml(siteData.email) + '</email>');
    lines.push('  </author>');
    ordered.forEach(function (e) {
      lines.push('  <entry>');
      lines.push('    <title>' + escapeXml(e.title) + '</title>');
      lines.push('    <link href="' + escapeXml(e.link) + '" />');
      lines.push('    <id>' + escapeXml(e.id) + '</id>');
      lines.push('    <updated>' + e.updated + '</updated>');
      if (e.summary) lines.push('    <summary>' + escapeXml(e.summary) + '</summary>');
      lines.push('  </entry>');
    });
    lines.push('</feed>');
    return lines.join('\n') + '\n';
  }

  function writeFeed(sectionDir, meta, entries) {
    var dir = sectionDir ? path.join(DIST, sectionDir) : DIST;
    mkdirp(dir);
    var feedXml = renderAtomFeed(meta, entries);
    fs.writeFileSync(path.join(dir, 'feed.xml'), feedXml);
    console.log('[build] ' + (sectionDir ? sectionDir + '/' : '') + 'feed.xml');
  }

  // Per-section feeds. Reuse the entry shape per kind so each feed has a
  // section URL, title, subtitle, and a list of items.
  var essaysEntries  = essays.map(function (a)  { return entryFromItem(a, 'essays'); });
  var studiesEntries = studies.map(function (a) { return entryFromItem(a, 'studies'); });
  var notesEntries   = notes.map(function (n)   { return entryFromItem(n, 'notes'); });
  var projectsEntries = projects.map(function (p) { return entryFromItem(p, 'projects'); });
  var productsEntries = products.map(function (p) { return entryFromItem(p, 'products'); });
  var readingEntries  = reading.map(function (r)  { return entryFromItem(r, 'reading'); });
  var musicEntries    = music.map(function (m)    { return entryFromItem(m, 'music'); });
  var moviesEntries   = movies.map(function (m)   { return entryFromItem(m, 'movies'); });
  var podcastsEntries = podcasts.map(function (p) { return entryFromItem(p, 'podcasts'); });
  var bookshelfEntries = bookshelf.map(function (b) { return entryFromItem(b, 'bookshelf'); });

  writeFeed('essays',    { path: '/essays/',    title: siteData.title + ' — Essays',    subtitle: 'Long-form writing.' },                      essaysEntries);
  writeFeed('studies',   { path: '/studies/',   title: siteData.title + ' — Studies',   subtitle: 'Short, investigated pieces.' },             studiesEntries);
  writeFeed('notes',     { path: '/notes/',     title: siteData.title + ' — Notes',     subtitle: 'Short fragments and unfinished thoughts.' }, notesEntries);
  writeFeed('projects',  { path: '/projects/',  title: siteData.title + ' — Projects',  subtitle: 'Things I’ve made or am still making.' },     projectsEntries);
  writeFeed('products',  { path: '/products/',  title: siteData.title + ' — Products',  subtitle: 'Things I recommend.' },                      productsEntries);
  writeFeed('reading',   { path: '/reading/',   title: siteData.title + ' — Reading',   subtitle: 'Books currently / queued / finished.' },     readingEntries);
  writeFeed('music',     { path: '/music/',     title: siteData.title + ' — Music',     subtitle: 'Albums that mattered.' },                    musicEntries);
  writeFeed('movies',    { path: '/movies/',    title: siteData.title + ' — Movies',    subtitle: 'A viewing diary.' },                         moviesEntries);
  writeFeed('podcasts',  { path: '/podcasts/',  title: siteData.title + ' — Podcasts',  subtitle: 'In rotation.' },                             podcastsEntries);
  writeFeed('bookshelf', { path: '/bookshelf/', title: siteData.title + ' — Bookshelf', subtitle: 'Books that earned a permanent spot.' },      bookshelfEntries);

  // Global feed — concat everything, sort by updated desc, keep newest 30.
  var globalEntries = [].concat(
    essaysEntries, studiesEntries, notesEntries, projectsEntries, productsEntries,
    readingEntries, musicEntries, moviesEntries, podcastsEntries, bookshelfEntries
  );
  writeFeed('', { path: '/', title: siteData.title, subtitle: siteData.description }, globalEntries);

  // Copy the XSL stylesheet alongside the feeds.
  fs.copyFileSync(path.join(SRC, 'feed.xsl'), path.join(DIST, 'feed.xsl'));
  console.log('[build] feed.xsl');

  var feedCount = 11; // 10 per-section + 1 global

  var totalPages = articles.length + projects.length + notes.length + 10
    + reading.length + music.length + movies.length + podcasts.length + bookshelf.length
    + products.length + (products.length ? 1 : 0)
    + enjoyingPages
    + feedCount;
  var elapsed = Date.now() - startTime;
  console.log('[build] Done in ' + elapsed + 'ms (' + totalPages + ' pages)');
}

// Run
build().catch(function (err) {
  console.error('[build] failed:', err);
  process.exit(1);
});

// Export for use by serve.js
module.exports = { build };
