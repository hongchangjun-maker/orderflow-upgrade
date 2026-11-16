"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from 'react';
import {liveRequest} from '../modules/live-client/client';
type Row=Record<string,unknown>;
export default function SupportInbox(){
  const [items,setItems]=useState<Row[]>([]),[messages,setMessages]=useState<Row[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{try{setItems(await liveRequest<Row[]>('/api/replica/inquiry/admin/list'));}catch(e){setError(e instanceof Error?e.message:'조회 실패');}},[]);
  useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[load]);
  const open=async(id:string)=>{try{setSelected(id);setMessages(await liveRequest<Row[]>('/api/replica/inquiry/admin/messages?inquiry_id='+encodeURIComponent(id)));setError('');}catch(e){setError(e instanceof Error?e.message:'조회 실패');}};
  return <main className="live-workspace"><h1>자체 문의함 관리</h1><p>현재 상점의 사장님만 볼 수 있습니다. 외부 고객지원으로 발송되지 않습니다.</p><Link href="/replica">운영 화면으로</Link>{error&&<p role="alert">{error}</p>}<section><h2>문의 목록</h2>{items.map(i=><p key={String(i.inquiry_id)}><button onClick={()=>void open(String(i.inquiry_id))}>{String(i.title)} · {String(i.status)} · 미읽음 {Number(i.unread_count??0)}</button></p>)}</section>{selected&&<section><h2>문의 내용</h2>{messages.map(m=><article key={String(m.id)}><b>{m.author_type==='admin'?'관리자':'문의자'}</b><p style={{whiteSpace:'pre-wrap'}}>{String(m.content??'')}</p></article>)}<form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,data=new FormData(form);setBusy(true);try{await liveRequest('/api/replica/inquiry/admin/send',{inquiry_id:selected,content:data.get('content')});form.reset();await open(selected);await load();}catch(e){setError(e instanceof Error?e.message:'저장 실패');}finally{setBusy(false);}}}><label>답변<textarea name="content" required maxLength={10000}/></label><button disabled={busy}>답변 저장</button></form></section>}</main>;
}
