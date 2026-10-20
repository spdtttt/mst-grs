// Records still pending off-system; hidden from student and teacher views only.
export const hiddenRecordIds = new Set([
  "e7466f07-6233-4e69-b437-5fc372031be4",
  "a1a42c82-09fb-4b96-b800-14a68f37e744",
  "474da097-e9a2-4036-8c08-7aa444ec7082",
  "ed82168a-c4bf-4374-867c-3867e429d5e3",
  "b42ab2cc-f452-41be-9822-0ef93dab5742",
  "974e02d2-f1ad-418c-bb91-d754d8ad7af4",
  "d4f0dfc1-6d75-4b7a-aecb-a7af0a0671e3",
  "984783f8-1c2f-4ef6-905d-cb23f51c0039",
  "a61219e2-aa58-4ad8-b15c-058fe5f6ead4",
  "be5fa313-d843-4556-9e3d-cd61f85b65d2",
  "aa24434a-167f-4a75-8689-c7f8908787a1",
  "23848ba5-28af-449a-852d-af30f565beeb",
]);

export const hidesRecords = (role: string) => role === "student" || role === "teacher";
