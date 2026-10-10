import { safeCell } from "./domain";

export function saveCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csv =
    "﻿" +
    [headers, ...rows]
      .map((row) =>
        row.map((v) => '"' + safeCell(v).replaceAll('"', '""') + '"').join(","),
      )
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
