import { PublicDetail } from "../../live-ui/public-detail";
export default async function Page({params}:{params:Promise<{token:string}>}){return <PublicDetail kind="receipt" token={(await params).token}/>;}
