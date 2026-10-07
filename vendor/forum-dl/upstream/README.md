![pyversions](https://img.shields.io/pypi/pyversions/forum-dl)
![license](https://img.shields.io/github/license/mikwielgus/forum-dl)

# forum-dl

Forum-dl is a scraper and archiver for forums (including Discourse, PhpBB, SMF), mailing lists, and news aggregators ([list](#forum-software)). It can be used to extract and archive all posts from individual threads and entire boards into JSONL, Mbox, Maildir, WARC ([complete list](#output-formats)).

<sub>The project is currently in alpha stage. Please do not hesitate to [file](https://github.com/mikwielgus/forum-dl/issues) bug reports and feature requests.</sub>

![image](https://github.com/mikwielgus/forum-dl/assets/58011230/e677d1aa-efa3-4cfc-9283-38408842b278)

# Installation

You can install stable Forum-dl from [PIP](#pip) or directly from the [repository](#repository). Minimum Python version is 3.10.11.

## PIP

Install the latest stable version from PIP:

```
pip install forum-dl
```

## Repository 

Clone the repository and install the development branch in editable mode:

```
git clone https://github.com/mikwielgus/forum-dl && pip install -e forum-dl
```

# Usage examples

Download a Simple Machines Forum thread in JSONL format:

```
forum-dl "https://www.simplemachines.org/community/index.php?topic=584230.0"
```

Save all images from the same thread in directory `files`:

```
forum-dl --files-output files "https://www.simplemachines.org/community/index.php?topic=584230.0"
```

Download a PhpBB subboard into JSONL format, write to stdout (`-o -`) and record a WARC file in `phpbb.warc`:

```
forum-dl --warc-output phpbb.warc "https://www.phpbb.com/community/viewforum.php?f=696"
```

<sub>(due to current architectural limitations, `forum-dl` will scan the first page of each board in the entire forum before downloading the target board. This will be fixed in future releases)</sub>

Download Hacker News top stories and write them to a Maildir directory `hn`:

```
forum-dl --textify --content-as-title -f maildir -o hn "https://news.ycombinator.com/news"
```

- `--textify` converts HTML to plaintext (useful for text-only mail clients),
- `--content-as-title` puts the beginning of each message's content in its title (useful for mail clients that don't display content in index view),
- `-f maildir` changes the output format to `maildir`,
- `-o hn` changes the output directory name to `hn`.

# What is supported

## Forum software

- Discourse
- Hacker News
- Hyperkitty
- Hypermail
- Invision Power Board
- PhpBB
- Pipermail
- Proboards
- Simple Machines Forum
- vBulletin
- Xenforo

## Output formats

- Babyl
- JSONL
- Maildir
- Mbox
- MH
- MMDF
- WARC

# Usage

```
forum-dl [--help] [--version] [--list-extractors] [--list-output-formats] [--timeout SECONDS] [-R N] [--retry-sleep SECONDS]
         [--retry-sleep-multiplier K] [--user-agent UA] [-q] [-v] [-g] [-o OUTFILE] [-f FORMAT] [--warc-output FILE]
         [--files-output DIR] [--boards | --no-boards] [--threads | --no-threads] [--posts | --no-posts]
         [--files | --no-files] [--outside-files | --no-outside-files] [--textify] [--content-as-title]
         [--author-as-addr-spec]
```

## General Options:

```
  --help                Show this help message and exit
  --version             Print program version and exit
  --list-extractors     List all supported extractors and exit
  --list-output-formats
                        List all supported output formats and exit
```

## Session Options:

```
  --timeout SECONDS     HTTP connection timeout
  -R N, --retries N     Maximum number of retries for failed HTTP requests or -1 to retry infinitely (default: 4)
  --retry-sleep SECONDS
                        Time to sleep between retries, in seconds (default: 1)
  --retry-sleep-multiplier K
                        A constant by which sleep time is multiplied on each retry (default: 2)
  --user-agent UA       User-Agent request header
```

## Output Options:

```
  -q, --quiet           Activate quiet mode
  -v, --verbose         Print various debugging information
  -g, --get-urls        Print URLs instead of downloading
  -o OUTFILE, --output OUTFILE
                        Output all results concatenated to OUTFILE, or stdout if OUTFILE is - (default: -)
  -f FORMAT, --output-format FORMAT
                        Output format. Use --list-output-formats for a list of possible arguments
  --warc-output FILE    Record HTTP requests, store them in FILE in WARC format
  --files-output DIR    Store files in DIR instead of OUTFILE
  --boards, --no-boards
                        Write board objects (default: True, --no-boards to negate)
  --threads, --no-threads
                        Write thread objects (default: True, --no-threads to negate)
  --posts, --no-posts   Write post objects (default: True, --no-posts to negate)
  --files, --no-files   Write embedded files (--no-files to negate)
  --outside-files, --no-outside-files
                        Write embedded files outside post content. Auto-enabled by --warc-output and -f warc (default: False, --no-
                        outside-files to negate)
  --textify             Lossily convert HTML content to plaintext
  --content-as-title    Write 98 initial characters of content in title field of each post
  --author-as-addr-spec
                        Append author and domain as an addr-spec in the From header
```
