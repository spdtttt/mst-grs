# Admin account actions

Deploy migrations `046_account_role_deletion.sql`, `047_staff_auth_reset.sql`,
and `048_academic_auth_recovery.sql`, in order, after migration 045 and before
deploying the application. Old SQL reset endpoints are intentionally revoked:
they cannot preserve Storage ownership using the new server-side protocol.

| Action | Profiles and roles | Auth | Unfinished grades |
| --- | --- | --- | --- |
| Delete | Remove selected role; delete profile only when no roles remain | Retained | Blocks deletion |
| Reset staff password | Retained, including all additional roles | Deleted after preserving files | Allowed |
| Set manager password | Retained | Password updated, old sessions revoked | Unchanged |

`teacher_approved` is still unfinished; only `completed` allows deletion.
Historical IDs and names live in `profile_identities`, which contains no login
credentials or citizen IDs. Grade snapshots and attachments remain readable by
Academic users after a profile is deleted. New assignments require live roles.

## Recovery and file preservation

Staff reset requires the server's existing service-role credential and identity
encryption key. Legacy encrypted identities are prepared before deleting Auth.
The existing Academic form creates Auth with the retained profile UUID and
citizen hash; it does not create another profile. Teacher registration continues
to use the existing registration form.

`staff_auth_resets` reserves the profile across external API calls. While a reset
is active, live sessions and conflicting profile/registration changes are denied.
Files are copied server-side through the Storage copy API, using the same path,
service ownership, `copyMetadata: true`, and `x-upsert: true`. No file bytes pass
through the application. Each request handles at most 20 objects, four at a time.
The migrations treat `storage.objects` as Supabase-managed and do not create,
alter, or remove its columns or indexes.
The original uploader and all grade/file links remain unchanged.

The `deleting` transition permits only one Auth delete request. Definitive Auth
4xx rejections (except timeouts) allow a retry. Unknown/timeout outcomes retain
the reservation; retries inspect Auth and complete only after confirming absence.
If Auth still exists after an ambiguous failure, inspect Auth request logs before
using the service-only `retry_staff_auth_reset(profile_id, token)` recovery RPC.
Never release that reservation while an earlier Auth delete request may still run.
No timeout automatically takes over a reservation.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build`. Tests include the latest
database migrations and a separate historical suite pinned through migration 045.
On an isolated Supabase test project, verify Storage copy-to-self clears both
ownership fields, preserves bytes/metadata and downloadable attachment paths,
then exercise Auth deletion and recreation with the same UUID. PGlite does not
simulate the Storage service or GoTrue; those checks must use a real test project.

Do not use production accounts to smoke-test destructive Auth operations.
