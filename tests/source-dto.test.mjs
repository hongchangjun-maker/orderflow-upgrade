import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceOrderDTO,sourceOrderRows} from '../public/replica-assets/order-dto.mjs';
test('source order vocabulary roundtrips without changing canonical public API',()=>{
  const order={header:{delivery_gbn:'direct',pay_gbn:'transfer',tamt:1234},orders:[{delivery_gbn:'pickup',pay_gbn:'store'}],memo:'store'};
  const projected=sourceOrderDTO(order);
  assert.equal(projected.header.delivery_gbn,'배달');assert.equal(projected.orders[0].pay_gbn,'현금');
  assert.deepEqual(sourceOrderDTO(projected,false),order);assert.equal(order.header.delivery_gbn,'direct');
  assert.equal(sourceOrderDTO({code_name:'prepay'},true,'pay').code_name,'선결제');
  assert.equal(sourceOrderDTO({delivery_gbn:'새벽배송'}).delivery_gbn,'새벽배송');
  assert.equal(sourceOrderDTO({orderno:624}).orderno.slice(-4),'624');
});
test('frozen source grid subtracts reserved points exactly once',()=>{
  const canonical={tamt:8500,point:1000,damt:1500};
  const row=sourceOrderRows([canonical])[0];
  assert.equal(row.tamt,9500);assert.equal(row.damt,500);assert.equal(row.tamt-row.point,8500);
  assert.equal(canonical.tamt,8500);
});
