import re
import subprocess
import sys


def strip(text):
    """
    Removes:
    - Remove URLs (http/https or www)
    - yaml header
    - Fenced code blocks (```...```)
    - Inline code (`...`)
    - Inline LaTeX math ($...$)
    - Display LaTeX math ($$...$$)
    - LaTeX environments (\\begin{}...\\end{})
    - Fenced divs
    """
    text = re.sub(r'https?://\S+|www\.\S+', '', text)
    text = re.sub(r'^---\s*\n.*?\n---\s*\n', '', text, flags=re.DOTALL)
    text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)  # Fenced code
    text = re.sub(r'\$\$.*?\$\$', '', text, flags=re.DOTALL)  # Display math
    text = re.sub(r'\$(?:\\.|[^$\\])+\$', '', text)  # Inline math
    text = re.sub(r'\\begin\{.*?\}.*?\\end\{.*?\}', '', text, flags=re.DOTALL)  # LaTeX environments
    text = re.sub(r'`[^`]+`', '', text)  # Inline code
    text = re.sub(r'^:::\s*(\{.*?\}|\w+)?\s*$', '', text, flags=re.MULTILINE)

    return text

def get_words(text):
    """
    Extracts words from the text using regex. Adjust if you want to support hyphens or apostrophes.
    """
    return re.findall(r'\b[A-Za-z]+\b', text)

def check_spelling(words):
    """
    Checks spelling using the hunspell command-line tool.
    Returns a set of misspelled words.
    """
    # Launch hunspell in pipe mode (-a) and feed it all words
    process = subprocess.Popen(['hunspell', '-a'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)

    stdout, _ = process.communicate('\n'.join(words))

    misspelled = set()
    for line in stdout.splitlines():
        if line.startswith('&'):  # '&' means the word is misspelled
            parts = line.split()
            if len(parts) > 1:
                misspelled.add(parts[1])
        elif line.startswith('#'):  # '#' means no suggestions
            parts = line.split()
            if len(parts) > 1:
                misspelled.add(parts[1])
    return misspelled

def main(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        md_content = f.read()

    print(f"checking {filename}")
    clean_text = strip(md_content)
    words = get_words(clean_text)
    unique_words = sorted(set(words))

    misspelled = check_spelling(unique_words)

    if misspelled:
        print("Misspelled words:")
        for word in sorted(misspelled):
            print(f"- {word}")
        sys.exit(1)
    else:
        print("No misspellings found.")

if __name__ == '__main__':
    for fn in sys.argv[1:]:
        main(fn)
