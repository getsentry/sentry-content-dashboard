// Escape at the Markdown boundary, independently of XML/HTML parsing.
export function markdownText(value: string): string {
  return value.replace(/[&<>\\`*_{}\[\]()#+.!|~\-]/g, character => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return `\\${character}`;
  }).replace(/[\r\n]+/g, ' ');
}
