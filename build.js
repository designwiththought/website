#!/usr/bin/env node

/**
 * Static Site Generator
 * Zero-dependency build script using Node.js built-ins.
 * Parses MDX (frontmatter + markdown + components), renders templates, outputs static HTML.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

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
    return val !== undefined ? String(val) : '';
  });

  // {{key}}
  output = output.replace(/\{\{(\w+)\}\}/g, function (_, key) {
    return data[key] !== undefined ? String(data[key]) : '';
  });

  return output;
}

// ---------------------------------------------------------------------------
// Build Process
// ---------------------------------------------------------------------------
function build() {
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
  var readingLayout = fs.readFileSync(path.join(SRC, 'layouts', 'reading.html'), 'utf8');
  var musicLayout = fs.readFileSync(path.join(SRC, 'layouts', 'music.html'), 'utf8');
  var moviesLayout = fs.readFileSync(path.join(SRC, 'layouts', 'movies.html'), 'utf8');
  var podcastsLayout = fs.readFileSync(path.join(SRC, 'layouts', 'podcasts.html'), 'utf8');
  var bookshelfLayout = fs.readFileSync(path.join(SRC, 'layouts', 'bookshelf.html'), 'utf8');
  var enjoyingLayout = fs.readFileSync(path.join(SRC, 'layouts', 'enjoying.html'), 'utf8');

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

  // Split each entry's body into a lede + afterthoughtHtml, mirroring notes.
  function splitLede(entries) {
    entries.forEach(function (e) {
      var paras = (e.bodyHtml || '').match(/<p>[\s\S]*?<\/p>/g) || [];
      e.lede = paras.length ? paras[0].replace(/^<p>|<\/p>$/g, '') : '';
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

  // Movies: pre-render the 5-star rating block.
  movies.forEach(function (m) {
    var rating = parseInt(m.rating, 10) || 0;
    var filled = '★'.repeat(Math.max(0, Math.min(5, rating)));
    var empty = '★'.repeat(5 - filled.length);
    m.starsHtml = filled + (empty ? '<span class="movie-row__rating-empty">' + empty + '</span>' : '');
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
                 '<p class="note-item__body">' + n.lede + '</p>' +
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
    n.lede = paras[0] || '';
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
  var jsOrder = ['theme.js', 'accessibility.js', 'nav.js', 'texture.js', 'floorboards.js'];
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

  // Collect the union of tags across every published article so the tag bar on
  // the index pages mirrors the design's "filter-bar--tags" — a static row of
  // chips, one per distinct tag. The buttons don't filter (no JS) but the
  // visual rhythm matches the reference.
  var allTags = [];
  articles.forEach(function (a) {
    [a.tag1, a.tag2, a.tag3].forEach(function (t) {
      if (t && allTags.indexOf(t) === -1) allTags.push(t);
    });
  });

  function renderFilterRow(activeKind) {
    // Static mirror of the design's kind + tag bars. Without JS the buttons
    // don't filter, but the visual rhythm and the "which tab am I on" cue
    // (is-active on Essays or Studies) match the reference. Navigation
    // between /essays/ and /studies/ happens via the drawer + footer.
    var kinds = [
      { key: 'all',   label: 'All' },
      { key: 'essay', label: 'Essays' },
      { key: 'study', label: 'Studies' },
    ];
    var kindBtns = kinds.map(function (k) {
      var cls = k.key === activeKind ? ' class="is-active"' : '';
      return '<button type="button"' + cls + '>' + k.label + '</button>';
    }).join('');

    var tagBtns = ['<button type="button" class="is-active">All</button>']
      .concat(allTags.map(function (t) {
        return '<button type="button">' + t + '</button>';
      }))
      .join('');

    return '<div class="filter-row">' +
             '<div class="filter-bar">' + kindBtns + '</div>' +
             '<div class="filter-bar filter-bar--tags">' + tagBtns + '</div>' +
           '</div>';
  }

  function buildWritingIndex(dir, items, meta) {
    mkdirp(path.join(DIST, dir));
    var data = Object.assign({}, siteData, {
      items: items,
      pageKicker: meta.kicker,
      pageHeading: meta.heading,
      pageDek: meta.dek,
      filterRowHtml: renderFilterRow(meta.activeKind),
      emptyHtml: items.length === 0
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
    activeKind: 'essay'
  });
  buildWritingReader('essays', essays, { backLabel: 'All essays' });

  buildWritingIndex('studies', studies, {
    kicker: '§ Studies',
    heading: 'Studies',
    dek: 'Short, investigated pieces. Each one answers a specific question, usually with a small data set and a stronger opinion than the data deserves.',
    empty: 'No studies yet.',
    activeKind: 'study'
  });
  buildWritingReader('studies', studies, { backLabel: 'All studies' });

  // 9. Build projects index
  mkdirp(path.join(DIST, 'projects'));
  var projectsIndexData = Object.assign({}, siteData, {
    projects: projects,
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

  // 16. Aggregate /enjoying/ index, paginated.
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

  var totalPages = articles.length + projects.length + notes.length + 10
    + reading.length + music.length + movies.length + podcasts.length + bookshelf.length
    + enjoyingPages;
  var elapsed = Date.now() - startTime;
  console.log('[build] Done in ' + elapsed + 'ms (' + totalPages + ' pages)');
}

// Run
build();

// Export for use by serve.js
module.exports = { build };
