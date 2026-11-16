import test from 'node:test';
import assert from 'node:assert/strict';
import {amountDue,deliveryFee,orderMoney,paymentOptions} from '../app/modules/live/pricing.ts';
test('gross product subtotal, delivery, points and adjustment have one net total',()=>{
  assert.equal(amountDue({amount:10000,fee:3000,data:{point_used:2000,adjustment:-500}}),10500);
});
test('legacy fixed fees and default free pickup remain compatible',()=>{
  assert.equal(deliveryFee({shipping_fee:3000},10000,'direct'),3000);
  assert.equal(deliveryFee({shipping_fee:3000},10000,'pickup'),0);
  assert.equal(deliveryFee({},10000,'pickup','',{feeGbn:'FORCE',deliveryTip:1000}),1000);
});
test('amount tiers sort thresholds together with fees and above max is free',()=>{
  const rule={feeGbn:'AMT3',amtArr:[50000,10000,30000],tipArr:[1000,3000,2000]};
  assert.equal(deliveryFee({},9000,'direct','',rule),3000);
  assert.equal(deliveryFee({},10000,'direct','',rule),2000);
  assert.equal(deliveryFee({},50000,'direct','',rule),0);
});
test('minimum orders reject and region matching chooses most specific keyword',()=>{
  assert.throws(()=>deliveryFee({},9000,'direct','',{feeGbn:'MIN_AMT',minAmt:10000}));
  const rule={feeGbn:'REGION',deliveryTip:3000,regionRows:[{keyword:'서울',amt:2000},{keyword:'서울 강남',amt:1000},{keyword:'제주',deny:true}]};
  assert.equal(deliveryFee({},10000,'direct','서울 강남구',rule),1000);
  assert.throws(()=>deliveryFee({},10000,'direct','제주',rule));
  assert.throws(()=>deliveryFee({},10000,'direct','부산',{...rule,otherDeny:true}));
});
test('points are bounded and earned points wait for completed-and-paid posting',()=>{
  const m=orderMoney({use_customer_use_point:'Y',use_customer_save_point:'Y',customer_point_rate:3},9999,3000,1000);
  assert.equal(m.total,11999);assert.equal(m.point_earn_potential,269);assert.equal(m.saved_point,0);
  assert.throws(()=>orderMoney({},1000,0,1));assert.throws(()=>orderMoney({use_customer_use_point:'Y'},1000,0,1001));
});
test('payment capabilities never imply unconfigured card processing',()=>{
  assert.deepEqual(paymentOptions({pay_tran:'N',pay_store:'Y',pay_prepay:'Y'}).map(x=>x.value),['store','prepay']);
  assert.deepEqual(paymentOptions({},[{pay_name:'체크·신용카드',use_gbn:'Y'}]).map(x=>x.value),['transfer']);
});
