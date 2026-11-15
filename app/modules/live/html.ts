import sanitizeHtml from "sanitize-html";
import { text } from "./domain";
// Rich-text input is untrusted even when submitted by an employee.
export const cleanHtml = (value: unknown) =>
  sanitizeHtml(text(value, 20000), {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "s",
      "ul",
      "ol",
      "li",
      "h2",
      "h3",
      "blockquote",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["https"],
    allowProtocolRelative: false,
  });
