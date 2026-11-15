import { env } from "cloudflare:workers";
import { LiveError, text, type Doc } from "./domain";
import { list, parse, put, query, remove, type LiveContext } from "./store";
const bucket = () => {
  const b = Reflect.get(env, "LIVE_MEDIA") as R2Bucket | undefined;
  if (!b) throw new LiveError("파일 저장소가 연결되지 않았습니다.", 503);
  return b;
};
export async function upload(c: LiveContext, request: Request) {
  // Enforce the actual streamed size too: Content-Length is not trusted.
  const reader = request.body?.getReader();
  if (!reader) throw new LiveError("파일을 선택해 주세요.", 422);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 2_100_000) {
      await reader.cancel();
      throw new LiveError("이미지는 2MB 이하로 업로드해 주세요.", 413);
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const form = await new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body,
  }).formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > 2000000)
    throw new LiveError("이미지는 2MB 이하로 업로드해 주세요.", 422);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type =
    bytes[0] === 0xff && bytes[1] === 0xd8
      ? "image/jpeg"
      : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
        ? "image/png"
        : new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
            new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
          ? "image/webp"
          : "";
  if (!type) throw new LiveError("JPG·PNG·WebP 이미지만 허용됩니다.", 422);
  const token = crypto.randomUUID().replaceAll("-", "");
  const key = `${c.shop}/${token}`;
  await bucket().put(key, bytes, { httpMetadata: { contentType: type } });
  try {
    const row = await put(c, "image", {
      token,
      key,
      type,
      file_name: text(file.name, 120),
      file_name_thumb: `${c.origin}/live-image/${token}`,
      fcodekey: token,
      size: file.size,
      folder: 0,
    });
    return {
      ...row,
      kind: "image",
      fileUrl: `${c.origin}/live-image/${token}`,
      thumbUrl: `${c.origin}/live-image/${token}`,
      fileName: text(file.name, 120),
      fileSize: file.size,
    };
  } catch (error) {
    await bucket().delete(key);
    throw error;
  }
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
