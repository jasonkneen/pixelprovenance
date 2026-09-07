# Review progress

Reviewed against the local checkout on 2026-09-04. This is an ongoing review,
not a claim that every product flow has been verified.

## Findings addressed

1. **Hierarchy ranking depended on registry order** (`src/pattern.ts:123`).
   The pairwise score-margin comparator formed cycles across three matches.
   Ranking now uses score bands anchored to the strongest remaining score.
   A regression checks all six permutations of a parent/child/leaf score chain.

2. **Valid 2× decoding rejected large tags** (`decoder/decode.ts:412`).
   A 256px CSS tile became a 512px descriptor, violating CSS-size validation.
   Scaled raster generation now preserves the original descriptor. The full
   PNG decode regression failed before the fix and passes with a 512px result.

3. **Decoder fixtures exaggerated signal opacity** (`decoder/decode.test.ts:58`).
   Existing fixtures used 30% opacity while browser patterns use 3/255.
   Added 1× and 2× PNG decoding tests composited with the generated alpha.
   These cover flat backgrounds; varied content and arbitrary crop offsets
   still need broader end-to-end verification.

4. **An older upload could overwrite a newer result** (`src/demo.tsx:380`).
   Request identities now guard bitmap completion, delayed analysis, and errors.
   Stale bitmaps are closed. Oversized uploads are rejected before allocating
   the additional canvas. An integration test resolves uploads in reverse order
   and verifies that only the latest upload is analyzed.

5. **An in-page capture could overwrite a newer upload** (`src/demo.tsx`,
   `prepareInPageCapture`). Both late success and late failure reproduced the
   bug in integration tests. In-page capture now shares the request identity
   with uploads and analysis. Reset and unmount invalidate pending work;
   delayed scrolling is guarded, and new captures clear stale pending crops.

6. **Decode step validation depended on image size and truthiness**
   (`decoder/decode.ts`, `decodePng`). Invalid steps could silently use defaults
   or escape validation when no tile fit. A valid fractional step could round
   to zero before reaching the scanner. Public scan/decode entry points now
   validate controls before scanning, and scaled steps are rounded once by
   the scanner. All five added regression cases failed before the fix.

7. **Mixed-size scans could exceed the computation limit**
   (`decoder/decode.ts:313`). `scanPixels` previously checked each tile-size
   group independently. It now sums the work for all groups before reading
   pixels. A regression uses groups individually below the limit but totaling
   roughly 579 million correlation samples, with a guard proving no pixel is
   read before rejection.

8. **Malformed patterns could become invalid matches**
   (`decoder/decode.ts:221`). Public scan calls accepted ragged, sparse, and
   non-finite matrices; correlation could yield NaN and bypass the score
   threshold. Registry validation now checks descriptors, total pattern memory,
   square dimensions, and finite samples. Four malformed-matrix regressions
   failed before the fix and pass afterward.

9. **Browser analysis could perform unbounded scan work**
   (`src/demo-analysis.ts`, `analyzeScreenshot`). The browser path lacked the
   CLI's limits and accepted invalid steps. It now validates controls, bounds
   dimensions/component and scale counts, and estimates the aggregate sampled
   work of both coarse scanning and local refinement before reading pixels.
   Regressions exercise both an overly dense scan and an oversized refinement
   region, plus four invalid step values.

10. **Browser analysis skipped large 2× tiles** (`src/demo-analysis.ts`).
    Its 256px physical-tile ceiling excluded valid 256px CSS tiles captured at
    2×. It now supports 512px physical tiles. A regression composites a 256px
    carrier at actual alpha, doubles its pixels, and recovers the 512px tile
    with correlation above 0.7. This is a synthetic raster test, not browser
    screenshot proof.

11. **Updated tags briefly retained a stale pixel carrier** (`src/DevTag.tsx`).
    A new source location could commit while the old pattern image remained
    until the passive effect ran. Pattern state now carries its payload/size/
    intensity key, and rendering only uses an image matching the current key.
    A client-side layout-effect probe reproduced the mismatch before the fix
    and verifies the intermediate commit as well as the final regenerated URL.

12. **Ordinary crop offsets hid valid CLI signals** (`decoder/decode.ts`).
    Removing seven pixels from the left and eleven from the top made both
    1× and 2× synthetic captures return no match at default settings. The CLI
    now uses a denser default grid and refines each component's strongest
    candidate at pixel offsets. Refinement uses sampled correlation to nominate
    a position and confirms it at full resolution. Coarse and refinement costs
    are both preflighted against the computation limit. Both regressions pass;
    this does not establish recovery for every offset or background.

13. **Invisible RGB produced confident matches** (`decoder/decode.ts` and
    `src/demo-analysis.ts`). A fully transparent image retaining carrier RGB
    scored above 0.999 in both paths. Correlation now suppresses stored RGB
    when alpha is zero in coarse, robust, and refinement sampling. Two negative
    regressions prove that invisible carriers no longer produce matches.

