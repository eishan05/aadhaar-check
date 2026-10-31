/*
 * app.js: wires aadhaar.js to the page. Reads the input box, writes results
 * into the page. It makes no network requests and stores nothing.
 * MIT licence.
 */
(function () {
  'use strict';

  const A = window.AadhaarCheck;
  const $ = (id) => document.getElementById(id);

  const input = $('number');
  const clearBtn = $('clear');
  const statusEl = $('status');
  const statusTitle = $('status-title');
  const statusDetail = $('status-detail');
  const rulesEl = $('rules');
  const suggestionsEl = $('suggestions');
  const suggestionsBody = $('suggestions-body');
  const stepsWrap = $('steps-wrap');
  const stepsBody = $('steps-body');
  const stepsResult = $('steps-result');
  const copyStatus = $('copy-status');

  // --- Small DOM helper (text only; nothing is ever parsed as HTML) ----------

  function h(tag, className, ...children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const child of children) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : String(child));
    }
    return node;
  }

  // --- Formatting --------------------------------------------------------------

  /** "123412341234" -> "1234 1234 1234" */
  function group(digits) {
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  /** Caret index in `text` just after its k-th digit. */
  function caretAfterDigits(text, k) {
    if (k <= 0) return 0;
    let seen = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] >= '0' && text[i] <= '9' && ++seen === k) return i + 1;
    }
    return text.length;
  }

  /** The number grouped in fours, with the digits at `positions` highlighted. */
  function renderNumber(digits, positions) {
    const marked = new Set(positions || []);
    const out = h('span', 'num');
    for (let i = 0; i < digits.length; i++) {
      if (i > 0 && i % 4 === 0) out.append(' ');
      out.append(marked.has(i) ? h('mark', null, digits[i]) : digits[i]);
    }
    return out;
  }

  // --- Live reformatting -------------------------------------------------------

  let prevDigits = '';

  function onInput(event) {
    const raw = input.value;
    const { digits, badChars } = A.normalize(raw);

    // Leave the text alone while it contains something other than digits and
    // separators, so the person can see and fix it.
    if (badChars.length) {
      prevDigits = digits;
      render();
      return;
    }

    const caret = input.selectionStart == null ? raw.length : input.selectionStart;
    let d = digits;
    let k = A.normalize(raw.slice(0, caret)).digits.length;

    // Backspace/Delete over one of our inserted spaces: remove the digit
    // beside it, otherwise the space would just reappear.
    const type = event && event.inputType;
    if (d === prevDigits && d.length) {
      if (type === 'deleteContentBackward' && k > 0) {
        d = d.slice(0, k - 1) + d.slice(k);
        k -= 1;
      } else if (type === 'deleteContentForward' && k < d.length) {
        d = d.slice(0, k) + d.slice(k + 1);
      }
    }

    const formatted = group(d);
    if (formatted !== raw) {
      input.value = formatted;
      if (document.activeElement === input) {
        const pos = caretAfterDigits(formatted, k);
        input.setSelectionRange(pos, pos);
      }
    }
    prevDigits = d;
    render();
  }

  // --- Rendering ---------------------------------------------------------------

  const KIND_NAME = { aadhaar: 'Aadhaar number', vid: 'VID', unknown: 'number' };

  function statusText(r) {
    switch (r.state) {
      case 'empty': return ['', ''];
      case 'incomplete': return ['Keep typing', ''];
      case 'too-long': return ['Too many digits', '12 for Aadhaar, 16 for a VID'];
      case 'valid': return ['Valid ' + KIND_NAME[r.kind], 'Well-formed. Doesn’t prove it was issued.'];
      default:
        if (r.masked) return ['Masked number', 'Need all 12 digits'];
        return ['Invalid ' + KIND_NAME[r.kind], ''];
    }
  }

  function renderRules(r) {
    rulesEl.replaceChildren();
    rulesEl.hidden = r.state === 'empty';
    const SR = { pass: 'Passed: ', fail: 'Failed: ', pending: 'Not checked yet: ' };
    for (const rule of r.rules) {
      rulesEl.append(
        h('li', 'rule ' + rule.status,
          h('span', 'rule-icon', ''),
          h('span', 'rule-text',
            h('span', 'sr-only', SR[rule.status]),
            h('strong', null, rule.label),
            rule.detail ? h('span', 'rule-detail', rule.detail) : null)));
    }
  }

  function copyButton(digits) {
    const btn = h('button', 'copy', 'Copy');
    btn.type = 'button';
    btn.dataset.number = digits;
    btn.setAttribute('aria-label', 'Copy ' + group(digits));
    return btn;
  }

  function candidateList(items, note) {
    const ul = h('ul', 'cands');
    for (const item of items) {
      ul.append(h('li', null,
        renderNumber(item.number, item.positions),
        h('span', 'cand-side', note ? h('span', 'cand-note', note(item)) : null, copyButton(item.number))));
    }
    return ul;
  }

  // --- Copy to clipboard ---------------------------------------------------------
  // Copies plain digits (no spaces), which every form accepts. The clipboard
  // is local to the device; nothing goes over the network.

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) { /* fall back below */ }
    }
    // Older browsers, or contexts where the async Clipboard API is refused.
    const buffer = h('textarea', 'copy-buffer');
    buffer.value = text;
    buffer.readOnly = true;
    document.body.append(buffer);
    buffer.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    buffer.remove();
    return ok;
  }

  const copyTimers = new WeakMap();

  async function onCopyClick(event) {
    const btn = event.target.closest('button.copy');
    if (!btn) return;
    const digits = btn.dataset.number;
    const ok = await copyText(digits);
    btn.focus();
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    btn.classList.toggle('copied', ok);
    btn.classList.toggle('copy-failed', !ok);
    copyStatus.textContent = ok
      ? 'Copied ' + group(digits) + ' to the clipboard.'
      : 'Could not copy. Select the number and copy it by hand.';
    clearTimeout(copyTimers.get(btn));
    copyTimers.set(btn, setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied', 'copy-failed');
    }, 1800));
  }

  function renderSuggestions(r) {
    suggestionsBody.replaceChildren();
    copyStatus.textContent = '';
    const s = r.suggestions;
    const total = s ? s.transpositions.length + s.substitutions.length + s.deletions.length : 0;
    suggestionsEl.hidden = total === 0;
    if (!total) return;

    if (s.deletions.length) {
      suggestionsBody.append(
        h('h3', null, 'Extra digit'),
        candidateList(s.deletions, (item) => 'drop ' + item.removedDigit + ' at pos ' + (item.removedIndex + 1)));
      return;
    }

    if (s.transpositions.length) {
      suggestionsBody.append(
        h('h3', null, 'Swapped digits'),
        candidateList(s.transpositions, (item) => 'pos ' + (item.positions[0] + 1) + '↔' + (item.positions[1] + 1)));
    }

    if (s.substitutions.length) {
      const details = h('details', 'subs');
      if (!s.transpositions.length) details.open = true;
      details.append(
        h('summary', null, 'One wrong digit (' + s.substitutions.length + ')'),
        candidateList(s.substitutions, (item) => 'pos ' + (item.positions[0] + 1) + ': ' + r.digits[item.positions[0]] + '→' + item.number[item.positions[0]]));
      suggestionsBody.append(details);
    }
  }

  function renderSteps(r) {
    stepsBody.replaceChildren();
    stepsWrap.hidden = !r.steps;
    if (!r.steps) return;
    for (const step of r.steps) {
      stepsBody.append(
        h('tr', step.i === 0 ? 'check-row' : null,
          h('td', null, step.i === 0 ? '0 (check)' : String(step.i)),
          h('td', null, String(step.digit)),
          h('td', null, 'p(' + (step.i % 8) + ', ' + step.digit + ') = ' + step.p),
          h('td', null, 'd(' + step.before + ', ' + step.p + ') = ' + step.c)));
    }
    const final = r.steps[r.steps.length - 1].c;
    const lastDigit = r.digits[r.digits.length - 1];
    stepsResult.replaceChildren(
      final === 0
        ? h('span', 'ok', 'c = 0 → valid')
        : h('span', 'bad', 'c = ' + final + ' ≠ 0 → invalid (check digit would be ' + r.expectedCheckDigit + ', not ' + lastDigit + ')'));
  }

  function render() {
    const r = A.analyze(input.value);
    statusEl.className = 'status state-' + r.state;
    statusEl.hidden = r.state === 'empty';
    const [title, detail] = statusText(r);
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
    clearBtn.hidden = input.value === '';
    renderRules(r);
    renderSuggestions(r);
    renderSteps(r);
  }

  // --- Events --------------------------------------------------------------------

  input.addEventListener('input', onInput);
  suggestionsBody.addEventListener('click', onCopyClick);

  clearBtn.addEventListener('click', () => {
    input.value = '';
    prevDigits = '';
    render();
    input.focus();
  });

  // Never pick up a value the browser restored from history or the
  // back/forward cache: start clean every time the page is shown.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) clearBtn.click();
  });
  input.value = '';

  render();
})();
