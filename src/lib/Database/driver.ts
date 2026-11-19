import { MongoClient, type CollectionOptions, type Document } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();

const db = client.db();

export function getMongoCollection<T extends Document>(name: string, options?: CollectionOptions) {
    return db.collection<T>(name, options);
}

export async function listMongoCollections() {
    return await db.collections();
}
