import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Replace only platform ports: exercise the current media implementation without R2/D1/network.
const source = (
  await readFile(
    new URL("../app/modules/live/media.ts", import.meta.url),
    "utf8",
  )
)
  .replace(/^import[^\n]*\n/gmu, "")
  .replace(/^export /gmu, "");
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
}).outputText;
function fixture() {
  const records = [],
    objects = new Map();
  class LiveError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  const api = new Function(
    "env",
    "LiveError",
    "text",
    "list",
    "parse",
    "put",
    "query",
    "remove",
    `${code}; return {upload,fileResponse,imageType};`,
  )(
    {
      LIVE_MEDIA: {
        put: async (key, bytes) => objects.set(key, bytes),
        get: async (key) =>
          objects.has(key) ? { body: objects.get(key) } : null,
        delete: async (key) => objects.delete(key),
      },
    },
    LiveError,
    (value) => String(value ?? "").slice(0, 120),
    () => [],
    JSON.parse,
    async (_context, kind, value) => {
      records.push({ kind, ...value });
      return value;
    },
    () => [],
    () => {},
  );
  return {
    ...api,
    records,
    objects,
    context: { shop: "synthetic-shop", origin: "https://test.invalid" },
  };
}
const encoder = new TextEncoder();
function request(path, filename, bytes) {
  const form = new FormData();
  form.set(
    "file",
    new File([bytes], filename, { type: "application/octet-stream" }),
  );
  return new Request(`https://test.invalid${path}`, {
    method: "POST",
    body: form,
  });
}
const sellerUpload = "/api/replica/chat/upload";
const publicUpload = `/api/live-public/chat/${"a".repeat(32)}/upload`;

test("chat-only PDF/UTF-8 TXT/CSV uploads persist separate attachment capabilities", async () => {
  const f = fixture();
  for (const [path, name, body, mime] of [
    [
      sellerUpload,
      "청과 주문.pdf",
      "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n",
      "application/pdf",
    ],
    [
      publicUpload,
      "안내.txt",
      "매장 주문 안내\n안녕하세요",
      "text/plain; charset=utf-8",
    ],
    [sellerUpload, "상품.csv", "상품,수량\n사과,20", "text/csv; charset=utf-8"],
  ]) {
    const result = await f.upload(
      f.context,
      request(path, name, encoder.encode(body)),
    );
    assert.equal(result.kind, "file");
    assert.equal(result.thumbUrl, "");
    assert.match(
      result.fileUrl,
      /^https:\/\/test\.invalid\/live-file\/[a-f\d]{32}$/u,
    );
    assert.equal(f.records.at(-1).kind, "attachment");
    assert.equal(f.records.at(-1).type, mime);
  }
});

test("images-only path and disguised executable/archive/HTML/SVG/invalid UTF-8 are rejected", async () => {
  const f = fixture();
  for (const [path, name, bytes] of [
    [
      "/api/replica/images/upload",
      "file.pdf",
      encoder.encode("%PDF-1.7\n%%EOF"),
    ],
    [sellerUpload, "fake.pdf", encoder.encode("not PDF\n%%EOF")],
    [sellerUpload, "truncated.pdf", encoder.encode("%PDF-1.7\nno end")],
    [
      sellerUpload,
      "page.txt",
      encoder.encode("<!doctype html><html>bad</html>"),
    ],
    [sellerUpload, "image.txt", encoder.encode("<svg onload='alert(1)'>")],
    [sellerUpload, "binary.txt", new Uint8Array([0xc3, 0x28])],
    [sellerUpload, "program.txt", encoder.encode("MZ program")],
    [sellerUpload, "archive.csv", new Uint8Array([0x50, 0x4b, 3, 4])],
    [sellerUpload, "program.exe", encoder.encode("hello")],
    [sellerUpload, "archive.zip", encoder.encode("hello")],
  ])
    await assert.rejects(
      () => f.upload(f.context, request(path, name, bytes)),
      (error) => error.status === 422,
    );
  assert.equal(f.objects.size, 0);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=",
    "base64",
  );
  assert.equal(
    (
      await f.upload(
        f.context,
        request("/api/replica/images/upload", "image.png", png),
      )
    ).kind,
    "image",
  );
  const shortWebp = Buffer.alloc(26);
  shortWebp.write("RIFF");
  shortWebp.writeUInt32LE(18, 4);
  shortWebp.write("WEBPVP8 ", 8);
  shortWebp.writeUInt32LE(6, 16);
  assert.equal(f.imageType(shortWebp), "");
});

test("10MB files are accepted and actual/declarative/multipart excess is rejected before storage", async () => {
  const f = fixture();
  await f.upload(
    f.context,
    request(sellerUpload, "limit.txt", new Uint8Array(10_000_000).fill(65)),
  );
  await assert.rejects(
    () =>
      f.upload(
        f.context,
        request(sellerUpload, "large.txt", new Uint8Array(10_000_001).fill(65)),
      ),
    (error) => error.status === 413,
  );
  await assert.rejects(
    () =>
      f.upload(
        f.context,
        new Request(`https://test.invalid${sellerUpload}`, {
          method: "POST",
          headers: { "content-length": "10100001" },
          body: "x",
        }),
      ),
    (error) => error.status === 413,
  );
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(10_100_001));
      controller.close();
    },
  });
  await assert.rejects(
    () =>
      f.upload(
        f.context,
        new Request(`https://test.invalid${sellerUpload}`, {
          method: "POST",
          body: stream,
          duplex: "half",
        }),
      ),
    (error) => error.status === 413,
  );
  assert.equal(f.objects.size, 1);
});

test("file capability response is download-only, UTF-8 named, uncached and never exposes missing tokens", async () => {
  const f = fixture();
  await f.upload(
    f.context,
    request(sellerUpload, '청과\r\n"주문.txt', encoder.encode("주문 정보")),
  );
  const record = f.records[0];
  let query = "";
  const db = {
    prepare(sql) {
      query = sql;
      return {
        bind() {
          return { first: async () => ({ data: JSON.stringify(record) }) };
        },
      };
    },
  };
  const response = await f.fileResponse(db, record.token);
  assert.match(query, /kind='attachment' AND deleted=0/u);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'none'; sandbox",
  );
  assert.match(
    response.headers.get("content-disposition"),
    /^attachment;.*filename\*=UTF-8''/u,
  );
  assert.doesNotMatch(response.headers.get("content-disposition"), /[\r\n]/u);
  assert.equal(await response.text(), "주문 정보");
  assert.equal((await f.fileResponse(db, "invalid")).status, 404);
});
