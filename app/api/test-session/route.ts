import {openTestSession} from '../../modules/live/test-access';
import {failure} from '../../modules/live/router';
export async function POST(request:Request){
  try{const session=await openTestSession(request);const headers=new Headers({'Cache-Control':'no-store'});if(session.cookie)headers.append('Set-Cookie',session.cookie);return Response.json({next:'/replica/orders'},{headers});}catch(error){return failure(error);}
}
