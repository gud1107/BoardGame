/**
 * Chat message body normalization before send/store. React already escapes
 * plain text content by default (`{message.body}` never becomes markup), so
 * there is no HTML-escaping step here — and no chat code anywhere in this
 * project may use `dangerouslySetInnerHTML` to render a message body.
 */
const MAX_LENGTH = 300;

function isControlCodePoint(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

export function stripControlChars(text: string): string {
  const collapsedWhitespace = text.replace(/[\r\n\t]+/g, " ");
  let out = "";
  for (const ch of collapsedWhitespace) {
    if (!isControlCodePoint(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out.trim().slice(0, MAX_LENGTH);
}
