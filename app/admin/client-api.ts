export async function adminApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    cache: "no-store",
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "요청을 처리하지 못했습니다.");
  return data;
}
