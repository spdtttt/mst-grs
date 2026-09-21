import { BeatLoader } from "react-spinners";

export default function Loading() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-5 p-[30px] text-center"
      role="status"
    >
      <BeatLoader color="#a163f1" size={20} margin={3} speedMultiplier={1.5} />
    </main>
  );
}
