import { trpc } from "@the-reunited-pieces/dexcom-api";
import { type ChatInputCommandInteraction } from "discord.js";

export async function handleDump(cmd: ChatInputCommandInteraction) {
    await cmd.deferReply();
    const option = cmd.options.getString("data", true);
    let data: unknown;
    if (option == "dataRange") {
        data = await trpc.dataRange.query();
    } else if (option == "egvs" || option == "events" || option == "alerts") {
        const { start, end } = (await trpc.dataRange
            .query()
            .then(({ error, value }) => (error ? null : value?.egvs))
            .then((value) =>
                value
                    ? {
                          start: new Date(
                              value.start.systemTime + "Z",
                          ).getTime(),
                          end: new Date(value.end.systemTime + "Z").getTime(),
                      }
                    : null,
            )
            .catch(() => null)) ?? {
            start: Date.now() - 24 * 60 * 60 * 1000,
            end: Date.now() + 24 * 60 * 60 * 1000,
        };

        data = await trpc[option].query({
            start: Math.max(start, end - 30 * 60 * 60 * 1000),
            end,
        });
    }

    await cmd.followUp({
        files: [
            {
                attachment: Buffer.from(JSON.stringify(data, null, 4)),
                name: "data.json",
            },
        ],
    });
}
