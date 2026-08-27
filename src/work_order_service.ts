import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decidePhotoHandoff } from "./dispatch_decision.js";
import { infrai, InfraiError } from "./infrai_storage.js";

const BUCKET = process.env.ASSET_BUCKET ?? "fieldservice-work-order-assets";
const PORT = Number(process.env.PORT ?? 3000);

const uploadIntentSchema = z.object({
  workOrderId: z.string().min(1).max(80),
  technicianId: z.string().min(1).max(80),
  fileName: z.string().min(1).max(120),
  contentType: z.string().regex(/^image\/(jpeg|png|webp)$/),
  bytes: z.number().int().positive().max(10_000_000)
}).strict();

const confirmationSchema = z.object({
  workOrderId: z.string().min(1).max(80),
  assetKey: z.string().min(1).max(400),
  dispatchStatus: z.enum(["en_route", "on_site", "completed"])
}).strict();

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function cleanSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    if (request.method === "POST" && request.url === "/upload-intents") {
      const input = uploadIntentSchema.parse(await readJson(request));
      const assetKey = `work-orders/${cleanSegment(input.workOrderId)}/${randomUUID()}-${cleanSegment(input.fileName)}`;
      const signed = await infrai.storage.object.presign(BUCKET, assetKey, {
        op: "put",
        expires_seconds: 600,
        content_type: input.contentType,
        max_bytes: input.bytes,
        idempotency_key: randomUUID()
      });
      send(response, 201, {
        workOrderId: input.workOrderId,
        technicianId: input.technicianId,
        assetKey,
        upload: { url: signed.url, method: "PUT", contentType: input.contentType },
        photoStatus: "awaiting_upload"
      });
      return;
    }

    if (request.method === "POST" && request.url === "/upload-confirmations") {
      const input = confirmationSchema.parse(await readJson(request));
      const object = await infrai.storage.object.head(BUCKET, input.assetKey);
      send(response, 200, decidePhotoHandoff(
        input.workOrderId,
        input.assetKey,
        input.dispatchStatus,
        object.found
      ));
      return;
    }

    send(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      send(response, 400, { error: "Invalid request body", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, message: error.message });
      return;
    }
    send(response, 500, { error: "Request could not be completed" });
  }
}

async function start(): Promise<void> {
  try {
    await infrai.storage.bucket.create(BUCKET);
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 409) throw error;
  }
  createServer((request, response) => void route(request, response)).listen(PORT, () => {
    console.log(`Work-order asset service listening on http://localhost:${PORT}`);
  });
}

void start();
