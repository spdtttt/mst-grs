import Workspace from "@/components/workspace";
import { demoProfiles, demoRecords, demoSchedule, demoHistory } from "@/lib/demo";
export default function Demo() {
  return (
    <Workspace
      profile={demoProfiles.student}
      records={demoRecords}
      historyRecords={demoHistory}
      schedule={demoSchedule}
      demo
    />
  );
}
