import { Workspace } from "./view";
import { context } from "../modules/live/context";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
export default async function Page() {
  try {
    await context(new Request("https://local.invalid/workspace",{headers:await headers()}));
  } catch {
    redirect("/sign-in");
  }
  return <Workspace />;
}
