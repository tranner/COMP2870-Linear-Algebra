#!/usr/bin/env -S uv run python

import os
import subprocess
import sys

NO_CODE_PREFIX = "###--no code--### "
NO_QA_SUFFIX = " # noqa: E501"


def qmd_to_py(infile, outfile):
    with open(infile) as f:
        inlines = f.readlines()

    with open(outfile, "w") as f:
        incode = False

        for line in inlines:
            if incode:
                if "```" in line:
                    incode = False
                    f.write(NO_CODE_PREFIX + line[:-1] + NO_QA_SUFFIX + "\n")
                else:
                    f.write(line)

            else:
                if "```{python}" in line:
                    incode = True

                f.write(NO_CODE_PREFIX + line[:-1] + NO_QA_SUFFIX + "\n")


def py_to_qmd(infile, outfile):
    with open(infile) as f:
        inlines = f.readlines()

    with open(outfile, "w") as f:
        for line in inlines:
            if NO_CODE_PREFIX in line:
                line = line.removeprefix(NO_CODE_PREFIX)
            if NO_QA_SUFFIX in line:
                line = line.removesuffix(NO_QA_SUFFIX + "\n") + "\n"
            f.write(line)


def run_ruff_format(file_path):
    try:
        subprocess.run(["ruff", "format", file_path], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error formatting {file_path}: {e}")
        return 1
    return 0


def run_ruff_check(file_path):
    try:
        subprocess.run(["ruff", "check", file_path, "--fix"], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error sorting imports in {file_path}: {e}")
        return 4
    return 0


def delete_file(file_path):
    try:
        os.remove(file_path)
    except FileNotFoundError:
        print(f"File {file_path} not found.")
    except PermissionError:
        print(f"Permission denied: unable to delete {file_path}.")
    except Exception as e:
        print(f"Error deleting {file_path}: {e}")


def main(infile):
    infile_py = infile + ".py"

    # convert to python code with comments for other lines
    qmd_to_py(infile, infile_py)

    # format and check
    r0 = run_ruff_check(infile_py)
    r1 = run_ruff_format(infile_py)

    # convert back to qmd
    py_to_qmd(infile_py, infile)

    # delete temporary file
    delete_file(infile_py)

    return r0 + r1


if __name__ == "__main__":
    # read filename
    infiles = sys.argv[1:]
    for infile in infiles:
        r = main(infile)
        if r != 0:
            exit(r)
