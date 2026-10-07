### Overview
`papers-dl` is a command line application for downloading scientific papers.

### Usage
```shell
# parse DOI identifiers from a file:
papers-dl parse -m doi --path pages/my-paper.html

# parse ISBN identifiers from a file, output matches as CSV:
papers-dl parse -m isbn --path pages/my-paper.html -f csv

# fetch paper with given identifier from any known provider:
papers-dl fetch "10.1016/j.cub.2019.11.030"

# fetch paper from any known Sci-Hub URL with verbose logging on, and store in "papers" directory:
papers-dl -v fetch -p "scihub" -o "papers" "10.1107/s0907444905036693"

# fetch paper from specific Sci-Hub URL:
papers-dl fetch -p "sci-hub.ee" "10.1107/s0907444905036693"

# fetch paper from SciDB (Anna's Archive):
papers-dl fetch -p "scidb" "10.1107/s0907444905036693"
```

### About

`papers-dl` attempts to be a comprehensive tool for gathering research papers from popular open libraries. There are other solutions for this (see "Other tools" below), but `papers-dl` is trying to fill its own niche:

- comprehensive: other tools usually work with a single library, while `papers-dl` is trying to support a collection of popular libraries.
- performant: `papers-dl` tries to improve search and retrieval times by making use of concurrency where possible.

That said, `papers-dl` may not be the best choice for your specific use case right now. For example, if you require features supported by a specific library, one of the more mature and specialized tools listed below may be a better option.

`papers-dl` was initially created to serve as an extractor for [ArchiveBox](https://archivebox.io), a powerful solution for self-hosted web archiving.

This project started as a fork of [scihub.py](https://github.com/zaytoun/scihub.py).

### Other tools

- [Scidownl](https://pypi.org/project/scidownl/)
- [arxiv-dl](https://pypi.org/project/arxiv-dl/)
- [Anna's Archive API](https://github.com/dheison0/annas-archive-api)

### Roadmap

`papers-dl`'s CLI is not yet stable.

Short-term roadmap:

**parsing**
- add support for parsing more identifier types like PMID and ISSN

**fetching**
- add support for downloading formats other than PDFs, like HTML or epub

**searching**
- add a CLI command for searching libraries for papers and metadata

