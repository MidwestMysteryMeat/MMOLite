/**
 * serve.js — Minimal static server for the map editor.
 * Run: node tools/serve.js
 * Opens: http://localhost:8090/tools/map-editor/
 */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { exec } = require('child_process');

const PORT = 8090;
const ROOT = path.join(__dirname, '..');   // MMOLite project root

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/' || url === '/tools/map-editor/' || url === '/tools/map-editor') {
    url = '/tools/map-editor/index.html';
  }
  const filePath = path.join(ROOT, url);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${url}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/tools/map-editor/`;
  console.log(`Map editor running at: ${url}`);
  console.log('Press Ctrl+C to stop.\n');
  exec(`start ${url}`);
});
