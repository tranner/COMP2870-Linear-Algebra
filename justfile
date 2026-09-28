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
	mkdir -p $(dirname _output/{{ qmd_filename }})
	uv run quarto render {{ qmd_filename }}
	mv {{ without_extension(qmd_filename) }}.html _output/{{ without_extension(qmd_filename) }}.html
	mv {{ without_extension(qmd_filename) }}_files _output/{{ without_extension(qmd_filename) }}_files

slides_port := "4300"

# live preview the slides project (all decks) on slides_port, or just one deck,
# e.g. just _preview_slides slides/lec03.qmd
_preview_slides qmd_filename="slides":
	uv run quarto preview {{ qmd_filename }} --port {{ slides_port }} --host 0.0.0.0 --no-browser

# remove all output files
clean:
	rm -rf _output _freeze
