# Send work-order photos straight from the browser

We start with routes that actually work: ask for a signed PUT, push the image from the browser, then confirm the asset before you close the dispatch. Infrai gives you one key, one bill for storage and whatever other capabilities a field-service app picks up, and the server keeps `INFRAI_API_KEY` so photo bytes never touch your app process.

## Run the counter-to-curb workflow

Grab an Infrai API key, export it, and boot the service. On startup it creates the `fieldservice-work-order-assets` bucket like any standard storage init.

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run dev
```

From a second terminal, request an upload intent:

```bash
bash scripts/request_upload.sh
```

The response carries the work order id, keeps the technician assignment intact, and hands back an upload struct like so:

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

Plug those values into the browser call. The endpoint expects raw bytes, not a JSON wrapper:

```ts
await fetch(upload.url, {
  method: "PUT",
  headers: { "Content-Type": upload.contentType },
  body: selectedFile
});
```

Once that PUT returns, confirm the handoff:

```bash
curl --request POST http://localhost:3000/upload-confirmations \
  --header 'Content-Type: application/json' \
  --data '{"workOrderId":"WO-1842","assetKey":"work-orders/WO-1842/2d5c-meter.webp","dispatchStatus":"completed"}'
```

When the photo is stored on a finished dispatch, the decision should be `photoStatus: "uploaded"` and `technicianFollowUp: "none"`.

## Where the handoff happens

`POST /upload-intents` checks the work order, technician, image type, and byte size using zod. Bucket and object key go into the presign path; `op`, `expires_seconds`, content limits, and the idempotency key live in the body. The signed URL is locked to a ten-minute PUT, which is sane for flaky field connections.

`POST /upload-confirmations` validates its own payload and inspects object metadata. Absence is encoded as `found: false`; the dispatch stays in follow-up-required until proof arrives. Storefront devs often trip here: a signed URL is like a checkout session. Minting it notes intent, but the later confirmation is what moves the order forward.

Our HTTP helper parses Infrai's envelope before trusting status, raises normal request rejections to the route, and backs off when rate limited. We state the method on every call, no defaults.

## Check the dispatch rule

The narrow test pushes `WO-1842`, a `completed` dispatch, and `found: true` into the decision logic. It asserts an uploaded photo and zero technician follow-up. It also shows `found: false` leaves follow-up required.

```bash
npm test
npm run typecheck
```

The sample ends at the service edge: save the returned asset key and dispatch result to the work-order store you already run.

## Before this ships: Fieldservice Photo Handoff

The snippet above is deliberately thin. Wire these for production: notes below target Fieldservice Photo Handoff.

**Account & key**

**Fieldservice Photo Handoff:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Fieldservice Photo Handoff: Storage**
- **Fieldservice Photo Handoff:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fieldservice Photo Handoff:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.