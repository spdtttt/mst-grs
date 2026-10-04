"use client";
import { useRef, useState } from "react";
import Select from "react-select";
import { Loader2 } from "lucide-react";
import { deleteAccount, editAccount, resetManagerPassword } from "@/app/account-actions";
import { accountEditSchema, accountFullName, accountNameParts, type AccountRole, type AccountRow } from "@/lib/admin-accounts";
import { passwordSchema } from "@/lib/auth-input";

const inputClass = "w-full min-w-20 rounded border border-line bg-white px-2 py-2 text-sm text-ink focus:border-brand";
const buttonClass = "cursor-pointer whitespace-nowrap rounded border border-line px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50";

export default function AdminAccountRow({ row, role, demo=false, disabled=false, currentUserId, onSaved, onDeleted }: {
  row: AccountRow; role: AccountRole; demo?: boolean; disabled?: boolean; currentUserId?: string;
  onSaved: (row: AccountRow) => void; onDeleted: (id: string) => void;
}) {
  const [mode,setMode]=useState<"view"|"edit"|"delete"|"password">("view");
  const [draft,setDraft]=useState(() => ({...accountNameParts(row),classroom:row.classroom ?? "",roll_number:String(row.roll_number ?? ""),learning_subject_group:row.learning_subject_group ?? ""}));
  const [password,setPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const unavailable=disabled || busy || row.id===currentUserId;
  const student=role==="student";
  const prefixOptions=(student ? ["เด็กชาย","เด็กหญิง","นาย","นางสาว"] : ["นาย","นาง","นางสาว"])
    .concat(draft.name_prefix && !(student ? ["เด็กชาย","เด็กหญิง","นาย","นางสาว"] : ["นาย","นาง","นางสาว"]).includes(draft.name_prefix) ? [draft.name_prefix] : [])
    .map(value=>({value,label:value}));
  function begin(next: typeof mode) {
    setDraft({...accountNameParts(row),classroom:row.classroom ?? "",roll_number:String(row.roll_number ?? ""),learning_subject_group:row.learning_subject_group ?? ""});
    setPassword("");setConfirmPassword("");setError("");setNotice("");setMode(next);
  }
  async function perform() {
    if(lock.current || unavailable) return;
    setError("");setNotice("");
    if(!demo && row.account_revision===undefined) {setError("กรุณาโหลดรายชื่อใหม่ก่อนดำเนินการ");return;}
    const target={id:row.id,role,expected_revision:row.account_revision ?? 0};
    const changes={name_prefix:draft.name_prefix,first_name:draft.first_name,last_name:draft.last_name,
      ...(role === "teacher" && (row.learning_subject_group || draft.learning_subject_group.trim()) ? {learning_subject_group:draft.learning_subject_group.trim()} : {}),
      ...(student ? {classroom:draft.classroom,roll_number:Number(draft.roll_number)} : {})};
    if(mode==="edit") {
      const checked=accountEditSchema.safeParse({...target,id:demo ? "00000000-0000-4000-8000-000000000001" : row.id,...changes});
      if(!checked.success) {setError(checked.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");return;}
    }
    if(mode==="password") {
      const checked=passwordSchema.safeParse(password);
      if(!checked.success) {setError(checked.error.issues[0]?.message ?? "รหัสผ่านไม่ถูกต้อง");return;}
      if(password!==confirmPassword) {setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");return;}
    }
    lock.current=true;setBusy(true);
    try {
      if(mode==="edit") {
        const normalized={...changes,name_prefix:changes.name_prefix.trim(),first_name:changes.first_name.trim(),last_name:changes.last_name.trim()};
        const result=demo ? {data:{...row,...normalized,full_name:accountFullName(normalized),account_revision:(row.account_revision ?? 0)+1}}
          : await editAccount({...target,...changes});
        if(result.error || !result.data) {setError(result.error ?? "บันทึกไม่สำเร็จ");return;}
        onSaved(result.data);setNotice("บันทึกข้อมูลแล้ว");
      } else if(mode==="delete") {
          const result=demo ? {success:true,account_revision:(row.account_revision ?? 0)+(row.has_auth === false ? 0 : 1)} : await deleteAccount(target);
        if(result.error || !result.success) {setError(result.error ?? "ลบไม่สำเร็จ");return;}
        if (role === "teacher") {
            onSaved({...row,has_auth:false,account_revision:result.account_revision ?? row.account_revision});
          setNotice("รีเซ็ตบัญชีแล้ว เก็บทะเบียนไว้ คุณครูสามารถสมัครใหม่ได้");
        } else onDeleted(row.id);
      } else if(mode==="password") {
        const result=demo ? {success:true} : await resetManagerPassword({...target,password});
        if(result.error || !result.success) {setError(result.error ?? "ตั้งรหัสผ่านไม่สำเร็จ");return;}
        setNotice(demo ? "ตั้งรหัสผ่านแล้ว · ข้อมูลทดลอง" : "ตั้งรหัสผ่านใหม่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่");
      }
      setPassword("");setConfirmPassword("");setMode("view");
    } catch {setError("ไม่สามารถยืนยันผลได้ กรุณาโหลดรายชื่อใหม่ก่อนลองอีกครั้ง");}
    finally {lock.current=false;setBusy(false);}
  }
  return (
    <tr className="border-t border-line align-middle hover:bg-brand-soft/20" aria-busy={busy}>
      {student && <td className="px-5 py-4 font-medium text-brand">{row.student_code}</td>}
      <td className="min-w-60 px-5 py-4">
        {mode==="edit" ? <div className="grid min-w-56 gap-2">
          <label className="text-xs text-secondary" htmlFor={`prefix-${row.id}`}>คำนำหน้าชื่อ</label>
          <Select inputId={`prefix-${row.id}`} instanceId={`prefix-${row.id}`} options={prefixOptions}
            value={prefixOptions.find(option=>option.value===draft.name_prefix) ?? null}
            onChange={option=>setDraft(value=>({...value,name_prefix:option?.value ?? ""}))}
            isSearchable={false} isDisabled={busy} placeholder="เลือกคำนำหน้าชื่อ"
            menuPortalTarget={typeof document!=="undefined" ? document.body : undefined}
            menuPosition="fixed" styles={{menuPortal:base=>({...base,zIndex:60})}} />
          <label className="text-xs text-secondary">ชื่อ<input className={inputClass} disabled={busy} value={draft.first_name} maxLength={80}
            onChange={event=>setDraft(value=>({...value,first_name:event.target.value}))} /></label>
          <label className="text-xs text-secondary">นามสกุล<input className={inputClass} disabled={busy} value={draft.last_name} maxLength={80}
            onChange={event=>setDraft(value=>({...value,last_name:event.target.value}))} /></label>
        </div> : <span className="font-medium">{row.full_name}</span>}
      </td>
      {role==="manager" && <td className="px-5 py-4">{row.username ?? "—"}</td>}
      {role === "teacher" && <>
        <td className="min-w-48 px-5 py-4">{mode === "edit" ? <input aria-label="กลุ่มสาระการเรียนรู้" className={inputClass} maxLength={200} disabled={busy} value={draft.learning_subject_group}
          onChange={event=>setDraft(value=>({...value,learning_subject_group:event.target.value}))} /> : row.learning_subject_group || "ยังไม่ระบุกลุ่มสาระการเรียนรู้"}</td>
        <td className="whitespace-nowrap px-5 py-4">{row.has_auth === false ? "ยังไม่สมัคร" : "มีบัญชีแล้ว"}</td>
      </>}
      {student && <>
        <td className="px-5 py-4">{mode==="edit" ? <input aria-label="ชั้น/ห้อง" className={inputClass} disabled={busy} value={draft.classroom} maxLength={40}
          onChange={event=>setDraft(value=>({...value,classroom:event.target.value}))} /> : row.classroom || "—"}</td>
        <td className="px-5 py-4">{mode==="edit" ? <input aria-label="เลขที่" className={inputClass} disabled={busy} value={draft.roll_number} inputMode="numeric" maxLength={3}
          onChange={event=>setDraft(value=>({...value,roll_number:event.target.value}))} /> : row.roll_number ?? "—"}</td>
      </>}
      <td className="min-w-56 px-5 py-4">
        {mode==="view" ? <div className="flex flex-wrap gap-2">
          <button type="button" className={`${buttonClass} text-brand duration-150 hover:bg-brand-soft`} disabled={unavailable}
            onClick={()=>begin(role==="manager" ? "password" : "edit")}>
            {role==="manager" ? "ตั้งรหัสผ่านใหม่" : "แก้ไข"}
          </button>
          <button type="button" className={`${buttonClass} text-red-700 duration-150 hover:bg-red-50`} disabled={unavailable} onClick={()=>begin("delete")}>ลบและรีเซ็ทรหัสผ่าน</button>
        </div> : <div className="space-y-3">
          {mode==="delete" && <p className="max-w-sm text-sm leading-6 text-red-700">{role === "teacher" ? `ยืนยันลบบัญชีเข้าสู่ระบบของ ${row.full_name}? เก็บทะเบียน ข้อมูลเดิม และทุกบทบาทไว้ คุณครูต้องสมัครใหม่เพื่อตั้งรหัสผ่าน` : `ยืนยันลบบัญชี ${row.full_name} รวมบัญชีเข้าสู่ระบบและสิทธิ์ทุกบทบาท? บัญชีที่มีข้อมูลอ้างอิงอยู่จะลบไม่ได้`}</p>}
          {mode==="password" && <div className="grid gap-2">
            <label className="text-xs">รหัสผ่านใหม่<input className={inputClass} type="password" autoComplete="new-password" minLength={6} maxLength={128}
              disabled={busy} value={password} onChange={event=>setPassword(event.target.value)} /></label>
            <label className="text-xs">ยืนยันรหัสผ่านใหม่<input className={inputClass} type="password" autoComplete="new-password" maxLength={128}
              disabled={busy} value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} /></label>
          </div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${buttonClass} inline-flex items-center gap-2 ${mode==="delete" ? "bg-red-700" : "bg-brand"} text-white`}
              disabled={unavailable} onClick={perform}>{busy && <Loader2 size={15} className="animate-spin" />}{mode==="delete" ? "ยืนยันลบ" : "บันทึก"}</button>
            <button type="button" className={buttonClass} disabled={busy} onClick={()=>begin("view")}>ยกเลิก</button>
          </div>
        </div>}
        {error && <p role="alert" className="mt-2 max-w-sm text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="mt-2 text-sm text-brand">{notice}</p>}
      </td>
    </tr>
  );
}
