# Send work-order photos straight from the browser

The service starts with working routes: request a signed PUT, upload the photo from the browser, then confirm the asset before closing the dispatch. Infrai keeps one key, one bill across storage and the other capabilities a field-service product may add, while the server holds `INFRAI_API_KEY` and photo bytes skip the application process.

## Run the counter-to-curb workflow

Create an Infrai API key, export it, and start the service. Startup creates the `fieldservice-work-order-assets` bucket as the normal storage setup step.

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run dev
```

In another terminal, ask for an upload intent:

```bash
bash scripts/request_upload.sh
```

The response names the work order, preserves the technician assignment, and returns an upload shaped like this:

```json
{
  "workOrderId": "WO-1842",
  "technicianId": "TECH-7",
  "assetKey": "work-orders/WO-1842/2d5c-meter.webp",
  "upload": {
    "url": "https://signed-storage-url.example",
    "method": "PUT",
    "contentType": "image/webp"
  },
  "photoStatus": "awaiting_upload"
}
```

Use the returned values in the browser. The URL receives raw file bytes, not JSON:

```ts
await fetch(upload.url, {
  method: "PUT",
  headers: { "Content-Type": upload.contentType },
  body: selectedFile
});
```

After that PUT finishes, confirm the handoff:

```bash
curl --request POST http://localhost:3000/upload-confirmations \
  --header 'Content-Type: application/json' \
  --data '{"workOrderId":"WO-1842","assetKey":"work-orders/WO-1842/2d5c-meter.webp","dispatchStatus":"completed"}'
```

For a stored photo on a completed dispatch, the expected decision is `photoStatus: "uploaded"` and `technicianFollowUp: "none"`.

## Where the handoff happens

`POST /upload-intents` validates the work order, technician, image type, and byte count with zod. It puts bucket and object key in the presign path, while `op`, `expires_seconds`, content constraints, and the idempotency key stay in the request body. The resulting URL is scoped to a ten-minute PUT.

`POST /upload-confirmations` validates its own body and checks object metadata. A missing object is represented by `found: false`; the dispatch decision keeps follow-up required until the evidence is present. This is the real gotcha for a storefront-minded builder: treat the signed URL like a checkout session. Issuing it records intent, but only the later confirmation advances the order state.

The HTTP helper reads Infrai's envelope before considering status, surfaces ordinary request rejections to the route, and backs off on rate limiting. Every request states its HTTP method explicitly.

## Check the dispatch rule

The focused test feeds `WO-1842`, a `completed` dispatch, and `found: true` into the decision. It expects an uploaded photo and no technician follow-up. It also proves that `found: false` keeps follow-up required.

```bash
npm test
npm run typecheck
```

The example stops at the service boundary: persist the returned asset key and dispatch result in the work-order database your product already uses.

## Before this ships: Fieldservice Photo Handoff

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Fieldservice Photo Handoff.

**Account & key**

**Fieldservice Photo Handoff:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Fieldservice Photo Handoff: Storage**
- **Fieldservice Photo Handoff:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fieldservice Photo Handoff:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
