'use strict';
// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../aadhaar.js');

// Deterministic pseudo-random numbers so failures are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomAadhaar(rand) {
  let payload = String(2 + Math.floor(rand() * 8));
  for (let i = 0; i < 10; i++) payload += Math.floor(rand() * 10);
  return payload + A.verhoeffCheckDigit(payload);
}

function randomVid(rand) {
  let payload = '';
  for (let i = 0; i < 15; i++) payload += Math.floor(rand() * 10);
  return payload + A.verhoeffCheckDigit(payload);
}

test('Verhoeff matches published examples', () => {
  // Worked examples from the Verhoeff algorithm literature (e.g. Wikipedia).
  assert.equal(A.verhoeffCheckDigit('236'), 3);
  assert.equal(A.verhoeffCheckDigit('12345'), 1);
  assert.equal(A.verhoeffCheckDigit('142857'), 0);
  assert.ok(A.verhoeffValidate('2363'));
  assert.ok(A.verhoeffValidate('123451'));
  assert.ok(A.verhoeffValidate('1428570'));
  assert.ok(!A.verhoeffValidate('2364'));
  assert.ok(!A.verhoeffValidate(''));
  assert.ok(!A.verhoeffValidate('12a4'));
});

test('UIDAI sandbox test UIDs validate', () => {
  // Dummy residents from UIDAI's pre-production (test) environment.
  for (const n of ['999941057058', '999999990019', '999999990026', '999999990042', '999999990057']) {
    assert.ok(A.isValidAadhaar(n), n);
  }
});

test('generated Aadhaar numbers validate', () => {
  const rand = rng(1);
  for (let k = 0; k < 2000; k++) {
    const n = randomAadhaar(rand);
    assert.ok(A.isValidAadhaar(n), n);
    assert.equal(A.analyze(n).state, 'valid', n);
  }
});

test('every single-digit error is caught', () => {
  const rand = rng(2);
  for (let k = 0; k < 300; k++) {
    const n = randomAadhaar(rand);
    for (let i = 0; i < 12; i++) {
      for (let d = 0; d <= 9; d++) {
        if (+n[i] === d) continue;
        const typo = n.slice(0, i) + d + n.slice(i + 1);
        assert.ok(!A.verhoeffValidate(typo), `${n} -> ${typo}`);
      }
    }
  }
});

test('every adjacent transposition is caught', () => {
  const rand = rng(3);
  for (let k = 0; k < 2000; k++) {
    const n = randomAadhaar(rand);
    for (let i = 0; i < 11; i++) {
      if (n[i] === n[i + 1]) continue;
      const typo = n.slice(0, i) + n[i + 1] + n[i] + n.slice(i + 2);
      assert.ok(!A.verhoeffValidate(typo), `${n} -> ${typo}`);
    }
  }
});

test('first digit 0 or 1 is rejected even with a correct check digit', () => {
  for (const first of ['0', '1']) {
    const payload = first + '2345678901';
    const n = payload + A.verhoeffCheckDigit(payload);
    assert.ok(A.verhoeffValidate(n));
    assert.ok(!A.isValidAadhaar(n));
    const r = A.analyze(n);
    assert.equal(r.state, 'invalid');
    assert.equal(r.rules.find((x) => x.id === 'first').status, 'fail');
    assert.equal(r.rules.find((x) => x.id === 'checksum').status, 'pass');
  }
});

