'use strict';
// Guards the privacy promise. Fails CI if anyone adds network access,
// storage, third-party resources or a weaker Content Security Policy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const scripts = ['aadhaar.js', 'app.js'];

test('Content Security Policy is the first thing in <head> and forbids network access', () => {
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  const firstMeta = head.match(/<meta[^>]*>/g);
  assert.match(firstMeta[0], /charset/);
  assert.match(firstMeta[1], /http-equiv="Content-Security-Policy"/, 'CSP must come straight after the charset');
  const csp = firstMeta[1].match(/content="([^"]+)"/)[1];
  const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ')]));
  assert.equal(directives['default-src'], "'none'");
  assert.equal(directives['connect-src'], "'none'");
  assert.equal(directives['form-action'], "'none'");
  assert.equal(directives['script-src'], "'self'");
  assert.equal(directives['style-src'], "'self'");
  assert.doesNotMatch(csp, /unsafe|\*|https?:/);
});

test('page loads only its own files', () => {
  const srcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs.sort(), [...scripts].sort());
  const links = [...html.matchAll(/<link[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
  for (const href of links) assert.ok(href === 'style.css' || href.startsWith('data:'), href);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline scripts');
  assert.doesNotMatch(html, /<(iframe|img|object|embed|form)\b/i);
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline event handlers');
});

test('scripts contain no network, storage or dynamic-code APIs', () => {
  const banned = [
    /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /RTCPeerConnection/,
    /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /caches\./, /serviceWorker/,
    /\beval\s*\(/, /new\s+Function/, /\bimport\s*\(/, /importScripts/, /innerHTML/, /outerHTML/, /insertAdjacentHTML/,
    /document\.write/, /\blocation\b/, /window\.open/, /\bhistory\./, /postMessage/, /new\s+(Image|Worker)\b/,
    /https?:\/\//,
  ];
  for (const f of scripts) {
    const src = read(f);
    for (const re of banned) assert.doesNotMatch(src, re, `${f} must not use ${re}`);
  }
});

test('input is not sent to spell-check or saved by autofill', () => {
  const tag = html.match(/<input[^>]*id="number"[^>]*>/)[0];
  assert.match(tag, /autocomplete="off"/);
  assert.match(tag, /spellcheck="false"/);
  assert.match(tag, /autocorrect="off"/);
});
