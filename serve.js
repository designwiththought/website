#!/usr/bin/env node

/**
 * Dev Server
 * Zero-dependency HTTP server with file watching and live reload via SSE.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { build } = require('./build');

const DIST = path.join(__dirname, 'dist');
const SRC = path.join(__dirname, 'src');
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ---------------------------------------------------------------------------
// SSE clients for live reload
// ---------------------------------------------------------------------------
let sseClients = [];

function sendReload() {
  sseClients.forEach(function (res) {
    res.write('data: reload\n\n');
  });
}

// ---------------------------------------------------------------------------
// Live-reload script injected into HTML responses
// ---------------------------------------------------------------------------
const RELOAD_SCRIPT = `
<script>
(function() {
  var es = new EventSource('/__sse');
  es.onmessage = function(e) {
    if (e.data === 'reload') window.location.reload();
  };
  es.onerror = function() {
    es.close();
    setTimeout(function() { window.location.reload(); }, 2000);
  };
})();
</script>
`;

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
const server = http.createServer(function (req, res) {
  // SSE endpoint
  if (req.url === '/__sse') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('data: connected\n\n');
    sseClients.push(res);
    req.on('close', function () {
      sseClients = sseClients.filter(function (c) { return c !== res; });
    });
    return;
  }

  // Resolve file path
  let urlPath = req.url.split('?')[0];
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  if (!path.extname(urlPath)) urlPath += '/index.html';

  const filePath = path.join(DIST, urlPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Read and serve
  fs.readFile(filePath, function (err, data) {
    if (err) {
      // Try without the extra /index.html
      const altPath = path.join(DIST, req.url.split('?')[0]);
      if (fs.existsSync(altPath) && fs.statSync(altPath).isFile()) {
        const ext = path.extname(altPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(fs.readFileSync(altPath));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 Not Found</h1><p>' + req.url + '</p>');
      return;
    }

    const ext = path.extname(filePath);
    let content = data;

    // Inject live-reload script into HTML
    if (ext === '.html') {
      content = data.toString().replace('</body>', RELOAD_SCRIPT + '</body>');
    }

    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

// ---------------------------------------------------------------------------
// File Watcher
// ---------------------------------------------------------------------------
let rebuildTimeout = null;

function watchDir(dir) {
  if (!fs.existsSync(dir)) return;

  fs.watch(dir, { recursive: true }, function (eventType, filename) {
    if (!filename) return;
    // Debounce rebuilds
    if (rebuildTimeout) clearTimeout(rebuildTimeout);
    rebuildTimeout = setTimeout(function () {
      console.log('[watch] Change detected: ' + filename);
      build().then(function () {
        sendReload();
        console.log('[watch] Rebuilt & reloaded');
      }).catch(function (e) {
        console.error('[watch] Build error:', e.message);
      });
    }, 150);
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
console.log('[serve] Building...');
build().catch(function (e) {
  console.error('[serve] Initial build failed:', e.message);
  console.error(e.stack);
  process.exit(1);
});

watchDir(SRC);

server.listen(PORT, function () {
  console.log('[serve] http://localhost:' + PORT);
  console.log('[serve] Watching src/ for changes...');
});
