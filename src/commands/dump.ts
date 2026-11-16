import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { trpc } from '@the-reunited-pieces/dexcom-api';

export async function handleDump(cmd: ChatInputCommandInteraction) {
  await cmd.deferReply();
  const { start, end } = (await trpc.dataRange
    .query()
    .then(({ error, value }) => (error ? null : value?.egvs))
    .then((value) =>
      value
        ? {
            start: new Date(value.start.systemTime + 'Z').getTime(),
            end: new Date(value.end.systemTime + 'Z').getTime(),
          }
        : null,
    )
    .catch(() => null)) ?? {
    start: Date.now() - 24 * 60 * 60 * 1000,
    end: Date.now() + 24 * 60 * 60 * 1000,
  };

  const { error, value } = await trpc.egvs.query({
    start: Math.max(start, end - 30 * 60 * 60 * 1000),
    end,
  });

  await cmd.followUp({
    files: [
      {
        attachment: Buffer.from(JSON.stringify(value, null, 4)),
        name: 'data.json',
      },
    ],
  });
}
