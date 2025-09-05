@_:
    just --list

# lint all files
lint:
	uv run pre-commit run --all-files

# serve a preview of the output
serve:
	uv run quarto preview

# build all output formats
build: lint
	uv run quarto render

# build a specific output, e.g. just _build pdf
_build output: lint
	uv run quarto render --to {{output}}

# remove all output files
clean:
	rm -rf _output
