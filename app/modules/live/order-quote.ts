import {cartOf,integer,LiveError,mobileOf,text,type Doc} from './domain';
import {formDetail} from './forms';
import {quoteFee,previousDeliveryPaid} from './fee-service';
import {orderMoney,paymentOptions} from './pricing';
import {first,setting,type LiveContext} from './store';
export async function quoteOrder(c:LiveContext,formId:number,input:Doc,editing=false,excludeKey='',knownDetail?:Awaited<ReturnType<typeof formDetail>>){
  const detail=knownDetail??await formDetail(c,formId),s=detail.setting;
  const items=cartOf(input.items).map(line=>{
    const row=detail.items.find(i=>Number(i.seqno)===line.id);
    if(!row||row.use_yn==='N'||row.cat_gbn==='CAT')throw new LiveError('주문할 수 없는 품목입니다.',422);
    if(!editing&&Number(row.stock)<line.qty)throw new LiveError('재고가 부족합니다.',409,'insufficient_stock');
    if(Number(row.item_min_qty)>line.qty||Number(row.item_max_qty)>0&&Number(row.item_max_qty)<line.qty)throw new LiveError('주문 수량 범위를 확인해 주세요.',422);
    return {...line,price:integer(row.cost),name:text(row.iname),unit:text(row.unit)};
  });
  const amount=items.reduce((n,i)=>n+i.price*i.qty,0),delivery=text(input.delivery_gbn??'direct'),pay=text(input.pay_gbn??'transfer');
  if(amount<Number(s.min_order_amount??0))throw new LiveError('최소 주문 금액보다 적습니다.',422);
  if(!['direct','pickup','parcel'].includes(delivery)||delivery==='pickup'&&s.delivery_pickup!=='Y'||delivery==='direct'&&s.delivery_deliver==='N'||delivery==='parcel'&&s.delivery_parcel!=='Y')throw new LiveError('선택할 수 없는 배송 방법입니다.',422);
  if(!paymentOptions(s,detail.payMethods).some(o=>o.value===pay))throw new LiveError('선택할 수 없는 결제 방법입니다.',422);
  const used=integer(input.point_used??input.point??0,0,amount);
  if(c.role==='CUSTOMER'&&(used>0||pay==='prepay')&&c.actor!==`customer:${mobileOf(input.mobile??input.phone)}`)throw new LiveError('고객전용 링크에서 확인번호를 입력한 후 잔액을 사용할 수 있습니다.',403,'customer_verification_required');
  const link=await setting(c,`/delivery-fee/urlorder/${formId}/link`);
  const calculatedFee=await quoteFee(c,formId,s,amount,delivery,text(input.addr??input.address,400),input.delivery_seqno,link);
  const fee=await previousDeliveryPaid(c,formId,input,excludeKey,link)?0:calculatedFee;
  const money=orderMoney(s,amount,fee,used);
  if(used>0||pay==='prepay'){
    const mobile=mobileOf(input.mobile??input.phone);
    for(const [kind,needed] of [['point',used],['prepay',pay==='prepay'?money.total:0]] as const){
      if(needed>0){const row=await first(c,'SELECT COALESCE(SUM(delta),0) balance FROM of_ledger WHERE shop=? AND mobile=? AND kind=?',c.shop,mobile,kind);if(Number(row?.balance??0)<needed)throw new LiveError('잔액이 부족합니다.',409,'insufficient_balance');}
    }
  }
  return {amount,fee,...money,items,delivery,pay};
}
