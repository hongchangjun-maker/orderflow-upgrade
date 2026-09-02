import { jsonError } from "../../../lib/data";
import { validateMutationRequest } from "../../../lib/security";
import { createOrder } from "../../../modules/orders/create-order";
import { OrderInputError, type OrderPayload } from "../../../modules/orders/domain";

export async function POST(request: Request) {
  const invalidRequest = validateMutationRequest(request);
  if (invalidRequest) return invalidRequest;
  try {
    let payload: OrderPayload;
    try {
      payload = (await request.json()) as OrderPayload;
    } catch {
      return Response.json({ error: "JSON 요청 내용을 확인해 주세요.", code: "invalid_json" }, { status: 400 });
    }
    if (payload.website) return Response.json({ ok: true }, { status: 201 });
    const result = await createOrder(request, payload);
    return Response.json(result.body, { status: result.status, headers: result.headers });
  } catch (error) {
    if (error instanceof OrderInputError) {
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      if (error.status === 429) headers["Retry-After"] = "60";
      if (error.status === 503) headers["Retry-After"] = "1";
      return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
    }
    return jsonError(error);
  }
}
