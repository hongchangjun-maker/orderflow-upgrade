import {deliveryFee} from './pricing';
import {integer,LiveError,obj,rows,text,type Doc} from './domain';
import {first,list,setting,type LiveContext} from './store';
import {day,mobileOf} from './domain';
export async function feeRule(c:LiveContext,formId:number,delivery:string,method?:unknown,knownLink?:Doc){
  const link=knownLink??await setting(c,`/delivery-fee/urlorder/${formId}/link`);
  const override=method?await setting(c,`/delivery-fee/deliverygbn/${method}/link`):{};
  const ids=[(!override.uocode||Number(override.uocode)===formId)?override.feeNo:null,rows(link.rows).find(r=>Number(r.seqno)===Number(method))?.feeNo,link[delivery==='pickup'?'feeNoPickup':delivery==='parcel'?'feeNoParcel':'feeNoDeliver']];
  if(!ids.some(v=>Number(v)>0))return undefined;
  const fees=await list(c,'delivery-fee');
  for(const id of ids){const found=fees.find(r=>Number(r.id)===Number(id)&&r.useGbn!=='N');if(found)return found;}
  return undefined;
}
export async function previousDeliveryPaid(c:LiveContext,formId:number,input:Doc,excludeKey='',knownLink?:Doc){
  const link=knownLink??await setting(c,`/delivery-fee/urlorder/${formId}/link`);
  if(![true,'Y','true'].includes(link.sameDayMerge as boolean|string)||!input.mobile&&!input.phone)return false;
  return !!await first(c,"SELECT o.id FROM of_orders o JOIN of_customers cu ON cu.id=o.customer_id WHERE o.shop=? AND o.form_id=? AND cu.mobile=? AND o.order_date=? AND o.status<>'40' AND o.fee>0 AND o.key<>? AND COALESCE(json_extract(o.data,'$.addr'),'')=? AND COALESCE(json_extract(o.data,'$.addr2'),'')=? AND COALESCE(json_extract(o.data,'$.delivery_gbn'),'direct')=? AND COALESCE(json_extract(o.data,'$.pickup_time'),'')=? LIMIT 1",c.shop,formId,mobileOf(input.mobile??input.phone),day(),excludeKey,text(input.addr??input.address,400),text(input.addr2??input.addressDetail,200),text(input.delivery_gbn)||'direct',text(input.pickup_time,80));
}
export async function quoteFee(c:LiveContext,formId:number,settings:Doc,amount:number,delivery:string,address:string,method?:unknown,knownLink?:Doc){
  return deliveryFee(settings,amount,delivery,address,await feeRule(c,formId,delivery,method,knownLink));
}
export function validateFeeRule(data:Doc){
  const kind=text(data.feeGbn);
  if(kind==='FORCE')integer(data.deliveryTip);
  if(kind==='MIN_AMT')integer(data.minAmt);
  if(kind==='AMT3'){
    const tiers=(Array.isArray(data.amtArr)?data.amtArr:[]).map(Number).filter(n=>n>0);
    if(!tiers.length||new Set(tiers).size!==tiers.length)throw new LiveError('배송비 구간 금액은 중복 없이 입력해 주세요.',422);
    deliveryFee({},0,'direct','',data);
  }
  if(kind==='REGION'){
    for(const row of rows(data.regionRows)){if(!text(row.keyword)||(row.deny&&text(row.keyword).length<2))throw new LiveError('지역 키워드를 확인해 주세요.',422);if(!row.deny)integer(row.amt);}
    if(!data.otherDeny)integer(data.deliveryTip);
  }
  return {...obj(data)};
}
