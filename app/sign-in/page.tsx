import { LiveLogin } from "./view";
import {runtimeValue} from '../lib/security';
import {redirect} from 'next/navigation';
export default async function Page({searchParams}:{searchParams?:Promise<{mode?:string}>}) {
  const query=await searchParams;
  if(runtimeValue('PUBLIC_TEST_ENTRY')==='1'&&query?.mode!=='live')redirect('/try');
  return <LiveLogin />;
}
