/** Feed upstream WARC parsers completely consumed compressed ZIP ranges.
 * Header-only parsing may stop after any yielded chunk. Never leave a large
 * HTTP response stream open when the parser does not need the payload.
 */
export async function* warcRanges(
  load: (offset: number, length: number) => Promise<{ reader: { readFully(): Promise<Uint8Array> } }>,
  offset: number,
  length: number,
) {
  const end = offset + length;
  while (offset < end) {
    const size = Math.min(64 * 1024, end - offset);
    const { reader } = await load(offset, size);
    const bytes = await reader.readFully();
    if (bytes.length !== size) throw Error('Truncated compressed WARC range');
    offset += size;
    yield bytes;
  }
}