test('suggestions recover the intended number', () => {
  const rand = rng(4);
  for (let k = 0; k < 300; k++) {
    const n = randomAadhaar(rand);

    // Single substitution (not in the first digit, so the typo keeps first digit 2-9)
    const i = 1 + Math.floor(rand() * 11);
    const d = (+n[i] + 1 + Math.floor(rand() * 9)) % 10;
    const sub = n.slice(0, i) + d + n.slice(i + 1);
    const rs = A.analyze(sub);
    assert.equal(rs.state, 'invalid');
    assert.ok(rs.suggestions.substitutions.some((c) => c.number === n), `sub ${sub} should suggest ${n}`);
    assert.ok(rs.suggestions.substitutions.length <= 12);
    for (const c of rs.suggestions.substitutions) assert.ok(A.isValidAadhaar(c.number));

    // Adjacent transposition
    const j = Math.floor(rand() * 11);
    if (n[j] !== n[j + 1]) {
      const tr = n.slice(0, j) + n[j + 1] + n[j] + n.slice(j + 2);
      const rt = A.analyze(tr);
      if (A.isValidAadhaar(tr)) continue; // impossible, but keep the test honest
      assert.ok(rt.suggestions.transpositions.some((c) => c.number === n), `swap ${tr} should suggest ${n}`);
    }

    // One extra digit
    const at = Math.floor(rand() * 13);
    const extra = n.slice(0, at) + Math.floor(rand() * 10) + n.slice(at);
    const re = A.analyze(extra);
    assert.ok(re.suggestions.deletions.some((c) => c.number === n), `extra ${extra} should suggest ${n}`);
  }
});

test('input normalisation', () => {
  const rand = rng(5);
  const n = randomAadhaar(rand);
  const spaced = n.slice(0, 4) + ' ' + n.slice(4, 8) + ' ' + n.slice(8);
  const dashed = n.slice(0, 4) + '-' + n.slice(4, 8) + '–' + n.slice(8);
  assert.equal(A.normalize(spaced).digits, n);
  assert.equal(A.normalize(dashed).digits, n);
  assert.equal(A.analyze(spaced).state, 'valid');

  // Devanagari and Gurmukhi digits
  const deva = [...n].map((c) => String.fromCodePoint(0x966 + +c)).join('');
  const guru = [...n].map((c) => String.fromCodePoint(0xa66 + +c)).join('');
  assert.equal(A.normalize(deva).digits, n);
  assert.equal(A.normalize(guru).digits, n);
  assert.equal(A.analyze(deva).state, 'valid');

  // Letters are flagged, not silently dropped
  const r = A.analyze('XXXX XXXX ' + n.slice(8));
  assert.equal(r.state, 'invalid');
  assert.equal(r.rules.find((x) => x.id === 'chars').status, 'fail');
  assert.equal(r.suggestions, null);
  assert.equal(r.masked, true);
  assert.equal(r.rules.find((x) => x.id === 'first').status, 'pending');
  assert.equal(A.analyze('2345 67a8 9012').masked, false);
});

test('states while typing', () => {
  assert.equal(A.analyze('').state, 'empty');
  assert.equal(A.analyze('   ').state, 'empty');
  assert.equal(A.analyze('2').state, 'incomplete');
  assert.equal(A.analyze('2345 6789').state, 'incomplete');
  assert.equal(A.analyze('1').state, 'invalid'); // first digit fails immediately
  assert.equal(A.analyze('2345678901234').state, 'too-long');
  assert.equal(A.analyze('23456789012345').state, 'too-long');
  assert.equal(A.analyze('12345678901234').state, 'invalid');
  assert.equal(A.analyze('12345678901234567').state, 'invalid');
  assert.equal(A.analyze('12345678901234567').kind, 'unknown');
});

test('Virtual IDs (16 digits)', () => {
  const rand = rng(6);
  for (let k = 0; k < 500; k++) {
    const v = randomVid(rand);
    const r = A.analyze(v);
    assert.equal(r.kind, 'vid');
    assert.equal(r.state, 'valid', v);
    const bad = v.slice(0, 15) + ((+v[15] + 1) % 10);
    const rb = A.analyze(bad);
    assert.equal(rb.state, 'invalid');
    assert.ok(rb.suggestions.substitutions.some((c) => c.number === v));
  }
});

test('checksum steps end at 0 exactly when valid', () => {
  const rand = rng(7);
  for (let k = 0; k < 200; k++) {
    const n = randomAadhaar(rand);
    const steps = A.verhoeffSteps(n);
    assert.equal(steps.length, 12);
    assert.equal(steps[steps.length - 1].c, 0);
    const bad = n.slice(0, 11) + ((+n[11] + 3) % 10);
    assert.notEqual(A.verhoeffSteps(bad).at(-1).c, 0);
    assert.equal(A.analyze(bad).expectedCheckDigit, +n[11]);
  }
});
