import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignmentFileMimeType,
  validateAssignmentFiles,
  assignmentSubmissionForm,
  parseAssignmentDetails,
} from "../src/lib/assignment-files";

const megabyte = 1024 * 1024;

test("allows assignments without files and supported attachments", () => {
  assert.equal(validateAssignmentFiles([]), "");
  assert.equal(validateAssignmentFiles([{ name: "งาน.pdf", size: 4 * megabyte }]), "");
  assert.equal(validateAssignmentFiles([
    { name: "ภาพ.JPG", size: 2 * megabyte },
    { name: "งาน.docx", size: 2 * megabyte },
  ]), "");
});

test("allows the reported 6.6 MB phone image and large aggregate uploads", () => {
  assert.equal(validateAssignmentFiles([{ name: "IMG_001.PNG", size: Math.ceil(6.6 * megabyte) }]), "");
  assert.equal(validateAssignmentFiles([
    { name: "page1.png", size: 2 * megabyte },
    { name: "page2.png", size: 2 * megabyte + 1 },
  ]), "");
  assert.equal(validateAssignmentFiles([{ name: "large.pdf", size: 3 * 1024 * megabyte }]), "");
});

test("does not impose a file-count limit", () => {
  const files = Array.from({ length: 5 }, (_, i) => ({ name: `${i}.pdf`, size: 100 }));
  assert.equal(validateAssignmentFiles(files), "");
  assert.equal(validateAssignmentFiles([...files, files[0]]), "");
});

test("server action payload excludes file bytes", async () => {
  const form = new FormData();
  form.set("expected_status", "requested");
  form.set("assignment", "Complete the assigned worksheet");
  form.set("due_at", "2099-01-01T10:00");
  form.set("attachments", new File([new Uint8Array(7 * megabyte)], "phone.png", { type: "image/png" }));
  const submission = assignmentSubmissionForm(form);
  assert.equal(submission.has("attachments"), false);
  assert.equal(submission.get("assignment"), form.get("assignment"));
  assert.equal(parseAssignmentDetails(submission).error, undefined);
  assert.ok((await new Response(submission).arrayBuffer()).byteLength < 1024);
});

test("rejects empty files and invalid assignment details before upload", () => {
  assert.ok(validateAssignmentFiles([{ name: "empty.pdf", size: 0 }]));
  const form = new FormData();
  assert.ok(parseAssignmentDetails(form).error);
  form.set("expected_status", "requested");
  form.set("assignment", "Complete the assigned worksheet");
  form.set("due_at", "2000-01-01T10:00");
  assert.ok(parseAssignmentDetails(form).error);
});

test("accepts supported extensions even when mobile file MIME is absent", () => {
  assert.equal(assignmentFileMimeType("ใบงาน.PDF"), "application/pdf");
  assert.equal(assignmentFileMimeType("image.JPEG"), "image/jpeg");
  assert.equal(validateAssignmentFiles([{ name: "ใบงาน.PDF", size: 100 }]), "");
  for (const name of ["image.heic", "file", "file.exe", "file.constructor", "file.__proto__"]) {
    assert.ok(validateAssignmentFiles([{ name, size: 100 }]));
  }
});
