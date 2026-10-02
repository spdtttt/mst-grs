"use client";
import { useEffect, useRef, useState } from "react";
import Select from "react-select";
import { Loader2, Search, UserPlus } from "lucide-react";
import { createManager, listManagers } from "@/app/account-actions";
import { accountFullName, managerInputSchema, type AccountList, type AccountRow } from "@/lib/admin-accounts";
import AdminAccountRow from "./admin-account-row";

const emptyForm={name_prefix:"",first_name:"",last_name:"",username:"",password:""};
const prefixOptions=["นาย","นาง","นางสาว"].map(value=>({value,label:value}));
const inputClass="mt-1 w-full rounded border border-line bg-white px-3 py-2.5 text-sm focus:border-brand";
const buttonClass="cursor-pointer rounded border border-line px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50";
const sample: AccountRow[]=[{id:"demo-manager-1",full_name:"นายบริหาร ใจดี",name_prefix:"นาย",first_name:"บริหาร",last_name:"ใจดี",username:"manager.demo",account_revision:0}];

export default function AdminManagers({demo=false,currentUserId}:{demo?:boolean;currentUserId:string}) {
  const [values,setValues]=useState(emptyForm);
  const [data,setData]=useState<AccountList>({total:0,items:[]});
  const [demoRows,setDemoRows]=useState(sample);
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(1);
  const [refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const saving=useRef(false);
  useEffect(()=>{
    let cancelled=false;
    const timer=setTimeout(async()=>{
      setLoading(true);setLoadError("");
      try {
        const matches=demoRows.filter(row=>`${row.full_name} ${row.username ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()))
          .sort((a,b)=>a.full_name.localeCompare(b.full_name,"th"));
        const result=demo ? {data:{total:matches.length,items:matches.slice((page-1)*50,page*50)}} : await listManagers({search,page});
        if(cancelled)return;
        if(result.error) {setLoadError(result.error);setData({total:0,items:[]});}
        else if(result.data) {
          setData(result.data);
          if(page>Math.max(1,Math.ceil(result.data.total/50)))setPage(Math.max(1,Math.ceil(result.data.total/50)));
        }
      } catch {if(!cancelled)setLoadError("โหลดรายชื่อผู้บริหารไม่สำเร็จ กรุณาลองอีกครั้ง");}
      finally {if(!cancelled)setLoading(false);}
    },250);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[demo,demoRows,search,page,refresh]);
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(saving.current)return;
    setError("");setNotice("");
    const parsed=managerInputSchema.safeParse(values);
    if(!parsed.success) {setError(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");return;}
    if(demo && demoRows.some(row=>row.username===parsed.data.username)) {setError("ชื่อผู้ใช้งานนี้มีบัญชีอยู่แล้ว");return;}
    saving.current=true;setBusy(true);
    try {
      const result=demo ? {success:true} : await createManager(parsed.data);
      if(result.error || !result.success) {setError(result.error ?? "สร้างบัญชีไม่สำเร็จ");return;}
      if(demo) {
        const {password:_password,...profile}=parsed.data;
        setDemoRows(rows=>[...rows,{...profile,id:crypto.randomUUID(),full_name:accountFullName(profile),account_revision:0}]);
      }
      setValues(emptyForm);setRefresh(value=>value+1);setNotice(`เพิ่มบัญชีผู้บริหารแล้ว${demo ? " · ข้อมูลทดลอง" : ""}`);
    } catch {setError("ไม่สามารถยืนยันการสร้างบัญชีได้ กรุณาโหลดรายชื่อใหม่ก่อนลองอีกครั้ง");}
    finally {saving.current=false;setBusy(false);}
  }
  const pages=Math.max(1,Math.ceil(data.total/50));
  return <div className="space-y-6">
    <section className="rounded-xl border border-line bg-white p-5 max-desk:p-4" aria-label="เพิ่มผู้บริหาร">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><UserPlus size={20} className="text-brand" />เพิ่มข้อมูลผู้บริหาร</h2>
      <form onSubmit={submit} className="mt-4">
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div><label htmlFor="manager-prefix" className="text-sm">คำนำหน้าชื่อ</label>
            <Select inputId="manager-prefix" instanceId="manager-prefix" name="name_prefix" className="mt-1" options={prefixOptions}
              value={prefixOptions.find(option=>option.value===values.name_prefix) ?? null} onChange={option=>setValues(value=>({...value,name_prefix:option?.value ?? ""}))}
              required isDisabled={busy} isSearchable={false} placeholder="เลือกคำนำหน้าชื่อ" /></div>
          {([['first_name','ชื่อ'],['last_name','นามสกุล'],['username','ชื่อผู้ใช้งาน'],['password','รหัสผ่าน']] as const).map(([key,label])=>
            <label key={key} className="text-sm">{label}<input className={inputClass} name={key} required value={values[key]}
              type={key==="password" ? "password" : "text"} autoComplete={key==="password" ? "new-password" : key==="username" ? "off" : undefined}
              maxLength={key==="password" ? 128 : key==="username" ? 40 : 80} minLength={key==="password" ? 6 : key==="username" ? 3 : 1}
              pattern={key==="username" ? "[A-Za-z][A-Za-z0-9_.\\-]{2,39}" : undefined}
              aria-describedby={key==="username" ? "manager-username-help" : key==="password" ? "manager-password-help" : undefined}
              onChange={event=>setValues(value=>({...value,[key]:event.target.value}))} />
              {key==="username" && <span id="manager-username-help" className="mt-1 block text-xs leading-5 text-secondary">3–40 ตัว เริ่มด้วยอักษรอังกฤษ ใช้ตัวเลข จุด ขีดกลาง และขีดล่างได้ ไม่แยกตัวพิมพ์เล็ก/ใหญ่</span>}
              {key==="password" && <span id="manager-password-help" className="mt-1 block text-xs text-secondary">อย่างน้อย 6 ตัวอักษร</span>}
            </label>)}
        </fieldset>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className={`${buttonClass} mt-4 inline-flex items-center gap-2 bg-brand text-white hover:bg-brand/90`}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : <UserPlus size={17} />}{busy ? "กำลังสร้างบัญชี..." : "บันทึกผู้บริหาร"}</button>
      </form>
      {notice && <p role="status" className="mt-3 text-sm text-brand">{notice}</p>}
    </section>
    <section className="overflow-hidden rounded-xl border border-line bg-white" aria-label="รายชื่อผู้บริหารทั้งหมด">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
        <div><h2 className="text-lg font-semibold">รายชื่อผู้บริหารทั้งหมด</h2><p className="mt-1 text-sm text-secondary">{loading ? "กำลังโหลด..." : `ทั้งหมด ${data.total.toLocaleString("th-TH")} คน`}</p></div>
        <label className="flex w-full items-center gap-2 rounded border border-line px-3 sm:w-80"><Search size={17} className="shrink-0 text-secondary" />
          <input aria-label="ค้นหาผู้บริหาร" placeholder="ค้นหาชื่อหรือชื่อผู้ใช้งาน" value={search} maxLength={150} className="min-w-0 flex-1 py-2.5 text-sm outline-none"
            onChange={event=>{setSearch(event.target.value);setPage(1);}} /></label>
      </div>
      {loadError ? <div role="alert" className="p-5 text-sm text-red-700">{loadError}<button type="button" className={`${buttonClass} ml-3`} onClick={()=>setRefresh(value=>value+1)}>ลองโหลดใหม่</button></div> :
        <div className="overflow-x-auto" aria-busy={loading}><table className="w-full text-left text-sm">
          <thead className="bg-[#f8f6fc] text-secondary"><tr>{["ชื่อ-นามสกุล","ชื่อผู้ใช้งาน","ดำเนินการ"].map(label=><th key={label} className="whitespace-nowrap px-5 py-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>{loading ? <tr><td colSpan={3} className="p-8 text-center">กำลังโหลดรายชื่อ...</td></tr> : data.items.length ? data.items.map(row=>
            <AdminAccountRow key={row.id} row={row} role="manager" demo={demo} currentUserId={currentUserId}
              onSaved={()=>setRefresh(value=>value+1)} onDeleted={id=>{if(demo)setDemoRows(rows=>rows.filter(row=>row.id!==id));else setRefresh(value=>value+1);}} />)
            : <tr><td colSpan={3} className="p-8 text-center text-secondary">{search ? "ไม่พบผู้บริหารตามคำค้นหา" : "ยังไม่มีข้อมูลผู้บริหาร"}</td></tr>}</tbody>
        </table></div>}
      <div className="flex items-center justify-between gap-3 border-t border-line p-4 text-sm"><span>หน้า {page} / {pages}</span><div className="flex gap-2">
        <button className={buttonClass} disabled={loading || page<=1} onClick={()=>setPage(value=>value-1)}>ก่อนหน้า</button>
        <button className={buttonClass} disabled={loading || page>=pages} onClick={()=>setPage(value=>value+1)}>ถัดไป</button></div></div>
    </section>
  </div>;
}
