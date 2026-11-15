import { CustomerOrder } from "../../live-ui/customer-order";
export default async function Page({params}:{params:Promise<{token:string}>}){return <CustomerOrder token={(await params).token}/>;}
