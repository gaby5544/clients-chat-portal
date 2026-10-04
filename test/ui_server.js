// Tiny static server + fake socket.io + stub translation so the REAL front-end files can run in headless Chromium.
const http = require('http'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const FAKE_IO = `window.io=function(){var h={};var s={id:'sock1',connected:true,
 on:function(e,f){(h[e]=h[e]||[]).push(f);return s},off:function(e){delete h[e];return s},
 emit:function(e,d){(window.__sent=window.__sent||[]).push([e,d])},connect:function(){},disconnect:function(){}};
 window.__srv={emit:function(e,d){(h[e]||[]).forEach(function(f){f(d)})},count:function(e){return (h[e]||[]).length}};
 window.addEventListener('load',function(){setTimeout(function(){(h.connect||[]).forEach(function(f){f()})},60)});return s;};`;
const terms = require('../terms');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/socket.io/socket.io.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(FAKE_IO); }
  if (u.pathname === '/api/terms') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ version: terms.TERMS_VERSION, sections: terms.TERMS_SECTIONS, checkboxLabel: terms.TERMS_CHECKBOX_LABEL, complaintsEmail: terms.COMPLAINTS_EMAIL })); }
  if (u.pathname === '/api/translate/batch' && req.method === 'POST') {
    let b = ''; req.on('data', c => b += c); req.on('end', () => { const j = JSON.parse(b); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ results: j.texts.map(t => '«' + j.target + '» ' + t), ok: true })); }); return;
  }
  if (u.pathname === '/api/translate' && req.method === 'POST') {
    let b = ''; req.on('data', c => b += c); req.on('end', () => { const j = JSON.parse(b); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: '«' + j.target + '» ' + j.text, detected: 'zh', ok: true })); }); return;
  }
  if (u.pathname === '/api/branding') { res.setHeader('Content-Type', 'application/json'); return res.end('{}'); }
  let p = u.pathname === '/' ? '/index.html' : u.pathname; const f = path.join(PUB, p);
  if (!f.startsWith(PUB) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(8099, () => console.log('ui server on 8099'));
