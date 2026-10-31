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
  const suggestionsIntro = $('suggestions-intro');
  const suggestionsBody = $('suggestions-body');
  const stepsWrap = $('steps-wrap');
  const stepsBody = $('steps-body');
  const stepsResult = $('steps-result');

  const DEFAULT_DETAIL = statusDetail.textContent;

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

  const KIND_NAME = { aadhaar: 'Aadhaar number', vid: 'Virtual ID (VID)', unknown: 'Aadhaar number or VID' };

  function statusText(r) {
    const name = KIND_NAME[r.kind];
    const firstFail = r.rules.find((rule) => rule.status === 'fail');
    switch (r.state) {
      case 'empty':
        return ['Type or paste a number to check it.', DEFAULT_DETAIL];
      case 'incomplete':
        return ['Keep typing…', r.length + ' of 12 digits.'];
      case 'too-long':
        return ['Too many digits for an Aadhaar number',
          'Aadhaar numbers have 12 digits. If you are entering a 16-digit Virtual ID, keep typing.'];
      case 'valid':
        return ['Correctly formed ' + name,
          (r.kind === 'vid' ? 'It has 16 digits' : 'It has 12 digits, a valid first digit') +
          ' and a correct check digit, so it contains no single-digit typo or swapped neighbouring digits. ' +
          'This does not prove the number was issued. Only UIDAI can confirm that.'];
      case 'invalid':
      default: {
        let why = firstFail ? firstFail.detail : '';
        if (firstFail && firstFail.id === 'checksum') {
          why = 'The check digit does not match, so at least one digit is wrong or out of place.';
        }
        if (r.masked) return ['Masked Aadhaar number', firstFail.detail];
        return ['Not a valid ' + name, why];
      }
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

  function candidateList(items, note) {
    const ul = h('ul', 'cands');
    for (const item of items) {
      ul.append(h('li', null, renderNumber(item.number, item.positions), note ? h('span', 'cand-note', note(item)) : null));
    }
    return ul;
  }

  function renderSuggestions(r) {
    suggestionsBody.replaceChildren();
    const s = r.suggestions;
    const total = s ? s.transpositions.length + s.substitutions.length + s.deletions.length : 0;
    suggestionsEl.hidden = total === 0;
    if (!total) return;

    if (s.deletions.length) {
      suggestionsIntro.textContent =
        'If you typed one digit twice or added an extra digit by mistake, the number you meant is one of these. Check it against the card. Don’t guess.';
      suggestionsBody.append(
        h('h3', null, 'One extra digit removed'),
        candidateList(s.deletions, (item) => 'drop the ' + item.removedDigit + ' at position ' + (item.removedIndex + 1)));
      return;
    }

    suggestionsIntro.textContent =
      'The check digit catches every single mistyped digit and every swap of two neighbouring digits. ' +
      'If you made one of those mistakes, the number you meant is in this list. Check it against the card. Don’t guess.';

    if (s.transpositions.length) {
      suggestionsBody.append(
        h('h3', null, 'Two neighbouring digits swapped'),
        candidateList(s.transpositions, (item) => 'positions ' + (item.positions[0] + 1) + ' and ' + (item.positions[1] + 1)));
    } else {
      suggestionsBody.append(h('p', 'muted', 'No swap of two neighbouring digits gives a valid number.'));
    }

    if (s.substitutions.length) {
      const details = h('details', 'subs');
      if (!s.transpositions.length) details.open = true;
      details.append(
        h('summary', null, 'One digit mistyped (' + s.substitutions.length + ' possibilities)'),
        h('p', 'muted', 'Each position has exactly one replacement digit that makes the check pass. The highlighted digit is the one that would change.'),
        candidateList(s.substitutions, (item) => 'position ' + (item.positions[0] + 1) + ': ' + r.digits[item.positions[0]] + ' → ' + item.number[item.positions[0]]));
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
          h('td', null, step.i === 0 ? '0 (check digit)' : String(step.i)),
          h('td', null, String(step.digit)),
          h('td', null, 'p(' + (step.i % 8) + ', ' + step.digit + ') = ' + step.p),
          h('td', null, 'd(' + step.before + ', ' + step.p + ') = ' + step.c)));
    }
    const final = r.steps[r.steps.length - 1].c;
    const lastDigit = r.digits[r.digits.length - 1];
    stepsResult.replaceChildren(
      final === 0
        ? h('span', 'ok', 'Final c = 0, so the check passes.')
        : h('span', 'bad', 'Final c = ' + final + ', not 0, so the check fails. ' +
            'For the first ' + (r.digits.length - 1) + ' digits exactly as typed, the check digit would be ' +
            r.expectedCheckDigit + ', not ' + lastDigit + '. The mistake could be in any digit, though.'));
  }

  function render() {
    const r = A.analyze(input.value);
    statusEl.className = 'status state-' + r.state;
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
