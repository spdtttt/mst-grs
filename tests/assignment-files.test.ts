import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignmentFileMimeType,
  validateAssignmentFiles,
} from "../src/lib/assignment-files";

const megabyte = 1024 * 1024;

test("allows assignments without files and uploads at the 4 MB boundary", () => {
  assert.equal(validateAssignmentFiles([]), "");
  assert.equal(validateAssignmentFiles([{ name: "งาน.pdf", size: 4 * megabyte }]), "");
  assert.equal(validateAssignmentFiles([
    { name: "ภาพ.JPG", size: 2 * megabyte },
    { name: "งาน.docx", size: 2 * megabyte },
  ]), "");
});

test("rejects large phone photos and aggregate uploads before submission", () => {
  assert.match(validateAssignmentFiles([{ name: "IMG_001.JPG", size: 6 * megabyte }]), /4 MB/);
  assert.match(validateAssignmentFiles([
    { name: "page1.png", size: 2 * megabyte },
    { name: "page2.png", size: 2 * megabyte + 1 },
  ]), /4 MB/);
});

test("allows five files and rejects six", () => {
  const files = Array.from({ length: 5 }, (_, i) => ({ name: `${i}.pdf`, size: 100 }));
  assert.equal(validateAssignmentFiles(files), "");
  assert.match(validateAssignmentFiles([...files, files[0]]), /5/);
});

test("accepts supported extensions even when mobile file MIME is absent", () => {
  assert.equal(assignmentFileMimeType("ใบงาน.PDF"), "application/pdf");
  assert.equal(assignmentFileMimeType("image.JPEG"), "image/jpeg");
  assert.equal(validateAssignmentFiles([{ name: "ใบงาน.PDF", size: 100 }]), "");
  for (const name of ["image.heic", "file", "file.exe", "file.constructor", "file.__proto__"]) {
    assert.ok(validateAssignmentFiles([{ name, size: 100 }]));
  }
});
