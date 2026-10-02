"use client";
import { useActionState, useEffect, useState } from "react";
import Image from "next/image";
import Select from "react-select";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  UserPlus,
} from "lucide-react";
import { registerTeacher } from "@/app/register/actions";

const prefixOptions = ["นาย", "นาง", "นางสาว"].map((prefix) => ({
  value: prefix,
  label: prefix,
}));

const emptyValues = {
  citizen_id: "",
  name_prefix: "",
  first_name: "",
  last_name: "",
  password: "",
};
const inputClass =
  "mt-2 w-full border border-gray-400 bg-white px-3 py-3 text-ink outline-none focus:border-brand focus:ring-brand/15";

export default function RegisterTeacher() {
  const [state, action, pending] = useActionState(registerTeacher, {
    error: "",
  });
  const [values, setValues] = useState(emptyValues);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (state.success) setValues(emptyValues);
  }, [state.success]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-[#F1E7FC] px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-xl">
        <a
          href="/"
          className="mb-7 inline-flex items-center gap-2 text-sm text-secondary hover:text-brand"
        >
          <ArrowLeft size={17} /> กลับหน้าเข้าสู่ระบบ
        </a>
        <header className="mb-7 flex items-center gap-4">
          <Image
            src="/icon.svg"
            alt="โรงเรียนเมืองสุราษฎร์ธานี"
            width={64}
            height={64}
          />
          <div>
            <p className="text-lg font-semibold text-brand">MST GRS</p>
            <p className="text-sm text-secondary">โรงเรียนเมืองสุราษฎร์ธานี</p>
          </div>
        </header>
        <section className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
          {state.success ? (
            <div className="py-5 text-center" role="status">
              <CheckCircle2 size={44} className="mx-auto mb-4 text-green-600" />
              <h1 className="text-xl font-semibold">สร้างบัญชีสำเร็จ</h1>
              <p className="mt-3 text-sm leading-7 text-secondary">
                เข้าสู่ระบบในบทบาทคุณครู ด้วยเลขบัตรประชาชนและรหัสผ่านที่ตั้งไว้
              </p>
              <a
                href="/?role=teacher"
                className="mt-6 inline-flex w-full justify-center rounded-xl bg-brand px-5 py-3 font-medium text-white"
              >
                เข้าสู่ระบบ
              </a>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <UserPlus size={28} className="mb-3 text-brand" />
                <h1 className="text-2xl font-semibold">สร้างบัญชีคุณครู</h1>
                <p className="mt-2 text-sm leading-6 text-secondary">
                  กรอกข้อมูลเพื่อสร้างบัญชีสำหรับคุณครู
                </p>
              </div>
              {state.error && (
                <p
                  role="alert"
                  className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {state.error}
                </p>
              )}
              <form action={action}>
                <fieldset
                  disabled={pending}
                  className="space-y-4 disabled:opacity-70"
                >
                  <label
                    className="block text-sm font-medium"
                    htmlFor="register-citizen"
                  >
                    เลขบัตรประชาชน
                    <input
                      id="register-citizen"
                      name="citizen_id"
                      required
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={17}
                      pattern="[0-9]{13}|[0-9]-[0-9]{4}-[0-9]{5}-[0-9]{2}-[0-9]"
                      placeholder="เลขบัตรประชาชน 13 หลัก"
                      className={inputClass}
                      value={values.citizen_id}
                      onChange={(e) =>
                        setValues({ ...values, citizen_id: e.target.value })
                      }
                    />
                  </label>
                  <div>
                    <label
                      className="block text-sm font-medium"
                      htmlFor="register-prefix"
                    >
                      คำนำหน้าชื่อ
                    </label>
                    <Select
                      inputId="register-prefix"
                      instanceId="register-prefix"
                      name="name_prefix"
                      required
                      isSearchable={false}
                      isDisabled={pending}
                      placeholder="เลือกคำนำหน้า"
                      className="mt-2 text-sm"
                      options={prefixOptions}
                      value={
                        prefixOptions.find(
                          (option) => option.value === values.name_prefix,
                        ) ?? null
                      }
                      onChange={(option) =>
                        setValues((current) => ({
                          ...current,
                          name_prefix: option?.value ?? "",
                        }))
                      }
                      styles={{
                        control: (base, state) => ({
                          ...base,
                          minHeight: 46,
                          borderRadius: 0,
                          borderColor: state.isFocused
                            ? "var(--color-brand)"
                            : "var(--color-gray-400)",
                          "&:hover": { borderColor: "var(--color-brand)" },
                        }),
                      }}
                      theme={(theme) => ({
                        ...theme,
                        colors: {
                          ...theme.colors,
                          primary: "var(--color-brand)",
                          primary25: "var(--color-brand-soft)",
                          primary50: "var(--color-brand-soft)",
                          neutral80: "var(--color-ink)",
                        },
                      })}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label
                      className="block text-sm font-medium"
                      htmlFor="register-first"
                    >
                      ชื่อ
                      <input
                        id="register-first"
                        name="first_name"
                        required
                        maxLength={80}
                        autoComplete="given-name"
                        className={inputClass}
                        value={values.first_name}
                        onChange={(e) =>
                          setValues({ ...values, first_name: e.target.value })
                        }
                      />
                    </label>
                    <label
                      className="block text-sm font-medium"
                      htmlFor="register-last"
                    >
                      นามสกุล
                      <input
                        id="register-last"
                        name="last_name"
                        required
                        maxLength={80}
                        autoComplete="family-name"
                        className={inputClass}
                        value={values.last_name}
                        onChange={(e) =>
                          setValues({ ...values, last_name: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div>
                    <label
                      className="block text-sm font-medium"
                      htmlFor="register-password"
                    >
                      รหัสผ่าน
                    </label>
                    <div className="relative">
                      <input
                        id="register-password"
                        name="password"
                        type={visible ? "text" : "password"}
                        required
                        minLength={6}
                        maxLength={128}
                        autoComplete="new-password"
                        aria-describedby="password-help"
                        className={`${inputClass} pr-12`}
                        value={values.password}
                        onChange={(e) =>
                          setValues({ ...values, password: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        aria-label={visible ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                        aria-pressed={visible}
                        onClick={() => setVisible(!visible)}
                        className="absolute right-3 cursor-pointer top-1/2 -translate-y-1/3 rounded p-1 text-secondary focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        {visible ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                    <p
                      id="password-help"
                      className="mt-2 text-xs text-secondary"
                    >
                      อย่างน้อย 6 ตัวอักษร
                    </p>
                  </div>
                  <button
                    type="submit"
                    className="mt-2 cursor-pointer duration-150 transition-colors inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 font-medium text-white hover:bg-brand/90 disabled:cursor-wait"
                    disabled={pending}
                  >
                    {pending && <Loader2 size={18} className="animate-spin" />}
                    {pending ? "กำลังสร้างบัญชี..." : "บันทึกและสร้างบัญชี"}
                  </button>
                </fieldset>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
