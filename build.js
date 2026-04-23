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
  return html.replace(/<(\w+)\s+([\s\S]*?)\/>/g, function (match, name, attrsStr) {
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

  // 2. Read layouts
  var baseLayout = fs.readFileSync(path.join(SRC, 'layouts', 'base.html'), 'utf8');
  var homeLayout = fs.readFileSync(path.join(SRC, 'layouts', 'home.html'), 'utf8');
  var articleLayout = fs.readFileSync(path.join(SRC, 'layouts', 'article.html'), 'utf8');
  var notesLayout = fs.readFileSync(path.join(SRC, 'layouts', 'notes.html'), 'utf8');
  var noteLayout = fs.readFileSync(path.join(SRC, 'layouts', 'note.html'), 'utf8');

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

  // Pull the first paragraph out of each note's body as its lede preview.
  notes.forEach(function (n) {
    var m = n.bodyHtml.match(/<p>([\s\S]*?)<\/p>/);
    n.lede = m ? m[1] : '';
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
    articles: articles,
    articleCount: articles.length,
    projects: projects,
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

  // 8. Build article pages
  mkdirp(path.join(DIST, 'articles'));
  articles.forEach(function (article) {
    var slug = article.slug;
    var articleDir = path.join(DIST, 'articles', slug);
    mkdirp(articleDir);

    var articleData = Object.assign({}, siteData, article, {
      basePath: '../../',
      backHref: '#writing',
      backLabel: 'Back to writing',
      iconSprite: iconSprite,
      pageTitle: article.title + ' — ' + siteData.title,
      pageDescription: article.summary
    });

    var articleContent = renderTemplate(articleLayout, articleData);
    var articleHtml = renderTemplate(baseLayout, Object.assign({}, articleData, { content: articleContent }));
    fs.writeFileSync(path.join(articleDir, 'index.html'), articleHtml);
    console.log('[build] articles/' + slug + '/index.html');
  });

  // 9. Build project pages
  mkdirp(path.join(DIST, 'projects'));
  projects.forEach(function (project) {
    var slug = project.slug;
    var projectDir = path.join(DIST, 'projects', slug);
    mkdirp(projectDir);

    var projectData = Object.assign({}, siteData, project, {
      basePath: '../../',
      backHref: '#projects',
      backLabel: 'Back to projects',
      iconSprite: iconSprite,
      pageTitle: project.title + ' — ' + siteData.title,
      pageDescription: project.summary
    });

    var projectContent = renderTemplate(articleLayout, projectData);
    var projectHtml = renderTemplate(baseLayout, Object.assign({}, projectData, { content: projectContent }));
    fs.writeFileSync(path.join(projectDir, 'index.html'), projectHtml);
    console.log('[build] projects/' + slug + '/index.html');
  });

  var totalPages = articles.length + projects.length + notes.length + 2;
  var elapsed = Date.now() - startTime;
  console.log('[build] Done in ' + elapsed + 'ms (' + totalPages + ' pages)');
}

// Run
build();

// Export for use by serve.js
module.exports = { build };
