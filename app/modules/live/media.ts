import { env } from "cloudflare:workers";
import { LiveError, text, type Doc } from "./domain";
import { list, parse, put, query, remove, type LiveContext } from "./store";
const maxImageBytes = 10_000_000;
// The file limit excludes multipart boundaries and ordinary form fields.
const maxUploadBytes = maxImageBytes + 100_000;
const uploadLimitMessage = "이미지는 10MB 이하로 업로드해 주세요.";
const attachmentTypes = new Set([
  "application/pdf",
  "text/plain; charset=utf-8",
  "text/csv; charset=utf-8",
]);
// This is format validation, not a complete malware scan. Downloads stay attachments.
function attachmentType(bytes: Uint8Array, filename: string): string {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (extension === "pdf") {
    const head = new TextDecoder("ascii").decode(bytes.subarray(0, 16));
    const tail = new TextDecoder("ascii").decode(
      bytes.subarray(Math.max(0, bytes.length - 1024)),
    );
    return /^%PDF-1\.[0-7](?:\r|\n)/u.test(head) ||
      /^%PDF-2\.0(?:\r|\n)/u.test(head)
      ? /%%EOF[\t\r\n ]*$/u.test(tail)
        ? "application/pdf"
        : ""
      : "";
  }
  if (extension !== "txt" && extension !== "csv") return "";
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "";
  }
  for (const character of content) {
    const code = character.charCodeAt(0);
    if (code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13))
      return "";
  }
  if (
    /^\s*(?:MZ|#!|%PDF-)/u.test(content) ||
    /<\s*(?:!doctype\s+html|html\b|svg\b|script\b|iframe\b|object\b|embed\b)/iu.test(
      content,
    )
  )
    return "";
  return extension === "csv"
    ? "text/csv; charset=utf-8"
    : "text/plain; charset=utf-8";
}
function safeFileName(value: unknown) {
  return (
    new TextDecoder()
      .decode(new TextEncoder().encode(text(value, 120)))
      .replace(/[\p{Cc}/\\:*?"<>|\u202a-\u202e\u2066-\u2069]/gu, "_")
      .replace(/^\.+/u, "_") || "attachment"
  );
}
function imageType(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  const validSize = (width: number, height: number) =>
    width > 0 &&
    height > 0 &&
    width <= 30_000 &&
    height <= 30_000 &&
    width * height <= 100_000_000;
  if (
    bytes.length >= 45 &&
    ascii(0, 8) === "\x89PNG\r\n\x1a\n" &&
    view.getUint32(8) === 13 &&
    ascii(12, 4) === "IHDR" &&
    view.getUint32(bytes.length - 12) === 0 &&
    ascii(bytes.length - 8, 4) === "IEND"
  ) {
    if (!validSize(view.getUint32(16), view.getUint32(20))) return "";
    let cursor = 8;
    let hasImageData = false;
    while (cursor + 12 <= bytes.length) {
      const length = view.getUint32(cursor);
      if (length > bytes.length - cursor - 12) return "";
      const kind = ascii(cursor + 4, 4);
      if (kind === "IDAT" && length > 0) hasImageData = true;
      cursor += length + 12;
      if (kind === "IEND")
        return hasImageData && cursor === bytes.length ? "image/png" : "";
    }
    return "";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  ) {
    let cursor = 2;
    let dimensionsValid = false;
    while (cursor + 4 <= bytes.length) {
      if (bytes[cursor++] !== 0xff) return "";
      while (bytes[cursor] === 0xff) cursor++;
      const marker = bytes[cursor++];
      if (marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (cursor + 2 > bytes.length) return "";
      const length = view.getUint16(cursor);
      if (length < 2 || cursor + length > bytes.length) return "";
      if (marker === 0xda)
        return dimensionsValid && length >= 6 ? "image/jpeg" : "";
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if (length < 8) return "";
        dimensionsValid = validSize(
          view.getUint16(cursor + 5),
          view.getUint16(cursor + 3),
        );
        if (!dimensionsValid) return "";
      }
      cursor += length;
    }
    return "";
  }
  if (
    bytes.length >= 26 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 4) === "WEBP" &&
    view.getUint32(4, true) + 8 === bytes.length
  ) {
    const kind = ascii(12, 4),
      chunkSize = view.getUint32(16, true);
    if (chunkSize > bytes.length - 20) return "";
    if (kind === "VP8X" && chunkSize === 10 && bytes.length >= 30) {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      if (!validSize(width, height)) return "";
      let cursor = 30;
      let hasImageData = false;
      while (cursor + 8 <= bytes.length) {
        const size = view.getUint32(cursor + 4, true);
        if (size > bytes.length - cursor - 8) return "";
        const kind = ascii(cursor, 4);
        if (
          (kind === "VP8 " &&
            size >= 10 &&
            ascii(cursor + 11, 3) === "\x9d\x01\x2a") ||
          (kind === "VP8L" && size >= 5 && bytes[cursor + 8] === 0x2f) ||
          (kind === "ANMF" && size >= 24)
        )
          hasImageData = true;
        cursor += 8 + size + (size & 1);
      }
      return hasImageData && cursor === bytes.length ? "image/webp" : "";
    }
    if (
      kind === "VP8 " &&
      chunkSize >= 10 &&
      bytes.length >= 30 &&
      ascii(23, 3) === "\x9d\x01\x2a"
    )
      return validSize(
        view.getUint16(26, true) & 0x3fff,
        view.getUint16(28, true) & 0x3fff,
      )
        ? "image/webp"
        : "";
    if (kind === "VP8L" && chunkSize >= 5 && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return validSize((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
        ? "image/webp"
        : "";
    }
  }
  return "";
}
const bucket = () => {
  const b = Reflect.get(env, "LIVE_MEDIA") as R2Bucket | undefined;
  if (!b) throw new LiveError("파일 저장소가 연결되지 않았습니다.", 503);
  return b;
};
export async function upload(c: LiveContext, request: Request) {
  const pathname = new URL(request.url).pathname;
  const allowAttachment =
    pathname === "/api/replica/chat/upload" ||
    /^\/api\/live-public\/chat\/[a-f\d]{32}\/upload$/u.test(pathname);
  const limitMessage = allowAttachment
    ? "첨부 파일은 10MB 이하로 업로드해 주세요."
    : uploadLimitMessage;
  const declaredSize = request.headers.get("content-length");
  if (
    declaredSize !== null &&
    (!/^\d+$/u.test(declaredSize) ||
      !Number.isSafeInteger(Number(declaredSize)))
  )
    throw new LiveError("파일 크기 정보가 올바르지 않습니다.", 422);
  if (declaredSize !== null && Number(declaredSize) > maxUploadBytes) {
    await request.body?.cancel();
    throw new LiveError(limitMessage, 413);
  }
  // Enforce the actual streamed size too: Content-Length is not trusted.
  const reader = request.body?.getReader();
  if (!reader) throw new LiveError("파일을 선택해 주세요.", 422);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxUploadBytes) {
      await reader.cancel();
      throw new LiveError(limitMessage, 413);
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body,
    }).formData();
  } catch {
    throw new LiveError("올바른 파일 업로드 형식이 아닙니다.", 422);
  }
  const file = form.get("file");
  if (
    !(file instanceof File) ||
    form.getAll("file").length !== 1 ||
    file.size < 1
  )
    throw new LiveError("파일 하나를 선택해 주세요.", 422);
  if (file.size > maxImageBytes) throw new LiveError(limitMessage, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageMime = imageType(bytes);
  const type =
    imageMime || (allowAttachment ? attachmentType(bytes, file.name) : "");
  if (!type)
    throw new LiveError(
      allowAttachment
        ? "JPG·PNG·WebP 이미지와 PDF·UTF-8 TXT·CSV 파일만 허용됩니다."
        : "JPG·PNG·WebP 이미지만 허용됩니다.",
      422,
    );
  const kind = imageMime ? "image" : "attachment";
  const filename = safeFileName(file.name);
  const token = crypto.randomUUID().replaceAll("-", "");
  const key = `${c.shop}/${token}`;
  const fileUrl = `${c.origin}/${imageMime ? "live-image" : "live-file"}/${token}`;
  await bucket().put(key, bytes, { httpMetadata: { contentType: type } });
  try {
    const row = await put(c, kind, {
      token,
      key,
      type,
      file_name: filename,
      file_name_thumb: fileUrl,
      fcodekey: token,
      size: file.size,
      folder: 0,
    });
    return {
      ...row,
      kind: imageMime ? "image" : "file",
      fileUrl,
      thumbUrl: imageMime ? fileUrl : "",
      fileName: filename,
      fileSize: file.size,
    };
  } catch (error) {
    await bucket().delete(key);
    throw error;
  }
}
export async function fileResponse(db: D1Database, token: string) {
  if (!/^[a-f\d]{32}$/u.test(token))
    return new Response("Not found", { status: 404 });
  const row = await db
    .prepare(
      "SELECT data FROM of_records WHERE kind='attachment' AND deleted=0 AND json_extract(data,'$.token')=?",
    )
    .bind(token)
    .first<Doc>();
  if (!row) return new Response("Not found", { status: 404 });
  const data = parse(row.data);
  if (!attachmentTypes.has(String(data.type)))
    return new Response("Not found", { status: 404 });
  const file = await bucket().get(String(data.key));
  if (!file) return new Response("Not found", { status: 404 });
  const filename = safeFileName(data.file_name);
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return new Response(file.body, {
    headers: {
      "Content-Type": String(data.type),
      "Content-Disposition": `attachment; filename="attachment.${
        filename
          .split(".")
          .at(-1)
          ?.replace(/[^a-z0-9]/giu, "") || "bin"
      }"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}
export async function imageResponse(db: D1Database, token: string) {
  if (!/^[a-f\d]{32}$/u.test(token))
    return new Response("Not found", { status: 404 });
  const row = await db
    .prepare(
      "SELECT data FROM of_records WHERE kind='image' AND deleted=0 AND json_extract(data,'$.token')=?",
    )
    .bind(token)
    .first<Doc>();
  if (!row) return new Response("Not found", { status: 404 });
  const data = parse(row.data);
  const file = await bucket().get(String(data.key));
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.body, {
    headers: {
      "Content-Type": String(data.type),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public,max-age=3600",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
export async function mediaApi(
  c: LiveContext,
  path: string,
  method: string,
  data: Doc,
) {
  if (path === "/images")
    return {
      images: await list(c, "image"),
      total: (await list(c, "image")).length,
    };
  if (path === "/images/folders") {
    if (method === "GET") return list(c, "image-folder");
    return put(c, "image-folder", data, Number(data.seqno ?? 0));
  }
  if (/^\/images\/folders\/\d+$/u.test(path) && method === "DELETE")
    return remove(c, "image-folder", Number(path.split("/").at(-1)));
  if (path === "/images/save-meta" || path === "/images/move") {
    let changed = 0;
    for (const record of await list(c, "image")) {
      if (
        Array.isArray(data.fcodekeys) &&
        data.fcodekeys.includes(record.fcodekey)
      ) {
        await put(c, "image", { ...record, ...data }, Number(record.id));
        changed++;
      }
    }
    return { affected: changed };
  }
  if (path === "/images/delete" || path === "/images/restore") {
    let changed = 0;
    const keys = Array.isArray(data.fcodekeys) ? data.fcodekeys : [];
    for (const key of keys) {
      const found = await query(
        c,
        "SELECT id FROM of_records WHERE shop=? AND kind='image' AND json_extract(data,'$.fcodekey')=?",
        c.shop,
        key,
      );
      for (const row of found) {
        await c.db
          .prepare("UPDATE of_records SET deleted=? WHERE id=? AND shop=?")
          .bind(path.endsWith("restore") ? 0 : 1, row.id, c.shop)
          .run();
        changed++;
      }
    }
    return { affected: changed };
  }
  return undefined;
}
