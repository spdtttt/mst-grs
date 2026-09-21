"use client";
import { useActionState, useState } from "react";
import Image from "next/image";
import {
  Eye,
  EyeOff,
  Fingerprint,
  IdCard,
  KeyRound,
  UserRound,
} from "lucide-react";
import { signIn } from "@/app/actions";
import { roles, type Role } from "@/lib/domain";

type RoleFieldConfig = {
  identifierLabel: string;
  identifierPlaceholder: string;
  identifierMaxLength: number;
  identifierInputMode: "numeric" | "text";
  showPassword: boolean;
  passwordLabel?: string;
  passwordPlaceholder?: string;
};

const roleFieldConfig: Record<Role, RoleFieldConfig> = {
  student: {
    identifierLabel: "รหัสประจำตัวนักเรียน",
    identifierPlaceholder: "กรอกเลขประจำตัวนักเรียน",
    identifierMaxLength: 20,
    identifierInputMode: "numeric",
    showPassword: true,
    passwordLabel: "เลขประจำตัวประชาชน",
    passwordPlaceholder: "กรอกเลขบัตรประชาชน 13 หลัก",
  },
  teacher: {
    identifierLabel: "เลขประจำตัวประชาชน",
    identifierPlaceholder: "กรอกเลขบัตรประชาชน 13 หลัก",
    identifierMaxLength: 13,
    identifierInputMode: "numeric",
    showPassword: false,
  },
  academic: {
    identifierLabel: "เลขประจำตัวประชาชน",
    identifierPlaceholder: "กรอกเลขบัตรประชาชน 13 หลัก",
    identifierMaxLength: 13,
    identifierInputMode: "numeric",
    showPassword: false,
  },
  manager: {
    identifierLabel: "ชื่อผู้ใช้งาน",
    identifierPlaceholder: "กรอกชื่อผู้ใช้งานสำหรับผู้บริหาร",
    identifierMaxLength: 40,
    identifierInputMode: "text",
    showPassword: true,
    passwordLabel: "รหัสผ่าน",
    passwordPlaceholder: "กรอกรหัสผ่านสำหรับผู้บริหาร",
  },
};

