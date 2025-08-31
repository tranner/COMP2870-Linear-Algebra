# COMP2870 Theoretical Foundations of Computer Science II: Lecture notes on Linear Algebra

This repository holds the notes for a submodule on Linear Algebra as part of the module COMP2870 Theoretical Foundations of Computer Science II taught at the School of Computer Science, University of Leeds.

The notes are build by [`quarto`](https://quarto.org/) which takes a markdown files and generates html and pdf outputs.

Build versions of the notes are available at:

- <https://tranner.github.io/COMP2870-Linear-Algebra/COMP2870-Theoretical-Foundations--Linear-Algebra.pdf>
- <https://tranner.github.io/COMP2870-Linear-Algebra>

To build the notes locally, you will need the dependencies [`uv`](https://docs.astral.sh/uv/) and [`quarto`](https://quarto.org/) (and optionally [`just`](https://github.com/casey/just)). You can build all outputs or just serve a preview with

``` sh
# Serve a preview
uv run quarto preview

# Build all outputs
uv run quarto render
```

This commands are listed in `./justfile` along with some other options.
