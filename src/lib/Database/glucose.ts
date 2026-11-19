import { getMongoCollection } from "./driver.ts";
import { type glucose } from "../types.ts";

const collection = getMongoCollection<glucose>("glucose");

export async function setGlucose(data: glucose) {
    await collection.updateOne({ time: data.time }, { $set: data }, { upsert: true });
}

export async function readGlucose(time: Date) {
    const doc = await collection.findOne({ time: time });
    return doc;
}
