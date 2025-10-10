@_:
    just --list

# lint all files
lint:
	uv run pre-commit run --all-files

# serve a preview of the output
serve:
	uv run quarto preview

# build all output formats
build: _build_book _build_slides

_build_book: lint
	uv run quarto render

# build a specific output, e.g. just _build pdf
_build output: lint
	uv run quarto render --to {{output}}

_build_slides:
	@for q in slides/*.qmd ; do just _build_slide $q ; done

_build_slide qmd_filename:
	mkdir -p $(dirname _output/{{qmd_filename}})
	uv run quarto render {{ qmd_filename }} -o - > _output/{{ without_extension(qmd_filename) }}.html

# remove all output files
clean:
	rm -rf _output _freeze
