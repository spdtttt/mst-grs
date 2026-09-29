const day = 24 * 60 * 60 * 1000;
const bangkokOffset = 7 * 60 * 60 * 1000;

export function bangkokDate(value: string | number | null) {
  if (value === null) return "";
  const time = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(time) ? new Date(time + bangkokOffset).toISOString().slice(0, 10) : "";
}

// closes_at is the exclusive boundary: midnight immediately after the last day.
export function scheduleClosingDate(value: string | null) {
  return value ? bangkokDate(Date.parse(value) - 1) : "";
}

export function scheduleDates(opensOn: string, closesOn: string) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    bangkokDate(`${value}T00:00:00+07:00`) === value;
  if (!valid(opensOn) || !valid(closesOn) || closesOn < opensOn) return null;
  return {
    opens_at: new Date(`${opensOn}T00:00:00+07:00`).toISOString(),
    closes_at: new Date(Date.parse(`${closesOn}T00:00:00+07:00`) + day).toISOString(),
  };
}

export function normalizeSchedule<T extends { opens_at: string | null; closes_at: string | null }>(schedule: T): T {
  const range = scheduleDates(bangkokDate(schedule.opens_at), scheduleClosingDate(schedule.closes_at));
  return range ? { ...schedule, ...range } : schedule;
}

export function scheduleClosingDisplay(value: string | null) {
  const date = scheduleClosingDate(value);
  return date ? `${date}T00:00:00+07:00` : null;
}
