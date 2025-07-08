@_:
    just --list

lint:
	./qmd_ruff.py src/*.qmd

server:
	uv run quarto preview

build:
	_build html
	_build pdf

_build output:
	uv run quarto render --to {{output}}

clean:
	rm -rf _output
