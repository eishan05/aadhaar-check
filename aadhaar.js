/*
 * aadhaar.js: format checks for Aadhaar numbers and Virtual IDs (VIDs).
 *
 * Pure functions only. This file does no network access, no storage and no
 * DOM work, so it behaves the same in the browser and under `node --test`.
 *
 * Rules (from UIDAI's white paper "A UID Numbering Scheme", May 2010):
 *   - An Aadhaar number has 12 decimal digits: 11 random digits + 1 check digit.
 *   - The first digit is 2-9. A first digit of 0 is reserved as an escape for
 *     future longer numbers; 1 is reserved for entity (non-person) IDs.
 *   - The check digit uses Verhoeff's dihedral-group scheme, which catches
 *     every single-digit error and every swap of two adjacent digits.
 * A VID is 16 digits whose last digit is a Verhoeff check digit too.
 *
 * MIT licence.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AadhaarCheck = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // --- Verhoeff (1969) tables ------------------------------------------------

  // D[a][b]: the group operation of the dihedral group D5 (not commutative).
  const D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];

  // P[k][x]: the permutation (1 5 8 9 4 2 7 0)(3 6) applied k times to x.
  // It repeats every 8 positions.
  const P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];

  // INV[x]: the y with D[x][y] === 0.
  const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

  const AADHAAR_LENGTH = 12;
  const VID_LENGTH = 16;

  // --- Input normalisation ---------------------------------------------------

  // Code point of "0" in each script whose digits we accept, so a number
  // typed on an Indian-language keyboard still works.
  const ZERO_CODE_POINTS = [
    0x0030, // ASCII
    0x0966, // Devanagari
    0x09e6, // Bengali
    0x0a66, // Gurmukhi
    0x0ae6, // Gujarati
    0x0b66, // Odia
    0x0be6, // Tamil
    0x0c66, // Telugu
    0x0ce6, // Kannada
    0x0d66, // Malayalam
    0x0660, // Arabic-Indic
    0x06f0, // Extended Arabic-Indic (Urdu)
    0xff10, // Full-width
  ];

  // Characters people use to group digits: whitespace, hyphens, dashes, minus.
  const SEPARATOR = /^[\s‐-―−-]$/u;

  function digitValue(ch) {
    const cp = ch.codePointAt(0);
    for (const zero of ZERO_CODE_POINTS) {
      if (cp >= zero && cp <= zero + 9) return cp - zero;
    }
    return -1;
  }

  /** Split raw input into ASCII digits, ignoring separators and collecting anything else. */
  function normalize(input) {
    let digits = '';
    const badChars = [];
    for (const ch of String(input == null ? '' : input)) {
      const v = digitValue(ch);
      if (v >= 0) digits += v;
      else if (!SEPARATOR.test(ch)) badChars.push(ch);
    }
    return { digits, badChars };
  }

  function isAsciiDigits(s) {
    return typeof s === 'string' && /^[0-9]+$/.test(s);
  }

  // --- Verhoeff --------------------------------------------------------------

  /** True if the last digit of `digits` is a correct Verhoeff check digit. */
  function verhoeffValidate(digits) {
    if (!isAsciiDigits(digits)) return false;
    let c = 0;
    for (let i = 0; i < digits.length; i++) {
      c = D[c][P[i % 8][digits.charCodeAt(digits.length - 1 - i) - 48]];
    }
    return c === 0;
  }

  /** The Verhoeff check digit to append to `payload`. */
  function verhoeffCheckDigit(payload) {
    if (!isAsciiDigits(payload)) throw new TypeError('payload must be a non-empty string of ASCII digits');
    let c = 0;
    for (let i = 0; i < payload.length; i++) {
      c = D[c][P[(i + 1) % 8][payload.charCodeAt(payload.length - 1 - i) - 48]];
    }
    return INV[c];
  }

  /** Every step of the validation pass, right to left, for display. */
  function verhoeffSteps(digits) {
    if (!isAsciiDigits(digits)) return [];
    const steps = [];
    let c = 0;
    for (let i = 0; i < digits.length; i++) {
      const index = digits.length - 1 - i;
      const digit = digits.charCodeAt(index) - 48;
      const p = P[i % 8][digit];
      const before = c;
      c = D[c][p];
      steps.push({ i, index, digit, p, before, c });
    }
    return steps;
  }

  // --- Whole-number checks ---------------------------------------------------

  function isValidAadhaar(digits) {
    return /^[2-9][0-9]{11}$/.test(digits) && verhoeffValidate(digits);
  }

  function isValidVid(digits) {
    return /^[0-9]{16}$/.test(digits) && verhoeffValidate(digits);
  }

  // --- Typo suggestions ------------------------------------------------------

  /**
   * Numbers one typo away from `digits` that pass `isValid`.
   * Verhoeff fixes exactly one correct value per position, so there are at
   * most `digits.length` substitutions and usually 0-2 transpositions.
   */
  function suggestCorrections(digits, isValid) {
    const transpositions = [];
    const substitutions = [];
    for (let i = 0; i + 1 < digits.length; i++) {
      if (digits[i] === digits[i + 1]) continue;
      const number = digits.slice(0, i) + digits[i + 1] + digits[i] + digits.slice(i + 2);
      if (isValid(number)) transpositions.push({ number, positions: [i, i + 1] });
    }
    for (let i = 0; i < digits.length; i++) {
      for (let d = 0; d <= 9; d++) {
        if (digits.charCodeAt(i) - 48 === d) continue;
        const number = digits.slice(0, i) + d + digits.slice(i + 1);
        if (isValid(number)) substitutions.push({ number, positions: [i] });
      }
    }
    return { transpositions, substitutions };
  }

  /** Valid numbers obtained by deleting one digit from `digits`. */
  function suggestDeletions(digits, isValid) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < digits.length; i++) {
      const number = digits.slice(0, i) + digits.slice(i + 1);
      if (!seen.has(number) && isValid(number)) {
        seen.add(number);
        out.push({ number, removedIndex: i, removedDigit: digits[i] });
      }
    }
    return out;
  }

  // --- Full analysis -----------------------------------------------------------

  function describeChar(ch) {
    if (/[\p{L}\p{N}\p{P}\p{S}]/u.test(ch)) return '“' + ch + '”';
    return 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  }

  /**
   * Analyse raw input. Returns:
   *   state: 'empty' | 'incomplete' | 'valid' | 'invalid' | 'too-long'
   *   kind:  'aadhaar' | 'vid' | 'unknown'
   *   rules: [{ id, label, status: 'pass' | 'fail' | 'pending', detail }]
   *   steps, expectedCheckDigit, suggestions (when relevant)
   */
  function analyze(input) {
    const raw = String(input == null ? '' : input);
    const { digits, badChars } = normalize(raw);
    const n = digits.length;
    const kind = n === VID_LENGTH ? 'vid' : n > VID_LENGTH ? 'unknown' : 'aadhaar';
    const result = {
      digits, badChars, length: n, kind, masked: false,
      state: 'empty', rules: [], steps: null, expectedCheckDigit: null, suggestions: null,
    };
    if (raw.trim() === '') return result;

    const rules = result.rules;

    // 1. Characters
    const uniqueBad = [...new Set(badChars)];
    // A masked Aadhaar shows only the last four digits, e.g. "XXXX XXXX 1234".
    result.masked = badChars.length > 0 && n <= 4 && /^[xX*\u2022\s-]+[0-9\s]+$/.test(raw.trim());
    rules.push({
      id: 'chars',
      label: 'Digits only',
      status: badChars.length ? 'fail' : 'pass',
      detail: badChars.length ? 'Remove ' + uniqueBad.map(describeChar).join(', ') : '',
    });

    // 2. Length
    let lengthRule;
    if (kind === 'vid' || n === AADHAAR_LENGTH) {
      lengthRule = { status: 'pass', detail: '' };
    } else if (n < AADHAAR_LENGTH) {
      lengthRule = { status: 'pending', detail: n + '/12' };
    } else {
      lengthRule = { status: 'fail', detail: n + ' digits' };
    }
    rules.push(Object.assign({ id: 'length', label: kind === 'vid' ? '16 digits (VID)' : '12 digits' }, lengthRule));

    // 3. First digit (Aadhaar only; UIDAI has published no such rule for VIDs)
    if (kind === 'aadhaar') {
      if (n === 0 || badChars.length) {
        rules.push({ id: 'first', label: 'First digit 2–9', status: 'pending', detail: '' });
      } else if (digits[0] === '0' || digits[0] === '1') {
        rules.push({ id: 'first', label: 'First digit 2–9', status: 'fail', detail: '0 and 1 are reserved by UIDAI' });
      } else {
        rules.push({ id: 'first', label: 'First digit 2–9', status: 'pass', detail: '' });
      }
    }

    // 4. Verhoeff check digit
    const fullLength = (kind === 'aadhaar' && n === AADHAAR_LENGTH) || kind === 'vid';
    if (fullLength) {
      const ok = verhoeffValidate(digits);
      result.steps = verhoeffSteps(digits);
      result.expectedCheckDigit = verhoeffCheckDigit(digits.slice(0, -1));
      rules.push({ id: 'checksum', label: 'Verhoeff checksum', status: ok ? 'pass' : 'fail', detail: ok ? '' : 'typo somewhere' });
    } else if (kind !== 'unknown') {
      rules.push({ id: 'checksum', label: 'Verhoeff checksum', status: 'pending', detail: '' });
    }

    // Overall state
    const anyFail = rules.some((r) => r.status === 'fail');
    const allPass = rules.every((r) => r.status === 'pass');
    if (allPass) result.state = 'valid';
    else if (kind === 'aadhaar' && n > AADHAAR_LENGTH && !badChars.length &&
             rules.filter((r) => r.status === 'fail').every((r) => r.id === 'length')) result.state = 'too-long';
    else if (anyFail) result.state = 'invalid';
    else result.state = 'incomplete';

    // Suggestions, only for clean input of a plausible length
    if (!badChars.length && result.state !== 'valid') {
      if (kind === 'aadhaar' && n === AADHAAR_LENGTH) {
        result.suggestions = Object.assign({ deletions: [] }, suggestCorrections(digits, isValidAadhaar));
      } else if (kind === 'vid') {
        result.suggestions = Object.assign({ deletions: [] }, suggestCorrections(digits, isValidVid));
      } else if (n === AADHAAR_LENGTH + 1) {
        result.suggestions = { transpositions: [], substitutions: [], deletions: suggestDeletions(digits, isValidAadhaar) };
      }
    }

    return result;
  }

  return {
    AADHAAR_LENGTH,
    VID_LENGTH,
    normalize,
    verhoeffValidate,
    verhoeffCheckDigit,
    verhoeffSteps,
    isValidAadhaar,
    isValidVid,
    suggestCorrections,
    suggestDeletions,
    analyze,
  };
});
