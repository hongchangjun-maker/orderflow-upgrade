import { getD1 } from "../../lib/data";
import { fileResponse } from "../../modules/live/media";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return fileResponse(getD1(), (await params).token);
}
