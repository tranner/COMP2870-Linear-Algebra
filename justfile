@_:
    just --list

lint:
	./qmd_ruff.py src/*.qmd

serve:
	uv run quarto preview

build: lint
	uv run quarto render

_build output: lint
	uv run quarto render --to {{output}}

clean:
	rm -rf _output
