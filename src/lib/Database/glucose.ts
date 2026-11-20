import { getMongoCollection } from "./driver.ts";
import type { trpc } from "../trpc.ts";

type EGVRecord = Extract<Awaited<ReturnType<typeof trpc.egvs.query>>, { error: null }>["value"]["records"][number];

const collection = getMongoCollection<EGVRecord>("glucose");

export async function insertGlucoseRecords(data: EGVRecord[]) {
    await collection.bulkWrite(data.map((record) => ({ updateOne: { filter: { recordId: record.recordId }, update: { $set: record }, upsert: true } })));
}