14. **Archive documentation described absent files and unverified readiness**
    (`paper/README.md`). The README now lists the files actually present and
    labels historical accuracy/timing as reported claims. Compilation and
    submission readiness are explicitly unverified. The root and public PDFs
    have different hashes; both archives were preserved.

## Review scope observations

- The model-context review lens does not apply: there is no LLM message pipeline.
- The historical v2 commit `77bee40` combined 12,320 changed lines across 50 files.
  This is a reviewability concern, not a current runtime defect. Future work
  should separate shared pattern primitives, encoder/decoder migrations, browser
  analysis, demo UI, and packaging into dependency-ordered changes.
- The demo integration tests mock capture and analysis. They establish UI wiring
  and request ordering, not recovery from an actual browser screenshot.

## Product improvements

Granular identification now includes the sprint heading, description, and task
count, with matching codebook entries and source excerpts. Minimum selection
size is 32×32 rather than 72×72. Heading signals use 32px tiles; description and
counter signals use 16px tiles. Wrapper bounds follow the text block instead
of filling the card width. New tests cover synthetic heading recovery with an
overlapping parent carrier and a tight crop's source/focus UI wiring. Actual
browser recovery for these additions remains unverified.

The demo now offers a native “Capture sprint card” button that calculates the
card's visible bounds and uses the existing capture pipeline. The existing
clickable crop starts analysis without drag-and-drop. The bounds toggle now
shows focus on its visible track. A UI integration test covers button capture,
726×298 crop dimensions, and analysis/source display using mocked capture and
analysis. Five demo integration tests and the production demo build passed
following this change; actual keyboard/browser layout verification remains open.

The CLI now supports `--json` for machine-readable decoded mappings, `--step`
for controlling scan spacing, and `--help`. JSON mode preserves exit status:
0 for matches, 1 for no match or errors. No match emits `[]`; errors go to
stderr without contaminating stdout. README documents this contract.

Installed-package checks exercise successful JSON decoding, source coordinates,
scores/tile sizes/counts, empty JSON results, invalid steps, and help output in
all four React consumer installations (18.0.0, latest 18, 19.0.0, latest 19).

The refinement scorer now accumulates correlation directly instead of allocating
three temporary matrices per candidate. A six-case local run measured 455 ms
before and 189 ms afterward with exactly equal result arrays, including scores
and counts. Timing is a single-run observation. Reproduce with
`npm run benchmark:decoder -- /tmp/decoder-results.json`.

The benchmark originally exposed a miss: `BENCH/card`, 64px carrier at 2×,
256×320 raster, offsets x=19/y=11, real alpha over gray 224. Both implementations
missed it; five other cases matched. A subsequent fix adds a denser sampled
search that nominates an additional candidate, with both nominations refined
and confirmed at full resolution. Its work is included in the budget and
repeated confirmation positions are counted once. The new regression passes
and all six benchmark cases now match. One post-fix run measured 375 ms; the
extra search trades some of the earlier speed gain for improved recovery.

## Verification

`npm run check` passed: 72 tests across seven files, TypeScript checking, library
and demo production builds, and tarball consumer export/CLI checks with React
18 and 19. `git diff --check` passed.

A local production-preview HTTP smoke check served the built HTML, both
referenced JS/CSS assets with correct content types, and the 301,498-byte public
PDF successfully. Served PDF bytes exactly matched the public file. The preview
process was stopped afterward. This checks asset serving, not browser rendering
or a deployed Netlify instance.

Browser verification was attempted through the available browser runtime;
discovery returned no available browsers. Real-browser screenshot recovery
remains unverified, and no visual completion claim is made.

## Completion audit

| Area | Current evidence | Status |
| --- | --- | --- |
| Pattern generation and hierarchy | Legacy byte test, alpha tests, all hierarchy permutations | Verified within regression scope |
| React marker updates and controls | SSR tests, client commit test, disabled/root behavior | Verified within regression scope |
| CLI decoding and limits | Scales, offset crops, negative cases, input and aggregate-budget tests | Verified within regression scope |
| Browser analyser | Synthetic raster recovery, alpha and work-limit tests | Algorithm tested; screenshot capture unverified |
| Demo capture lifecycle | Upload/capture races and button/drag flow integration tests | UI wiring tested with capture/analysis mocks |
| Packaging and automation | Tarball exports, types, CLI JSON/text/errors in four React installations | Passed |
| Production build and assets | Vite build plus previous local HTTP checks for HTML, JS, CSS, PDF | Passed locally |
| Real-browser product experience | Browser runtime again returned “No browser is available” at final audit | Outstanding |

## Remaining work

Connect a browser and verify the current production demo:

1. Draw and analyse a full card, then recover a nested chip from a smaller crop.
2. Analyse real 1×/2× screenshots with offset crops and varied content; retain
   screenshots and observed mappings as evidence.
3. Use the capture button and analysis thumbnail through keyboard navigation;
   inspect focus indicators and layout at desktop and narrow widths.
4. Fix any failures revealed by those checks and rerun the relevant gates.

The full goal remains active. Synthetic tests, mocked UI integration, and HTTP
asset checks do not prove these remaining browser outcomes.
