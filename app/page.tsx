import { redirect } from "next/navigation";
import {runtimeValue} from './lib/security';

export default function Home() {
  redirect(runtimeValue('PUBLIC_TEST_ENTRY')==='1'?'/try':'/replica');
}
