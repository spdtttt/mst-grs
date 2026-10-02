import type { Metadata } from "next";
import RegisterTeacher from "@/components/register-teacher";

export const metadata: Metadata = {
  title: "สมัครสมาชิกครู | MST GRS",
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return <RegisterTeacher />;
}
