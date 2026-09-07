# PixelProvenance research archive

This archive describes the original auto-instrumentation prototype. The current
package uses explicit React tags and a registry; see the [root README](../README.md)
for its API and verified behavior.

## Available files

- [pixelprovenance.tex](pixelprovenance.tex): archived paper source.
- [PixelProvenance.pdf](../PixelProvenance.pdf): archived PDF at the repository root.
- [Public PDF](../public/pixelprovenance-paper.pdf): archived version served by the demo.

The two PDFs have different file hashes; they are not byte-identical copies.

Earlier README references to an original-version source, rewrite summary, and
figures directory did not correspond to files in this checkout.

## Compile the source

With a LaTeX installation containing the packages named in the source:

```bash
cd paper
pdflatex pixelprovenance.tex
pdflatex pixelprovenance.tex
```

Compilation and submission readiness have not been verified in the current review.

## Reported results

The paper is titled *PixelProvenance: Component Identification via Frequency-Domain
Encoding in Web Screenshots*, by Jason Kneen. It reports 92.5% identification
accuracy and a 68ms average decode time for the earlier implementation. These are
archived claims, not measurements of the current package. Current regression and
package checks are documented in [REVIEW.md](../REVIEW.md).
