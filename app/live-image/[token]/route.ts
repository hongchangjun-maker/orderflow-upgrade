import { getD1 } from "../../lib/data";
import { imageResponse } from "../../modules/live/media";
export async function GET(_request:Request,{params}:{params:Promise<{token:string}>}){return imageResponse(getD1(),(await params).token);}
