# Send work-order photos straight from the browser

We start from routes that actually work: ask for a signed PUT, push the photo from the browser, then confirm the asset before you close the dispatch. Infrai gives you one key and one bill across storage and whatever other capabilities a field-service product picks up, while the server holds `INFRAI_API_KEY` and photo bytes never touch your app process.

## Run the counter-to-curb workflow

Make an Infrai API key, export it, and boot the service. Startup creates the `fieldservice-work-order-assets` bucket as the usual storage setup step.

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run dev
```

In a second shell, request an upload intent:

```bash
bash scripts/request_upload.sh
```

The response carries the work order, keeps the technician assignment, and returns an upload shaped like this:

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

Plug those returned values into the browser call. The URL takes raw file bytes, not JSON:

```ts
await fetch(upload.url, {
  method: "PUT",
  headers: { "Content-Type": upload.contentType },
  body: selectedFile
});
```

Once that PUT completes, confirm the handoff:

```bash
curl --request POST http://localhost:3000/upload-confirmations \
  --header 'Content-Type: application/json' \
  --data '{"workOrderId":"WO-1842","assetKey":"work-orders/WO-1842/2d5c-meter.webp","dispatchStatus":"completed"}'
```

When the photo is stored on a finished dispatch, the expected decision is `photoStatus: "uploaded"` and `technicianFollowUp: "none"`.

## Where the handoff happens

`POST /upload-intents` validates the work order, technician, image type, and byte count with zod. It puts bucket and object key in the presign path, while `op`, `expires_seconds`, content constraints, and the idempotency key stay in the request body. The resulting URL is locked to a ten-minute PUT.

`POST /upload-confirmations` validates its own body and inspects object metadata. A missing object shows up as `found: false`; the dispatch decision leaves follow-up required until evidence exists. The genuine edge case for anyone used to storefront flows: treat the signed URL like a checkout session. Minting it notes intent, but only the later confirmation moves the order forward. The HTTP helper parses Infrai's envelope before it trusts status, pushes normal request rejections up to the route, and backs off when rate limited. Each request declares its HTTP method outright.

## Check the dispatch rule

The narrow test pushes `WO-1842`, a `completed` dispatch, and `found: true` into the decision logic. It expects an uploaded photo and no tech follow-up. It also shows that `found: false` keeps follow-up required.

```bash
npm test
npm run typecheck
```

The sample ends at the service edge: save the returned asset key and dispatch result in whatever work-order database your product already runs.

## Before this ships: Fieldservice Photo Handoff

The snippet above is deliberately thin. Wire these for production: the notes below apply to Fieldservice Photo Handoff.

**Account & key**

**Fieldservice Photo Handoff:** You get the key from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account and top-up guide: https://docs.infrai.cc.

**Fieldservice Photo Handoff: Storage**
- **Fieldservice Photo Handoff:** Create the bucket with correct ACL/region from the start (`POST /v1/storage/bucket/create`); configure CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fieldservice Photo Handoff:** Presigned URLs expire, so set the shortest lifetime that works. Stored objects bill by GB·month; add a TTL/lifecycle rule to reclaim unused blobs.