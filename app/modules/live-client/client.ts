// Browser infrastructure port. UI components do not own HTTP/session serialization.
export async function liveRequest<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...(body !== undefined
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-orderflow-request": "1",
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = (await response.json()) as {
    data: T;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(result.error?.message ?? "요청을 처리하지 못했습니다.");
  return result.data;
}
export const operationId = () => crypto.randomUUID();
