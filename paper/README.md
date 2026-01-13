# PixelProvenance - ArXiv Paper

Academic paper describing the frequency-domain perceptual encoding approach.

## Files

- **`pixelprovenance.tex`** - Main paper (corrected, ready for submission)
- **`pixelprovenance-original.tex`** - Original version (QR/LSB approach, for reference)
- **`REWRITE-SUMMARY.md`** - Documents what was changed
- **`figures/`** - Old diagrams (QR-based, not used in corrected paper)

## Compile

Requires LaTeX. Install BasicTeX:
```bash
brew install --cask basictex
```

Then compile:
```bash
pdflatex pixelprovenance.tex
```

Or use Overleaf (upload .tex file, compiles in browser).

## Paper Details

**Title**: PixelProvenance: Component Identification via Frequency-Domain Encoding in Web Screenshots

**Author**: Jason Kneen

**Length**: ~8-10 pages, 2,799 words

**Approach**: Frequency-domain perceptual noise patterns + Pearson correlation matching

**Results**: 92.5% accuracy, 68ms decoding time

**ArXiv Categories**: cs.HC (primary), cs.SE (secondary)

## Submission

Ready for arXiv submission at https://arxiv.org/submit

The paper accurately describes the implementation in `/Users/jkneen/Documents/GitHub/morrow/`.
