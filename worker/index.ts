/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

type WorkerEnv = Env & {
  ASSETS: { fetch(request: Request): Promise<Response> };
};

function secureResponse(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests");
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const size = Number(request.headers.get("content-length") ?? "0");
      if (!Number.isFinite(size) || size > 65_536) return secureResponse(Response.json({ error: "요청 내용이 너무 큽니다." }, { status: 413 }), url.pathname);
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return secureResponse(Response.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 }), url.pathname);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const outputFormat = format === "image/jpeg" || format === "image/png" || format === "image/gif" || format === "image/webp" || format === "image/avif" || format === "rgb" || format === "rgba" ? format : "image/webp";
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format: outputFormat, quality });
          return result.response();
        },
      }, allowedWidths);
      return secureResponse(response, url.pathname);
    }

    try {
      return secureResponse(await handler.fetch(request, env, ctx), url.pathname);
    } catch (error) {
      console.error(JSON.stringify({ message: "unhandled request error", path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
      return secureResponse(Response.json({ error: "요청을 처리하지 못했습니다." }, { status: 500 }), url.pathname);
    }
  },
};

export default worker;
