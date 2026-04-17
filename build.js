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

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      output.push('<h' + level + '>' + inlineFormat(headingMatch[2]) + '</h' + level + '>');
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

  // 5. Concatenate CSS
  mkdirp(path.join(DIST, 'css'));
  var cssOrder = ['tokens.css', 'reset.css', 'typography.css', 'layout.css', 'components.css', 'utilities.css'];
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
  var homeData = Object.assign({}, siteData, {
    articles: articles,
    articleCount: articles.length,
    projects: projects,
    projectCount: projects.length,
    basePath: '',
    iconSprite: iconSprite,
    pageTitle: siteData.title,
    pageDescription: siteData.description
  });

  var homeContent = renderTemplate(homeLayout, homeData);
  var homeHtml = renderTemplate(baseLayout, Object.assign({}, homeData, { content: homeContent }));
  fs.writeFileSync(path.join(DIST, 'index.html'), homeHtml);
  console.log('[build] index.html');

  // 8. Build article pages
  mkdirp(path.join(DIST, 'articles'));
  articles.forEach(function (article) {
    var slug = article.slug;
    var articleDir = path.join(DIST, 'articles', slug);
    mkdirp(articleDir);

    var articleData = Object.assign({}, siteData, article, {
      basePath: '../../',
      backHref: '#archive',
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
      backHref: '#studio',
      backLabel: 'Back to work',
      iconSprite: iconSprite,
      pageTitle: project.title + ' — ' + siteData.title,
      pageDescription: project.summary
    });

    var projectContent = renderTemplate(articleLayout, projectData);
    var projectHtml = renderTemplate(baseLayout, Object.assign({}, projectData, { content: projectContent }));
    fs.writeFileSync(path.join(projectDir, 'index.html'), projectHtml);
    console.log('[build] projects/' + slug + '/index.html');
  });

  var totalPages = articles.length + projects.length + 1;
  var elapsed = Date.now() - startTime;
  console.log('[build] Done in ' + elapsed + 'ms (' + totalPages + ' pages)');
}

// Run
build();

// Export for use by serve.js
module.exports = { build };
