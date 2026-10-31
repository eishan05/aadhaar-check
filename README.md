# Aadhaar Number Checker

**Live:** https://eishan05.github.io/aadhaar-check/

A single static page that checks whether an Aadhaar number (or 16-digit Virtual ID) is correctly formed and free of typing mistakes. Everything runs in your browser. The number you type is never sent anywhere, and the page is built so that it can't be.

## What it checks

| Rule | Aadhaar | VID |
|---|---|---|
| Digits only (spaces and hyphens ignored; Devanagari, Gurmukhi, Tamil and other Indian-script digits accepted) | ✓ | ✓ |
| Length | 12 | 16 |
| First digit is 2–9 | ✓ | n/a |
| Last digit is a correct [Verhoeff](https://en.wikipedia.org/wiki/Verhoeff_algorithm) check digit | ✓ | ✓ |

The rules come from UIDAI's white paper *A UID Numbering Scheme* (Kanakia, Nadhamuni & Sarma, May 2010). It specifies 11 random digits plus a Verhoeff check digit, reserves a leading `0` as an escape for future longer numbers, and reserves a leading `1` for entity IDs. UIDAI's 2018 Virtual ID circular gives VIDs the same check digit.

When the check fails, the page lists the numbers you might have meant:

- **Swapped neighbours.** Every swap of two adjacent digits that gives a valid number. Usually there is zero or one.
- **One wrong digit.** For each position, the single digit that would make the number valid (at most 12).
- **One extra digit.** For 13-digit input, every single deletion that gives a valid number.

Each suggestion has a **Copy** button that copies the number as plain digits (no spaces), ready to paste into a form. The page also shows the full Verhoeff calculation, step by step.

A pass means the number is *well-formed*. It does not mean it was issued or belongs to anyone. Only UIDAI can confirm that, at [Check Aadhaar Validity](https://myaadhaar.uidai.gov.in/check-aadhaar-validity).

## Why it's private (and how to verify that yourself)

1. **Content Security Policy.** `index.html` starts with
   ```
   default-src 'none'; script-src 'self'; style-src 'self'; img-src data:;
   connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'
   ```
   The browser therefore refuses every `fetch`, XHR, WebSocket, beacon, form submission and off-site image or script the page might attempt. This is enforced by the browser, not by trusting the code.
2. **No third parties.** The page loads exactly three files from this repository: `style.css`, `aadhaar.js` and `app.js`. No analytics, no fonts, no CDNs.
3. **No storage.** No cookies, `localStorage` or service worker. The number never goes into the URL. Spell-check and autofill are off on the input, so the browser doesn't send it to a cloud spelling service. The Copy buttons use the system clipboard, which stays on your device unless your OS syncs clipboards between devices (Apple's Universal Clipboard, Windows clipboard sync).
4. **Guarded in CI.** `test/privacy.test.js` fails the build if the CSP is weakened, if an external resource or inline script is added, or if the scripts mention any network, storage or dynamic-code API.

To check this yourself:

- Open DevTools → Network, type a number, and watch that no requests appear.
- Load the page, go offline, and keep using it.
- Compare the live files with this repository:
  ```sh
  for f in index.html style.css aadhaar.js app.js; do
    curl -s "https://eishan05.github.io/aadhaar-check/$f" | diff -q - "$f" && echo "$f matches"
  done
  ```
- Or don't use the hosted copy at all: clone the repo and open `index.html` directly, or run `python3 -m http.server`.

## Development

No build step and no dependencies.

```sh
node --test          # Verhoeff, suggestions, input handling, privacy guards
python3 -m http.server 8000   # then open http://localhost:8000
```

- `aadhaar.js`: pure validation logic (works in the browser and in Node).
- `app.js`: page wiring. It writes to the page with `textContent` only and never uses `innerHTML`.
- `index.html`, `style.css`: the page.

## Licence

MIT. Not affiliated with or endorsed by UIDAI or the Government of India.
