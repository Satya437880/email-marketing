// Email apps turn street addresses and phone numbers into blue links on their own. An invisible character (zero-width
// non-joiner) inside them stops that detection, so the recipient sees normal text. Links, email and web addresses are left alone.
const BREAK = "‌";

const SEP = "(?:&nbsp;|[\\s().\\u2013-])";
const PHONE = new RegExp(`\\+?\\(?\\d(?:${SEP}*\\d){6,}`, "g");
const STREET = /\b\d{1,6}[A-Za-z]?(?:\s|&nbsp;)+(?:[A-Z0-9][\w.'-]*(?:\s|&nbsp;)+){0,4}(?:Ave|Avenue|St|Street|Rd|Road|Blvd|Boulevard|Dr|Drive|Lane|Ln|Way|Court|Ct|Cres|Crescent|Hwy|Highway|Pkwy|Parkway|Place|Pl)\b/;
const POSTAL = /\b[A-Z]\d[A-Z](?:\s|&nbsp;)?\d[A-Z]\d\b/;

function breakAddress(text: string): string {
  return text
    .split(/(\s+|&[#\w]+;)/)
    .map((word) => (/^&|@|:\/\/|^www\./i.test(word) ? word : word.replace(/\d(?=[\dA-Za-z])|\b[A-Za-z](?=[A-Za-z0-9])/g, `$&${BREAK}`)))
    .join("");
}

export function unlinkContactDetails(html: string): string {
  let inLink = 0;
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith("<")) {
        if (/^<a[\s>]/i.test(part)) inLink++;
        else if (/^<\/a\s*>/i.test(part)) inLink = Math.max(0, inLink - 1);
        return part;
      }
      if (inLink) return part;
      if (STREET.test(part) || POSTAL.test(part)) part = breakAddress(part);
      return part.replace(PHONE, (n) => n.replace(/\d(?=\d)/g, `$&${BREAK}`));
    })
    .join("");
}
