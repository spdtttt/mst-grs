export const assignmentFileTypes: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  txt: "text/plain",
};

export function assignmentFileMimeType(name: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(assignmentFileTypes, extension)
    ? assignmentFileTypes[extension]
    : undefined;
}

export function validateAssignmentFiles(
  files: readonly { name: string; size: number }[],
): string {
  if (files.some((file) => !assignmentFileMimeType(file.name)))
    return "รองรับเฉพาะ PDF, Word, Excel, PowerPoint, JPG, PNG และ TXT";
  return "";
}
