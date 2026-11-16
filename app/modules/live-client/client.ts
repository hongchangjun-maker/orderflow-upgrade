// Browser infrastructure port. UI components do not own HTTP/session serialization.
export async function liveRequest<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  options?:{signal?:AbortSignal},
): Promise<T> {
  const response = await fetch(path, {
    signal:options?.signal,
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
export async function liveUpload<T=Record<string,unknown>>(path:string,file:File):Promise<T>{
  const body=new FormData();body.set('file',file);
  const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'x-orderflow-request':'1'},body});
  const result=await response.json() as {data:T;error?:{message?:string}};
  if(!response.ok)throw new Error(result.error?.message??'첨부파일을 저장하지 못했습니다.');
  return result.data;
}
