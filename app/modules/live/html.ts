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
      "span","div","img",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
      "*":["style"],
      img:["src","alt","width","height"],
    },
    allowedSchemes: ["https"],
    allowProtocolRelative: false,
    transformTags:{img:(tagName,attribs)=>{
      const src=attribs.src??'';
      const own=/^https:\/\/(orderflow-korea-upgrade(?:-staging)?\.hhongcjun\.workers\.dev)\/live-image\//u.test(src)||/^http:\/\/localhost:\d+\/live-image\//u.test(src);
      return{tagName,attribs:{...attribs,src:own?new URL(src).pathname:src}};
    }},
    allowedStyles:{
      "*":{
        color:[/^#[0-9a-f]{3,8}$/iu,/^rgb\([\d ,]+\)$/u],
        "background-color":[/^#[0-9a-f]{3,8}$/iu],
        "text-align":[/^(left|right|center|justify)$/u],
        "font-size":[/^(1[0-9]|2[0-9]|3[0-6])px$/u],
        "font-weight":[/^(normal|bold|[1-9]00)$/u]
      }
    },
    exclusiveFilter:frame=>frame.tag==='img'&&!/^\/live-image\/[a-f\d-]{32,36}$/u.test(frame.attribs.src??''),
  });
