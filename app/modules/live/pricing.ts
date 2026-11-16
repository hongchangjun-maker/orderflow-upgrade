import {integer,LiveError,obj,rows,text,type Doc} from './domain.ts';
export function amountDue(order:Doc){const d=obj(order.data);return Number(order.amount??order.order_amt??0)+Number(order.fee??order.delivery_amt??0)-Number(d.point_used??order.point_used??0)+Number(d.adjustment??order.adjustment??0);}
const numberList=(value:unknown):unknown[]=>{if(Array.isArray(value))return value;try{const parsed=JSON.parse(text(value,10000));if(Array.isArray(parsed))return parsed;}catch{/* legacy comma-separated fields */}return text(value,10000).split(',');};
export function deliveryFee(setting:Doc,amount:number,delivery:string,address='',rule?:Doc){
  if(delivery==='pickup'&&!rule)return 0;
  const r=rule??setting;
  const kind=text(r.feeGbn??r.delivery_tip_gbn);
  if(kind==='NO_TIP')return 0;
  if(kind==='MIN_AMT'){
    const min=integer(r.minAmt??r.delivery_tip_min_amt??0);
    if(amount<min)throw new LiveError(text(r.minAmtMessage??r.delivery_tip_min_amt_message)||`최소 주문금액 ${min.toLocaleString()}원 이상 주문해 주세요.`,422,'minimum_order');
    return 0;
  }
  if(kind==='FORCE')return integer(r.deliveryTip??r.delivery_tip_min_amt??r.shipping_fee??0);
  if(kind==='AMT3'){
    const amts=numberList(r.amtArr??r.delivery_amt_arr),tips=numberList(r.tipArr??r.delivery_tip_arr);
    const tiers=amts.map((v,i)=>({amount:Number(v),fee:tips[i]})).filter(t=>Number.isFinite(t.amount)&&t.amount>0).sort((a,b)=>a.amount-b.amount);
    if(!tiers.length)throw new LiveError('배송비 구간 설정을 확인해 주세요.',422);
    for(const tier of tiers)if(amount<tier.amount)return integer(tier.fee);
    return 0;
  }
  if(kind==='REGION'){
    const match=regionMatch(r,address);
    if(match?.deny===true || (!match && r.otherDeny===true))throw new LiveError('배송하지 않는 지역입니다. 픽업 또는 매장 문의를 이용해 주세요.',422,'delivery_denied');
    return integer(match?.amt??r.deliveryTip??0);
  }
  return integer(r.shipping_fee??r.delivery_amt??r.amt??0);
}
export function regionMatch(rule:Doc,address:string):Doc|undefined{
  const normalize=(s:unknown)=>text(s,1000).replace(/\s/gu,'').toLowerCase();
  return rows(rule.regionRows).flatMap((row,index)=>text(row.keyword).split(',').map(keyword=>({...row,keyword:keyword.trim(),sortNo:row.sortNo??index+1}))).filter(row=>normalize(row.keyword)&&normalize(address).includes(normalize(row.keyword))).sort((a,b)=>normalize(b.keyword).length-normalize(a.keyword).length)[0];
}
export function paymentOptions(setting:Doc,methods:Doc[]=[]){
  const options:Doc[]=[];
  if(setting.pay_tran!=='N')options.push({value:'transfer',label:'계좌이체'});
  if(setting.pay_store==='Y'||methods.some(r=>r.use_gbn==='Y'&&/매장|현장|현금/u.test(text(r.pay_name))))options.push({value:'store',label:'매장결제'});
  if(setting.pay_prepay==='Y'||methods.some(r=>r.use_gbn==='Y'&&/선결제|선입금/u.test(text(r.pay_name))))options.push({value:'prepay',label:'선결제 잔액'});
  return options;
}
export function orderMoney(setting:Doc,amount:number,fee:number,point:unknown=0){
  const used=integer(point??0,0,amount);
  if(used && setting.use_customer_use_point!=='Y')throw new LiveError('이 주문서는 포인트 사용을 지원하지 않습니다.',422);
  const rate=Number(setting.customer_point_rate??0);
  if(!Number.isFinite(rate)||rate<0||rate>100)throw new LiveError('포인트 적립률을 확인해 주세요.',422);
  return {point_used:used,point_earn_potential:setting.use_customer_save_point==='Y'?Math.floor((amount-used)*rate/100):0,saved_point:0,adjustment:0,total:amount+fee-used};
}
