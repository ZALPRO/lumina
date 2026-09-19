# Contributing to Lumina

Thanks for taking the time to help. This document is short on purpose: the rules
below are the ones that actually matter for this codebase.

## Before you start

- **Bug in the PSD engine?** Please include the file (or a stripped-down one)
  that reproduces it, plus the output of:

  ```bash
  node tools/verify-corpus.mjs --download
  python3 -c "import psd_tools; print(psd_tools.__version__)"
  ```

- **New feature?** Open an issue first if it changes behaviour or file format
  output, so we agree on the shape before you spend time on it.
- **Security issue?** Do **not** open an issue — see [SECURITY.md](SECURITY.md).

## Development setup

```bash
git clone https://github.com/ZALPRO/lumina.git
cd lumina
npm install
npm test          # 269 tests, must stay green
npm run web       # http://localhost:4173
```

Optional extras used by the verification tools:

```bash
pip install psd-tools     # independent PSD reference (Python 3.9+)
```

## Ground rules

1. **The engine stays dependency-free.** `src/` may not import anything from
   `node_modules`, Electron, or the DOM. Node built-ins, `fetch` and
   `DecompressionStream` are fine (and must have a fallback).
2. **No floating promises or `await` inside pixel loops.** Decoding must stay
   async; per-pixel work must stay synchronous.
3. **Correctness beats convenience.** If a format detail is uncertain, prove it
   against a real file with an independent tool before changing the code — and
   add a regression test for it.
4. **Tests accompany behaviour changes.** A fix without a test that fails before
   it is not finished.
5. **Comments explain *why*.** In this repository comments are written in
   Persian in places; keep that style consistent with the file you are editing
   rather than rewriting neighbours.
6. **Keep diffs focused.** No drive-by reformatting, no unrelated dependency
   bumps in a bug-fix PR.

## Verification workflow (required for anything touching formats)

```bash
npm test
npm run verify:psd
npm run verify:corpus:download
```

The corpus tool must print `0 فایل اختلاف` (0 files differ). If your change
cannot satisfy that, say so in the PR and explain why.

When comparing pixels, remember the rule from [docs/VERIFICATION.md](docs/VERIFICATION.md):
the reference is `psd._record.image_data.get_data(header, split=True)`, **not**
`psd.composite()` / `psd.numpy()`.

## Commit messages

Conventional Commits style, imperative mood, English:

```
fix(psd): read merged image from end of the Layer & Mask section
feat(curves): native 'Crv ' adjustment key
docs(readme): document macOS Gatekeeper bypass
```

Types in use: `feat`, `fix`, `perf`, `docs`, `test`, `refactor`, `build`, `ci`.
Breaking changes get a `!` (`feat(psd)!:`) and a paragraph in the body.

## Pull requests

- Fill in the template; the verification checklist is not optional.
- One logical change per PR. Large refactors should be split.
- CI runs `npm test` on macOS, Linux and Windows — it must pass on all three.
- Screenshots are appreciated for UI changes; add them under
  `docs/screenshots/` with a short caption in the PR description.

## Reporting a great bug report

Include: platform + version, exact steps, expected vs. actual, the smallest file
that reproduces it, and whether `npm test` passes on your machine. A failing
test case in `test/` is the most useful thing you can attach.

## License

By contributing you agree that your work is licensed under the MIT License
(see [LICENSE](LICENSE)).
