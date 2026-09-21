import Workspace from "@/components/workspace";
import { demoProfiles, demoRecords, demoSchedule } from "@/lib/demo";
export default function Demo() {
  return (
    <Workspace
      profile={demoProfiles.student}
      records={demoRecords}
      schedule={demoSchedule}
      demo
    />
  );
}
