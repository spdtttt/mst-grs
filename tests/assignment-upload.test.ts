import { test } from "node:test";
import assert from "node:assert/strict";
import { assignmentUploadEndpoint, assignmentUploadError } from "../src/lib/assignment-upload";

test("signed uploads use the signed TUS route on the direct storage host", () => {
  assert.equal(assignmentUploadEndpoint("https://project.supabase.co"),
    "https://project.storage.supabase.co/storage/v1/upload/resumable/sign");
  assert.equal(assignmentUploadEndpoint("https://project.storage.supabase.co"),
    "https://project.storage.supabase.co/storage/v1/upload/resumable/sign");
  assert.equal(assignmentUploadEndpoint("http://127.0.0.1:54321"),
    "http://127.0.0.1:54321/storage/v1/upload/resumable/sign");
});

test("Storage errors are classified by their response body as well as HTTP status", () => {
  assert.match(assignmentUploadError(400, '{"code":"invalid_compact_jws","message":"Invalid Compact JWS"}'), /สิทธิ์อัปโหลด/);
  assert.match(assignmentUploadError(400, '{"code":"EntityTooLarge"}'), /ขนาดเกินเพดาน/);
  assert.match(assignmentUploadError(413, ""), /ขนาดเกินเพดาน/);
  assert.match(assignmentUploadError(400, '{"code":"InvalidMimeType"}'), /ชนิดไฟล์/);
  assert.match(assignmentUploadError(undefined, ""), /การเชื่อมต่อ/);
});

test("unknown errors include a safe diagnostic code without exposing response secrets", () => {
  assert.match(assignmentUploadError(400, '{"code":"InvalidRequest","message":"https://example.test?token=secret"}'), /HTTP 400: InvalidRequest/);
  assert.doesNotMatch(assignmentUploadError(400, 'https://example.test?token=secret'), /secret/);
  assert.doesNotMatch(assignmentUploadError(400, '{"error":"token=secret"}'), /secret/);
});
