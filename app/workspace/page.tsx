import { Workspace } from "./view";
import { context } from "../modules/live/context";
import { redirect } from "next/navigation";
export default async function Page() {
  try {
    await context(new Request("https://local.invalid/workspace"));
  } catch {
    redirect("/sign-in");
  }
  return <Workspace />;
}
