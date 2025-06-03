all:
	./qmd_ruff.py src/*.qmd
	uv run quarto render

formatlint:
	./qmd_ruff.py src/*.qmd

server:
	uv run quarto preview

book:
	uv run quarto render --to pdf

website:
	uv run quarto render --to html

clean:
	rm -rf _output