export default function Login({ next = "/dashboard" }: { next?: string }) {
  const [role, setRole] = useState<Role>("student");
  const [visible, setVisible] = useState(false);
  const [state, action, pending] = useActionState(signIn, { error: "" });
  const cfg = roleFieldConfig[role];
  const citizenIdentifier = role === "teacher" || role === "academic";
  const IdentifierIcon =
    role === "student" ? IdCard : role === "manager" ? UserRound : Fingerprint;
  const CredentialIcon = role === "student" ? Fingerprint : KeyRound;
  const VisibilityIcon = visible ? Eye : EyeOff;

  return (
    <main className="min-h-screen w-full bg-gradient-to-b from-white to-[#F1E7FC] pb-16 font-sans">
      <nav className="flex w-full justify-center border-b border-[#E4D6F7] bg-white shadow-sm md:justify-start">
        <div className="mx-auto w-full max-w-[1600px] p-4 md:px-10 md:py-7.5">
          <div className="flex flex-col items-center gap-3 md:flex-row md:items-stretch md:gap-7">
            <a
              href="http://www.mst.ac.th/"
              target="_blank"
              rel="noopener noreferrer"
              className="focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 shrink-0"
            >
              <Image
                src="https://upload.wikimedia.org/wikipedia/commons/4/44/MuangST2020.jpg"
                alt="โรงเรียนเมืองสุราษฎร์ธานี"
                width={90}
                height={90}
                className="size-[70px] ring-2 ring-white shadow-sm md:size-[90px]"
              />
            </a>
            <div className="flex flex-col items-center justify-between gap-2 text-center text-xl font-bold tracking-wide text-[#2F3038] sm:text-2xl md:items-start md:gap-0 md:text-left md:text-3xl">
              <p>ระบบแก้ไขผลการเรียนคงค้าง โรงเรียนเมืองสุราษฎร์ธานี</p>
              <p className="w-fit bg-[#2F3038] px-3 py-1.5 text-lg text-white sm:text-xl md:px-4 md:py-2 md:text-3xl">
                MST Grade Recovery System
              </p>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-xl p-6 sm:p-7">
          <div className="mb-5 flex flex-col items-center gap-2   ">
            <div className="flex size-14 items-center justify-center rounded-full bg-[#2F3038]">
              <UserRound className="size-7 text-white" aria-hidden="true" />
            </div>
            <h1 className="font-thai text-xl font-bold text-[#2F3038]">
              เข้าสู่ระบบ
            </h1>
          </div>

          <form action={action} className="flex w-full flex-col font-thai">
            <input type="hidden" name="next" value={next} />
            {state.error && (
              <div
                className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700"
                role="alert"
              >
                {state.error}
              </div>
            )}
            <fieldset className="mb-6 flex flex-col gap-0 text-[#46464E]">
              <p className="mb-1.5">โปรดเลือกสถานะผู้ใช้งาน</p>
              <div className="flex flex-col gap-2 ml-2">
                {(Object.keys(roles) as Role[]).map((value) => {
                  const selected = role === value;
                  return (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl`}
                    >
                      <input
                        name="role"
                        type="radio"
                        value={value}
                        checked={selected}
                        onChange={() => {
                          setRole(value);
                          setVisible(false);
                        }}
                        className="relative size-6 shrink-0 cursor-pointer appearance-none rounded-full border border-[#62666a] bg-white after:absolute after:top-1/2 after:left-1/2 after:size-3 after:-translate-x-1/2 after:-translate-y-1/2 after:scale-0 after:rounded-full after:bg-[#62666a] after:content-[''] after:transition-transform after:duration-300 checked:after:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62666a]"
                      />
                      <span>
                        {value === "teacher" ? "คุณครู" : roles[value]}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="flex flex-col gap-2">
              <div>
                <label
                  htmlFor="identifier"
                  className="mt-0 mb-2 block text-base font-medium text-[#2F3038]"
                >
                  {cfg.identifierLabel}
                </label>
                <div className="relative" key={role}>
                  <IdentifierIcon
                    className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-[#46464E]"
                    aria-hidden="true"
                  />
                  <input
                    id="identifier"
                    name="identifier"
                    required
                    autoComplete="username"
                    inputMode={cfg.identifierInputMode}
                    maxLength={cfg.identifierMaxLength}
                    placeholder={cfg.identifierPlaceholder}
                    className="max-w-full border px-[13px] outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115] w-full border-[#46464E] py-2.5 pr-10 pl-10 text-[#2F3038]"
                    type={citizenIdentifier && !visible ? "password" : "text"}
                  />
                  {citizenIdentifier && (
                    <button
                      type="button"
                      aria-label={
                        visible ? "ซ่อนเลขบัตรประชาชน" : "แสดงเลขบัตรประชาชน"
                      }
                      aria-pressed={visible}
                      onClick={() => setVisible(!visible)}
                      className="cursor-pointer enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 absolute top-1/2 right-3 -translate-y-1/2 text-[#46464E] transition-opacity duration-200 hover:opacity-70"
                    >
                      <VisibilityIcon className="size-5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              {cfg.showPassword && (
                <div>
                  <label
                    htmlFor="password"
                    className="mt-4 mb-2 block text-base font-medium text-[#2F3038]"
                  >
                    {cfg.passwordLabel}
                  </label>
                  <div className="relative">
                    <CredentialIcon
                      className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-[#46464E]"
                      aria-hidden="true"
                    />
                    <input
                      id="password"
                      name="password"
                      required
                      type={visible ? "text" : "password"}
                      autoComplete="current-password"
                      maxLength={role === "student" ? 13 : 128}
                      inputMode={role === "student" ? "numeric" : "text"}
                      placeholder={cfg.passwordPlaceholder}
                      className="max-w-full border px-[13px] outline-none focus:border-brand focus:shadow-[0_0_0_3px_#713cd115] w-full border-[#46464E] py-2.5 pr-10 pl-10 text-[#2F3038]"
                    />
                    <button
                      type="button"
                      aria-label={visible ? "ซ่อนข้อมูล" : "แสดงข้อมูล"}
                      aria-pressed={visible}
                      onClick={() => setVisible(!visible)}
                      className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 absolute top-1/2 right-3 -translate-y-1/2 text-[#46464E] transition-opacity duration-200 hover:opacity-70"
                    >
                      <VisibilityIcon className="size-5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={pending}
              className="cursor-pointer enabled:active:translate-y-px disabled:cursor-not-allowed focus-visible:outline-3 focus-visible:outline-[#ad84f1] focus-visible:outline-offset-3 mt-6 w-full bg-[#6D5E00] py-3 text-center font-medium text-white transition-colors duration-300 enabled:hover:bg-[#7D6E00] disabled:opacity-50"
            >
              {pending ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
